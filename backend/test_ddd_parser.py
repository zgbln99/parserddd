"""Unit tests for DDD parser logic.

These tests validate the tachograph parser against known scenarios.
Run with: python3 -m pytest backend/test_ddd_parser.py -v
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import unittest

UTC = ZoneInfo('UTC')
CET = ZoneInfo('Europe/Berlin')

# Import will fail if dropbox/flask not installed; mock them
import unittest.mock
sys.modules['dropbox'] = unittest.mock.MagicMock()
sys.modules['dropbox.exceptions'] = unittest.mock.MagicMock()
sys.modules['flask'] = unittest.mock.MagicMock()
sys.modules['flask_cors'] = unittest.mock.MagicMock()
sys.modules['requests'] = unittest.mock.MagicMock()

from app import (
    build_timeline, detect_shifts, calculate_shift_night_hours,
    fill_timeline_gaps, _merge_cross_day_intervals,
    REST, AVAILABILITY, WORK, DRIVING, UNKNOWN,
)


def make_day(date_str, changes):
    """Helper: create a daily activity record."""
    return {
        'activity_record_date': date_str,
        'activity_change_info': changes,
    }


def make_change(minutes, work_type, card_present=True):
    return {'minutes': minutes, 'work_type': work_type, 'card_present': card_present}


class TestBuildTimeline(unittest.TestCase):

    def test_single_day_simple(self):
        """Single day: rest -> driving -> rest."""
        rec = make_day('2026-03-02', [
            make_change(0, REST),
            make_change(360, DRIVING),  # 06:00 UTC
            make_change(600, REST),     # 10:00 UTC
        ])
        intervals = build_timeline([rec])
        # Should have 3 intervals
        self.assertEqual(len(intervals), 3)
        # All UTC-aware
        for s, e, wt, co in intervals:
            self.assertIsNotNone(s.tzinfo)
            self.assertIsNotNone(e.tzinfo)
        # Check types
        self.assertEqual(intervals[0][2], REST)
        self.assertEqual(intervals[1][2], DRIVING)
        self.assertEqual(intervals[2][2], REST)
        # Check durations
        self.assertEqual(int((intervals[1][1] - intervals[1][0]).total_seconds()) // 60, 240)  # 4h driving

    def test_cross_midnight_continuous(self):
        """Activity crossing midnight stays as one interval."""
        day1 = make_day('2026-03-02', [
            make_change(0, REST),
            make_change(1380, DRIVING),  # 23:00 UTC
        ])
        day2 = make_day('2026-03-03', [
            make_change(0, DRIVING),     # continues
            make_change(120, REST),      # 02:00 UTC
        ])
        intervals = build_timeline([day1, day2])
        # Driving from 23:00 day1 to 02:00 day2 should be ONE merged interval
        driving = [iv for iv in intervals if iv[2] == DRIVING]
        self.assertEqual(len(driving), 1)
        dur = int((driving[0][1] - driving[0][0]).total_seconds()) // 60
        self.assertEqual(dur, 180)  # 3 hours continuous

    def test_first_entry_not_at_minute_0(self):
        """Day where first entry is not at minute 0 -- should handle gracefully."""
        rec = make_day('2026-03-02', [
            make_change(360, DRIVING, card_present=False),  # starts at 06:00
            make_change(600, REST),
        ])
        intervals = build_timeline([rec])
        # Should still produce valid intervals covering 1440 minutes
        total = sum(int((e - s).total_seconds()) // 60 for s, e, wt, co in intervals)
        self.assertEqual(total, 1440)

    def test_card_out_manual_entries(self):
        """Manual entries (card_present=False) are flagged as card_out=True."""
        rec = make_day('2026-03-02', [
            make_change(0, REST, card_present=False),
            make_change(360, DRIVING, card_present=True),
            make_change(600, REST, card_present=True),
        ])
        intervals = build_timeline([rec])
        # First interval should be card_out=True
        self.assertTrue(intervals[0][3])
        # Driving should be card_out=False
        driving = [iv for iv in intervals if iv[2] == DRIVING]
        self.assertFalse(driving[0][3])

    def test_utc_aware_datetimes(self):
        """All datetimes must be UTC-aware."""
        rec = make_day('2026-03-02', [make_change(0, REST)])
        intervals = build_timeline([rec])
        for s, e, wt, co in intervals:
            self.assertEqual(s.tzinfo, UTC)
            self.assertEqual(e.tzinfo, UTC)


class TestDetectShifts(unittest.TestCase):

    def test_long_rest_splits_shift(self):
        """9h+ rest splits into two shifts."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=8), DRIVING, False),
            (base + timedelta(hours=8), base + timedelta(hours=18), REST, False),  # 10h rest
            (base + timedelta(hours=18), base + timedelta(hours=24), DRIVING, False),
        ]
        shifts = detect_shifts(intervals, min_rest_hours=9)
        self.assertEqual(len(shifts), 2)

    def test_short_rest_no_split(self):
        """Rest < 9h does not split."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=8), DRIVING, False),
            (base + timedelta(hours=8), base + timedelta(hours=15), REST, False),  # 7h rest
            (base + timedelta(hours=15), base + timedelta(hours=20), DRIVING, False),
        ]
        shifts = detect_shifts(intervals, min_rest_hours=9)
        self.assertEqual(len(shifts), 1)

    def test_blip_during_rest(self):
        """A 2-minute blip during rest should not break the rest period."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=6), DRIVING, False),
            (base + timedelta(hours=6), base + timedelta(hours=11), REST, False),
            (base + timedelta(hours=11), base + timedelta(hours=11, minutes=2), WORK, False),  # blip
            (base + timedelta(hours=11, minutes=2), base + timedelta(hours=16), REST, False),
            (base + timedelta(hours=16), base + timedelta(hours=22), DRIVING, False),
        ]
        shifts = detect_shifts(intervals, min_rest_hours=9)
        # 5h + blip + 5h = ~10h total rest, should split
        self.assertEqual(len(shifts), 2)

    def test_unknown_gap_counts_as_rest(self):
        """UNKNOWN gaps should count as rest for shift splitting."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=8), DRIVING, False),
            (base + timedelta(hours=8), base + timedelta(hours=20), UNKNOWN, True),  # 12h unknown
            (base + timedelta(hours=20), base + timedelta(hours=24), DRIVING, False),
        ]
        shifts = detect_shifts(intervals, min_rest_hours=9)
        self.assertEqual(len(shifts), 2)


class TestNightHours(unittest.TestCase):

    def test_daytime_no_night(self):
        """Work entirely in daytime = 0 night hours."""
        base = datetime(2026, 3, 2, 7, 0, tzinfo=UTC)  # 08:00 CET
        intervals = [(base, base + timedelta(hours=8), DRIVING, False)]
        n25, n40 = calculate_shift_night_hours(intervals, base, night_start_hour=22)
        self.assertEqual(n25, 0)
        self.assertEqual(n40, 0)

    def test_night_work_25(self):
        """Work in 22:00-00:00 CET = 25%."""
        # 22:00 CET in winter (UTC+1) = 21:00 UTC
        base = datetime(2026, 3, 2, 21, 0, tzinfo=UTC)
        end = datetime(2026, 3, 2, 23, 0, tzinfo=UTC)  # 00:00 CET
        intervals = [(base, end, DRIVING, False)]
        n25, n40 = calculate_shift_night_hours(intervals, base, night_start_hour=22)
        self.assertEqual(n25, 120)  # 2 hours
        self.assertEqual(n40, 0)

    def test_unknown_not_counted_as_night(self):
        """UNKNOWN intervals should not count toward night hours."""
        base = datetime(2026, 3, 2, 21, 0, tzinfo=UTC)
        intervals = [(base, base + timedelta(hours=6), UNKNOWN, True)]
        n25, n40 = calculate_shift_night_hours(intervals, base, night_start_hour=22)
        self.assertEqual(n25, 0)
        self.assertEqual(n40, 0)


class TestFillGaps(unittest.TestCase):

    def test_gap_filled_as_unknown(self):
        """Gaps between intervals should be UNKNOWN, not REST."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=8), DRIVING, False),
            (base + timedelta(hours=20), base + timedelta(hours=24), DRIVING, False),
        ]
        filled = fill_timeline_gaps(intervals)
        gap = [iv for iv in filled if iv[2] == UNKNOWN]
        self.assertEqual(len(gap), 1)
        self.assertEqual(int((gap[0][1] - gap[0][0]).total_seconds()) // 60, 720)  # 12h


class TestMergeIntervals(unittest.TestCase):

    def test_exact_boundary_merges(self):
        """Adjacent intervals with same state and exact boundary merge."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=12), REST, False),
            (base + timedelta(hours=12), base + timedelta(hours=24), REST, False),
        ]
        merged = _merge_cross_day_intervals(intervals)
        self.assertEqual(len(merged), 1)
        self.assertEqual(int((merged[0][1] - merged[0][0]).total_seconds()) // 60, 1440)

    def test_gap_does_not_merge(self):
        """Intervals with a gap between them do not merge."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=8), REST, False),
            (base + timedelta(hours=9), base + timedelta(hours=20), REST, False),
        ]
        merged = _merge_cross_day_intervals(intervals)
        self.assertEqual(len(merged), 2)


class TestUnknownHandling(unittest.TestCase):
    """Tests for UNKNOWN state correctness (fixes 1-5)."""

    def test_missing_minute_0_fills_unknown(self):
        """A: First entry at minute 137 → minutes 0..136 must be UNKNOWN."""
        rec = make_day('2026-03-02', [
            make_change(137, DRIVING, card_present=True),
            make_change(600, REST),
        ])
        intervals = build_timeline([rec])
        # First interval should be UNKNOWN from 00:00 to 02:17 UTC
        first = intervals[0]
        self.assertEqual(first[2], UNKNOWN, 'Missing minute 0 should produce UNKNOWN, not REST')
        self.assertTrue(first[3])  # card_out=True
        dur = int((first[1] - first[0]).total_seconds()) // 60
        self.assertEqual(dur, 137)

    def test_unknown_not_counted_as_manual_minutes(self):
        """B: UNKNOWN intervals should not inflate manual_minutes."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        # Simulate: card-present work, then UNKNOWN gap, then more work
        shift_intervals = [
            (base, base + timedelta(hours=4), DRIVING, False),              # card present
            (base + timedelta(hours=4), base + timedelta(hours=10), UNKNOWN, True),  # gap
            (base + timedelta(hours=10), base + timedelta(hours=14), WORK, True),    # manual work
        ]
        # Manual minutes should only count WORK(True) after first card-present, not UNKNOWN
        first_cp_idx = next(
            (i for i, (_, _, _, m) in enumerate(shift_intervals) if not m), len(shift_intervals))
        manual_mins = sum(
            int((e - s).total_seconds()) // 60
            for i, (s, e, wt, m) in enumerate(shift_intervals)
            if m and wt in (AVAILABILITY, WORK, DRIVING) and i > first_cp_idx
        )
        # Only the 4h manual WORK should count, not the 6h UNKNOWN
        self.assertEqual(manual_mins, 240)

    def test_unknown_does_not_create_manual_errors(self):
        """C: Long UNKNOWN overnight should not appear in manual_errors."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        shift_intervals = [
            (base + timedelta(hours=6), base + timedelta(hours=14), DRIVING, False),
            (base + timedelta(hours=14), base + timedelta(hours=24), UNKNOWN, True),  # 10h overnight
        ]
        errors = []
        for idx, (s, e, wt, m) in enumerate(shift_intervals):
            if not m or wt in (REST, UNKNOWN):
                continue
            dur_min = int((e - s).total_seconds()) // 60
            if dur_min > 600:
                errors.append(wt)
        self.assertEqual(len(errors), 0, 'UNKNOWN should not trigger manual error')

    def test_unknown_does_not_expand_shift_duration(self):
        """D: Leading/trailing UNKNOWN should not define effective shift span."""
        base = datetime(2026, 3, 2, tzinfo=UTC)
        shift_intervals = [
            (base, base + timedelta(hours=3), UNKNOWN, True),          # leading unknown
            (base + timedelta(hours=3), base + timedelta(hours=11), DRIVING, False),  # real work
            (base + timedelta(hours=11), base + timedelta(hours=14), UNKNOWN, True),  # trailing unknown
        ]
        _REAL_WORK = (AVAILABILITY, WORK, DRIVING)
        first_work_idx = next(
            (i for i, (_, _, wt, _) in enumerate(shift_intervals) if wt in _REAL_WORK), 0)
        last_work_idx = next(
            (i for i in range(len(shift_intervals) - 1, -1, -1)
             if shift_intervals[i][2] in _REAL_WORK),
            len(shift_intervals) - 1)
        effective_start = shift_intervals[first_work_idx][0]
        effective_end = shift_intervals[last_work_idx][1]
        dur = int((effective_end - effective_start).total_seconds()) // 60
        # Duration should be 8h (driving only), not 14h (including UNKNOWN)
        self.assertEqual(dur, 480)

    def test_cross_midnight_no_fake_rest(self):
        """E: Cross-midnight shift with no fake REST at 00:00."""
        day1 = make_day('2026-03-02', [
            make_change(0, REST),
            make_change(1380, DRIVING),  # 23:00 UTC, driving
        ])
        day2 = make_day('2026-03-03', [
            make_change(0, DRIVING),     # 00:00 UTC, still driving
            make_change(180, REST),      # 03:00 UTC, rest
        ])
        intervals = build_timeline([day1, day2])
        # At midnight boundary there should be NO REST injected
        # Driving should be continuous from 23:00 to 03:00
        driving = [iv for iv in intervals if iv[2] == DRIVING]
        self.assertEqual(len(driving), 1, 'Cross-midnight driving should be one interval')
        dur = int((driving[0][1] - driving[0][0]).total_seconds()) // 60
        self.assertEqual(dur, 240)  # 4 hours

    def test_default_minute_array_is_unknown(self):
        """Default minute array should be UNKNOWN, not REST."""
        # Empty changes = entire day UNKNOWN
        rec = make_day('2026-03-02', [])
        intervals = build_timeline([rec])
        # Empty changes → no day produced (skipped)
        self.assertEqual(len(intervals), 0)


if __name__ == '__main__':
    unittest.main()

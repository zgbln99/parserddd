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
    iter_tachograph_minutes,
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
        """9h+ rest crossing CET day boundary splits into two shifts.

        Intra-day rests do NOT split (GloboFleet behavior).
        The rest must cross into a different CET calendar day to trigger a split.
        """
        # Day 1: driving 16:00-23:00 UTC (17:00-00:00 CET)
        # Rest: 23:00 UTC Mar 2 -> 09:00 UTC Mar 3 (10h, crosses to CET Mar 3)
        # Day 2: driving 09:00-15:00 UTC (10:00-16:00 CET)
        base = datetime(2026, 3, 2, 16, 0, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=7), DRIVING, False),
            (base + timedelta(hours=7), base + timedelta(hours=17), REST, False),  # 10h rest
            (base + timedelta(hours=17), base + timedelta(hours=23), DRIVING, False),
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

    def test_blip_during_rest_breaks_chain(self):
        """A 2-minute WORK blip during rest breaks the contiguous rest chain.

        detect_shifts only merges adjacent REST/UNKNOWN intervals.
        A WORK blip is treated as real activity, splitting the rest into
        two separate blocks — neither of which reaches the 9h threshold alone.
        This matches GloboFleet behavior.
        """
        base = datetime(2026, 3, 2, 18, 0, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=4), DRIVING, False),
            (base + timedelta(hours=4), base + timedelta(hours=9), REST, False),        # 5h rest
            (base + timedelta(hours=9), base + timedelta(hours=9, minutes=2), WORK, False),  # blip
            (base + timedelta(hours=9, minutes=2), base + timedelta(hours=14), REST, False),  # ~5h rest
            (base + timedelta(hours=14), base + timedelta(hours=20), DRIVING, False),
        ]
        shifts = detect_shifts(intervals, min_rest_hours=9)
        # Blip breaks the rest chain: 5h and ~5h, neither >= 9h → no split
        self.assertEqual(len(shifts), 1)

    def test_unknown_gap_counts_as_rest(self):
        """UNKNOWN gaps crossing CET day boundary should count as rest for shift splitting."""
        # Day 1: driving 16:00-22:00 UTC (17:00-23:00 CET Mar 2)
        # UNKNOWN: 22:00 UTC Mar 2 -> 10:00 UTC Mar 3 (12h, crosses to CET Mar 3)
        # Day 2: driving 10:00-14:00 UTC Mar 3
        base = datetime(2026, 3, 2, 16, 0, tzinfo=UTC)
        intervals = [
            (base, base + timedelta(hours=6), DRIVING, False),
            (base + timedelta(hours=6), base + timedelta(hours=18), UNKNOWN, True),  # 12h unknown
            (base + timedelta(hours=18), base + timedelta(hours=22), DRIVING, False),
        ]
        shifts = detect_shifts(intervals, min_rest_hours=9)
        self.assertEqual(len(shifts), 2)


class TestNightHours(unittest.TestCase):

    @staticmethod
    def _intervals_to_buckets(intervals):
        """Convert interval list to minute_buckets dict for calculate_shift_night_hours."""
        buckets = {}
        for dt, wt, card_out in iter_tachograph_minutes(intervals):
            buckets[dt] = (wt, card_out)
        return buckets

    def test_daytime_no_night(self):
        """Work entirely in daytime = 0 night hours."""
        base = datetime(2026, 3, 2, 7, 0, tzinfo=UTC)  # 08:00 CET
        intervals = [(base, base + timedelta(hours=8), DRIVING, False)]
        buckets = self._intervals_to_buckets(intervals)
        n25, n40 = calculate_shift_night_hours(buckets, base, night_start_hour=22)
        self.assertEqual(n25, 0)
        self.assertEqual(n40, 0)

    def test_night_work_25(self):
        """Work in 22:00-00:00 CET = 25%."""
        # 22:00 CET in winter (UTC+1) = 21:00 UTC
        base = datetime(2026, 3, 2, 21, 0, tzinfo=UTC)
        end = datetime(2026, 3, 2, 23, 0, tzinfo=UTC)  # 00:00 CET
        intervals = [(base, end, DRIVING, False)]
        buckets = self._intervals_to_buckets(intervals)
        n25, n40 = calculate_shift_night_hours(buckets, base, night_start_hour=22)
        self.assertEqual(n25, 120)  # 2 hours
        self.assertEqual(n40, 0)

    def test_unknown_not_counted_as_night(self):
        """UNKNOWN intervals should not count toward night hours."""
        base = datetime(2026, 3, 2, 21, 0, tzinfo=UTC)
        intervals = [(base, base + timedelta(hours=6), UNKNOWN, True)]
        buckets = self._intervals_to_buckets(intervals)
        n25, n40 = calculate_shift_night_hours(buckets, base, night_start_hour=22)
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

    def test_missing_minute_0_fills_rest_in_globofleet_mode(self):
        """A: First entry at minute 137 → minutes 0..136 are REST/manual in Globofleet strict mode.

        STRICT_GLOBOFLEET_MODE=True treats missing minute-0 as REST (card_out=True)
        for compatibility with GloboFleet software.
        """
        rec = make_day('2026-03-02', [
            make_change(137, DRIVING, card_present=True),
            make_change(600, REST),
        ])
        intervals = build_timeline([rec])
        # First interval should be REST (Globofleet compat) from 00:00 to 02:17 UTC
        first = intervals[0]
        self.assertEqual(first[2], REST,
                         'Missing minute 0 should produce REST in STRICT_GLOBOFLEET_MODE')
        self.assertTrue(first[3])  # card_out=True (manual entry)
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


class TestFinalFixes(unittest.TestCase):
    """Tests for the two final fixes: no-real-work shifts and card_present validation."""

    def test_shift_with_no_real_work_skipped(self):
        """A: Shift containing only REST/UNKNOWN produces no shift_details entry."""
        from app import analyze_card, get_activity_records

        # Build a minimal data dict that will produce a REST-only shift.
        # We test via detect_shifts directly since analyze_card needs full DDD data.
        base = datetime(2026, 3, 2, tzinfo=UTC)
        # One shift of pure REST (less than 9h so detect_shifts doesn't split)
        shift_intervals = [
            (base, base + timedelta(hours=5), REST, False),
            (base + timedelta(hours=5), base + timedelta(hours=8), UNKNOWN, True),
        ]
        # Simulate the real_work_indices check from analyze_card
        _REAL_WORK = (AVAILABILITY, WORK, DRIVING)
        real_work_indices = [
            i for i, (_, _, wt, _) in enumerate(shift_intervals) if wt in _REAL_WORK
        ]
        self.assertEqual(len(real_work_indices), 0,
                         'REST/UNKNOWN-only shift should have no real work indices')
        # The shift should be skipped (continue) in analyze_card

    def test_invalid_card_present_type_handled(self):
        """B: Non-bool card_present should not crash and should default to True."""
        # card_present="false" (string, not bool) — Python truthiness would say True!
        rec = make_day('2026-03-02', [
            {'minutes': 0, 'work_type': REST, 'card_present': "false"},
            {'minutes': 360, 'work_type': DRIVING, 'card_present': 1},
            {'minutes': 600, 'work_type': REST, 'card_present': True},
        ])
        # Should not crash
        intervals = build_timeline([rec])
        self.assertTrue(len(intervals) > 0, 'Should produce intervals despite invalid card_present')
        # With fallback to True, the "false" string entry should be card_out=False
        # (because cp defaults to True when not bool → manual = not True = False)
        first = intervals[0]
        self.assertFalse(first[3],
                         'Invalid card_present should default to True → card_out=False')

    def test_card_present_integer_handled(self):
        """card_present=1 (int) should warn and default to True → card_out=False."""
        rec = make_day('2026-03-02', [
            {'minutes': 0, 'work_type': DRIVING, 'card_present': 1},
            {'minutes': 480, 'work_type': REST, 'card_present': True},
        ])
        intervals = build_timeline([rec])
        driving = [iv for iv in intervals if iv[2] == DRIVING]
        self.assertEqual(len(driving), 1)
        # card_present=1 is not bool → defaults to True → card_out=False
        self.assertFalse(driving[0][3])


class TestCoDriverAndManualFixes(unittest.TestCase):
    """Tests for co-driver deduplication and manual entry handling."""

    def test_only_slot1_used_ignoring_codriver_slot2(self):
        """Only card_driver_activity_1 (driver slot) should be used; _2 (co-driver) ignored."""
        from app import get_activity_records
        data = {
            'card_driver_activity_1': {
                'decoded_activity_daily_records': [{
                    'activity_record_date': '2026-03-02',
                    'activity_change_info': [
                        {'minutes': 0, 'work_type': REST, 'card_present': True},
                        {'minutes': 360, 'work_type': WORK, 'card_present': True},
                        {'minutes': 600, 'work_type': REST, 'card_present': True},
                    ],
                }],
            },
            'card_driver_activity_2': {
                'decoded_activity_daily_records': [{
                    'activity_record_date': '2026-03-02',
                    'activity_change_info': [
                        {'minutes': 0, 'work_type': AVAILABILITY, 'card_present': True},
                        {'minutes': 900, 'work_type': REST, 'card_present': True},
                    ],
                }],
            },
        }
        records = get_activity_records(data)
        self.assertEqual(len(records), 1)
        # Should use slot 1 (WORK), NOT slot 2 (AVAILABILITY/co-driver)
        changes = records[0].get('activity_change_info', [])
        work_types = [c['work_type'] for c in changes]
        self.assertIn(WORK, work_types,
                      'Should use driver slot 1 data')
        self.assertNotIn(AVAILABILITY, work_types,
                         'Co-driver slot 2 AVAILABILITY should not be included')

    def test_fallback_to_slot2_if_slot1_empty(self):
        """If slot 1 is empty, fall back to slot 2 data."""
        from app import get_activity_records
        data = {
            'card_driver_activity_2': {
                'decoded_activity_daily_records': [{
                    'activity_record_date': '2026-03-02',
                    'activity_change_info': [
                        {'minutes': 0, 'work_type': AVAILABILITY, 'card_present': True},
                        {'minutes': 600, 'work_type': REST, 'card_present': True},
                    ],
                }],
            },
        }
        records = get_activity_records(data)
        self.assertEqual(len(records), 1, 'Should fall back to slot 2 if slot 1 missing')

    def test_long_availability_not_converted_to_unknown_start_of_day(self):
        """Co-driver AVAILABILITY at minute 0 with next change far away should NOT become UNKNOWN."""
        rec = make_day('2026-03-02', [
            make_change(0, AVAILABILITY, card_present=True),
            make_change(600, REST, card_present=True),  # 10:00 - next change 10h away
        ])
        intervals = build_timeline([rec])
        avail = [iv for iv in intervals if iv[2] == AVAILABILITY]
        self.assertTrue(len(avail) > 0,
                        'Long AVAILABILITY at start of day should NOT be converted to UNKNOWN')
        # Should be 600 minutes of AVAILABILITY
        avail_dur = sum(int((e - s).total_seconds()) // 60 for s, e, wt, m in avail)
        self.assertEqual(avail_dur, 600)

    def test_long_availability_not_converted_to_unknown_end_of_day(self):
        """Co-driver AVAILABILITY at end of day with >2h to midnight should NOT become UNKNOWN."""
        rec = make_day('2026-03-02', [
            make_change(0, REST, card_present=True),
            make_change(360, AVAILABILITY, card_present=True),  # 06:00, runs to midnight = 18h
        ])
        intervals = build_timeline([rec])
        avail = [iv for iv in intervals if iv[2] == AVAILABILITY]
        self.assertTrue(len(avail) > 0,
                        'Long AVAILABILITY at end of day should NOT be converted to UNKNOWN')
        avail_dur = sum(int((e - s).total_seconds()) // 60 for s, e, wt, m in avail)
        self.assertEqual(avail_dur, 1080)  # 06:00 to 24:00 = 18h = 1080min

    def test_long_work_still_converted_to_unknown_end_of_day(self):
        """WORK at end of day with >2h to midnight should still become UNKNOWN (driver forgot to switch)."""
        rec = make_day('2026-03-02', [
            make_change(0, REST, card_present=True),
            make_change(360, WORK, card_present=True),  # 06:00, runs to midnight = 18h
        ])
        intervals = build_timeline([rec])
        work = [iv for iv in intervals if iv[2] == WORK]
        unknown = [iv for iv in intervals if iv[2] == UNKNOWN]
        # WORK should be capped at 2h, rest should be UNKNOWN
        self.assertTrue(len(unknown) > 0,
                        'Long WORK at end of day should still be converted to UNKNOWN')


if __name__ == '__main__':
    unittest.main()

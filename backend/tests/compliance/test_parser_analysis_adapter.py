"""Tests for the parser/analysis -> NormalizedActivity adapter.

The adapter must:
* map each activity type correctly (driving/work/availability/break/rest/unknown),
* read ``driver_id`` from the existing ``driver_info`` block,
* read ``vehicle_id`` from the existing vehicle list when present,
* preserve ``start`` / ``end`` (UTC-aware) untouched,
* tag ``source`` correctly,
* leave fields it cannot derive as ``None`` / defaults — never invent.

It must also be **non-mutating** on its inputs.
"""

from __future__ import annotations

import copy
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.compliance.adapters import (
    from_timeline,
    map_activity_label,
)
from backend.compliance.models import ActivitySource, ActivityType

# These are the integer constants the existing timeline uses.
from core.constants import (
    AVAILABILITY as C_AVAIL,
    DRIVING as C_DRIVING,
    REST as C_REST,
    UNKNOWN as C_UNKNOWN,
    WORK as C_WORK,
)


UTC = timezone.utc


def _ts(year, month, day, hour=0, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


class LabelMappingTests(unittest.TestCase):
    def test_integer_constants(self):
        self.assertEqual(map_activity_label(C_DRIVING), ActivityType.DRIVING)
        self.assertEqual(map_activity_label(C_WORK), ActivityType.WORK)
        self.assertEqual(map_activity_label(C_AVAIL), ActivityType.AVAILABILITY)
        self.assertEqual(map_activity_label(C_REST), ActivityType.REST)
        self.assertEqual(map_activity_label(C_UNKNOWN), ActivityType.UNKNOWN)

    def test_text_synonyms(self):
        cases = {
            "driving": ActivityType.DRIVING,
            "Lenken": ActivityType.DRIVING,
            "Fahren": ActivityType.DRIVING,
            "jazda": ActivityType.DRIVING,
            "work": ActivityType.WORK,
            "Arbeit": ActivityType.WORK,
            "praca": ActivityType.WORK,
            "availability": ActivityType.AVAILABILITY,
            "Bereitschaft": ActivityType.AVAILABILITY,
            "POA": ActivityType.AVAILABILITY,
            "break": ActivityType.BREAK,
            "Pause": ActivityType.BREAK,
            "rest": ActivityType.REST,
            "Ruhezeit": ActivityType.REST,
            "odpoczynek": ActivityType.REST,
            "unknown": ActivityType.UNKNOWN,
            "gap": ActivityType.UNKNOWN,
        }
        for label, want in cases.items():
            with self.subTest(label=label):
                self.assertEqual(map_activity_label(label), want)

    def test_unknown_returns_none(self):
        self.assertIsNone(map_activity_label("not-a-thing"))
        self.assertIsNone(map_activity_label(None))
        self.assertIsNone(map_activity_label(True))   # bool not silently mapped


class FromTimelineTests(unittest.TestCase):
    def _sample_timeline(self):
        start = _ts(2026, 5, 11, 6, 0)
        return [
            (start, start + timedelta(minutes=60), C_DRIVING, False),
            (start + timedelta(minutes=60), start + timedelta(minutes=75), C_REST, False),
            (start + timedelta(minutes=75), start + timedelta(minutes=120), C_WORK, False),
            (start + timedelta(minutes=120), start + timedelta(minutes=150), C_AVAIL, False),
            (start + timedelta(minutes=150), start + timedelta(minutes=180), C_UNKNOWN, True),
        ]

    def test_each_type_mapped(self):
        out = from_timeline(
            self._sample_timeline(),
            driver_info={"card_number": "PL123"},
            vehicles=[{"vehicle_registration_number": "WX-12345"}],
        )
        self.assertEqual(
            [a.type for a in out],
            [
                ActivityType.DRIVING,
                ActivityType.REST,
                ActivityType.WORK,
                ActivityType.AVAILABILITY,
                ActivityType.UNKNOWN,
            ],
        )

    def test_driver_and_vehicle_id_extracted(self):
        out = from_timeline(
            self._sample_timeline(),
            driver_info={"card_number": "PL123", "driver_name": "Kowalski Jan"},
            vehicles=[{"vehicle_registration_number": "WX-12345"}],
        )
        self.assertTrue(out)
        self.assertEqual(out[0].driver_id, "PL123")
        self.assertEqual(out[0].vehicle_id, "WX-12345")

    def test_falls_back_to_driver_name_then_unknown(self):
        out = from_timeline(
            self._sample_timeline(),
            driver_info={"driver_name": "Kowalski Jan"},
        )
        self.assertEqual(out[0].driver_id, "Kowalski Jan")

        out = from_timeline(self._sample_timeline())
        self.assertEqual(out[0].driver_id, "unknown")
        self.assertIsNone(out[0].vehicle_id)

    def test_start_end_preserved(self):
        tl = self._sample_timeline()
        out = from_timeline(tl)
        for src, mapped in zip(tl, out):
            self.assertEqual(src[0], mapped.start)
            self.assertEqual(src[1], mapped.end)

    def test_source_tag(self):
        out = from_timeline(self._sample_timeline())
        for a in out:
            self.assertEqual(a.source, ActivitySource.DDD)

        out2 = from_timeline(
            self._sample_timeline(),
            source=ActivitySource.SAMSARA,
        )
        for a in out2:
            self.assertEqual(a.source, ActivitySource.SAMSARA)

    def test_manual_entry_flag_propagates_from_card_out(self):
        out = from_timeline(self._sample_timeline())
        # Last entry has card_out=True in the fixture.
        self.assertTrue(out[-1].is_manual_entry)
        # First one is False.
        self.assertFalse(out[0].is_manual_entry)

    def test_unknown_label_value_becomes_unknown(self):
        start = _ts(2026, 5, 11, 6, 0)
        tl = [(start, start + timedelta(minutes=60), "????", False)]
        out = from_timeline(tl)
        self.assertEqual(out[0].type, ActivityType.UNKNOWN)

    def test_invalid_entries_are_skipped_not_inferred(self):
        # None start/end, end before start, missing fields, non-datetime.
        bad = [
            (None, _ts(2026, 5, 11), C_DRIVING, False),
            (_ts(2026, 5, 11), None, C_DRIVING, False),
            (_ts(2026, 5, 11, 8), _ts(2026, 5, 11, 7), C_DRIVING, False),  # end<start
            ("not-a-dt", "also-not", C_DRIVING, False),
            (),
        ]
        self.assertEqual(from_timeline(bad), [])


class AdapterImmutabilityTests(unittest.TestCase):
    def test_inputs_are_not_mutated(self):
        start = _ts(2026, 5, 11, 6, 0)
        parser_analysis = {
            "driver_info": {"card_number": "PL123", "driver_name": "Kowalski"},
            "vehicles": [{"vehicle_registration_number": "WX-12345"}],
            "timeline": [
                (start, start + timedelta(minutes=300), C_DRIVING, False),
            ],
            # Pretend the existing analysis carries extra summary fields —
            # the adapter must not touch them.
            "summary": {"total_driving_minutes": 300},
            "shift_details": [{"start": "2026-05-11 06:00"}],
        }
        snapshot = copy.deepcopy(parser_analysis)

        from backend.compliance.service import (
            evaluate_parser_analysis_for_violations,
        )
        evaluate_parser_analysis_for_violations(parser_analysis)

        self.assertEqual(parser_analysis, snapshot)


if __name__ == "__main__":
    unittest.main()

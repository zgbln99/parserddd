"""Tests for the AnalysisResult -> NormalizedActivity adapter path.

This is the path the frontend uses when it ships the existing
``analyze_card`` output to ``/api/compliance/evaluate-parser-analysis``.
"""

from __future__ import annotations

import copy
import os
import sys
import unittest

_THIS = os.path.dirname(__file__)
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..", "..")))

from backend.compliance.adapters import (
    from_shift_details,
    looks_like_analysis_result,
)
from backend.compliance.models import ActivitySource, ActivityType
from backend.compliance.service import (
    evaluate_parser_analysis_for_violations,
    inspect_parser_analysis,
)


def _analysis_result_with_one_shift_5h_driving() -> dict:
    """The shape the frontend has after a successful upload analysis."""
    return {
        "driver_info": {"card_number": "PL123"},
        "vehicles": [{"plate": "WX-12345"}],
        "shift_details": [
            {
                "shift_start": "2026-05-11 06:00",
                "shift_end": "2026-05-11 11:00",
                "driving_minutes": 300,
                "driving_segments": [
                    {"start": "2026-05-11 06:00", "end": "2026-05-11 11:00",
                     "duration_minutes": 300},
                ],
                "break_segments": [],
            }
        ],
    }


def _analysis_two_shifts_with_rest_between() -> dict:
    return {
        "driver_info": {"card_number": "PL123"},
        "vehicles": [{"plate": "WX-12345"}],
        "shift_details": [
            {
                "shift_start": "2026-05-11 06:00",
                "shift_end": "2026-05-11 14:00",
                "driving_segments": [
                    {"start": "2026-05-11 06:00", "end": "2026-05-11 10:00"},
                ],
                "break_segments": [
                    {"start": "2026-05-11 10:00", "end": "2026-05-11 10:45"},
                ],
            },
            {
                "shift_start": "2026-05-12 06:00",
                "shift_end": "2026-05-12 12:00",
                "driving_segments": [
                    {"start": "2026-05-12 06:00", "end": "2026-05-12 10:00"},
                ],
                "break_segments": [],
            },
        ],
    }


class LooksLikeAnalysisResultTests(unittest.TestCase):
    def test_recognises_analysis_result_shape(self):
        self.assertTrue(looks_like_analysis_result(
            _analysis_result_with_one_shift_5h_driving()
        ))

    def test_rejects_other_shapes(self):
        self.assertFalse(looks_like_analysis_result({}))
        self.assertFalse(looks_like_analysis_result(
            {"timeline": [["2026-05-11T06:00:00+00:00",
                           "2026-05-11T11:00:00+00:00", 3, False]]}
        ))


class FromShiftDetailsTests(unittest.TestCase):
    def test_one_shift_one_driving_activity(self):
        acts = from_shift_details(
            _analysis_result_with_one_shift_5h_driving()
        )
        self.assertEqual(len(acts), 1)
        a = acts[0]
        self.assertEqual(a.type, ActivityType.DRIVING)
        self.assertEqual(a.driver_id, "PL123")
        self.assertEqual(a.vehicle_id, "WX-12345")
        self.assertEqual(a.duration_minutes(), 300)
        self.assertEqual(a.source, ActivitySource.DDD)

    def test_two_shifts_yield_rest_between(self):
        acts = from_shift_details(_analysis_two_shifts_with_rest_between())
        types = [a.type for a in acts]
        self.assertIn(ActivityType.REST, types)
        # Day 1: driving + break; bridging REST; day 2: driving.
        self.assertEqual(types.count(ActivityType.DRIVING), 2)
        self.assertEqual(types.count(ActivityType.BREAK), 1)
        self.assertEqual(types.count(ActivityType.REST), 1)


class ServiceIntegrationFromAnalysisResultTests(unittest.TestCase):
    def test_endpoint_path_detects_continuous_driving(self):
        payload = _analysis_result_with_one_shift_5h_driving()
        result = evaluate_parser_analysis_for_violations(payload)
        codes = [v["ruleCode"] for v in result["violations"]]
        self.assertIn("EU_561_CONTINUOUS_DRIVING", codes)

    def test_inspect_show_activities_from_analysis_result(self):
        payload = _analysis_result_with_one_shift_5h_driving()
        result = inspect_parser_analysis(payload, show_activities=True)
        self.assertEqual(len(result["activities"]), 1)
        self.assertEqual(result["activities"][0]["type"], "DRIVING")
        self.assertEqual(
            result["activities"][0]["durationMinutes"], 300
        )

    def test_input_is_not_mutated(self):
        payload = _analysis_result_with_one_shift_5h_driving()
        snapshot = copy.deepcopy(payload)
        evaluate_parser_analysis_for_violations(payload)
        self.assertEqual(payload, snapshot)


if __name__ == "__main__":
    unittest.main()

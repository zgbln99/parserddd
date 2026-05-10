"""Tests for the adapter-debug surface (``--show-activities`` in dev_eval).

The mode lists the post-adapter ``NormalizedActivity`` view of a payload
and surfaces diagnostic warnings (UNKNOWN slices, ``end <= start`` raw
entries, between-activity gaps). The feature is intentionally **off by
default** so an ordinary ``inspect`` stays compact.
"""

from __future__ import annotations

import copy
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

_THIS = os.path.dirname(__file__)
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..", "..")))

from backend.compliance import dev_eval
from backend.compliance.service import inspect_parser_analysis


def _iso(year, month, day, hour=0, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc).isoformat()


def _payload_with_mixed_types_and_gap_and_invalid() -> dict:
    """Multi-activity payload covering all warning kinds at once."""
    return {
        "parserAnalysis": {
            "driver_info": {"card_number": "PL123"},
            "vehicles": [{"vehicle_registration_number": "WX-12345"}],
            "timeline": [
                # 1) normal driving
                [_iso(2026, 5, 11, 6, 0),
                 _iso(2026, 5, 11, 7, 0),
                 3, False],
                # 2) UNKNOWN window — should produce UNKNOWN_ACTIVITY warning
                [_iso(2026, 5, 11, 7, 0),
                 _iso(2026, 5, 11, 8, 0),
                 -1, False],
                # 3) gap of 30 minutes (skipped, no entry)
                # 4) more driving
                [_iso(2026, 5, 11, 8, 30),
                 _iso(2026, 5, 11, 9, 30),
                 3, False],
                # 5) invalid time range — adapter drops it, diagnostics still flags it
                [_iso(2026, 5, 11, 10, 0),
                 _iso(2026, 5, 11, 9, 30),
                 3, False],
            ],
        },
    }


def _five_hour_driving_payload() -> dict:
    return {
        "parserAnalysis": {
            "driver_info": {"card_number": "PL123"},
            "timeline": [
                [_iso(2026, 5, 11, 6, 0), _iso(2026, 5, 11, 11, 0), 3, False],
            ],
        },
    }


def _write_temp_json(payload: dict) -> str:
    fh = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    )
    json.dump(payload, fh)
    fh.close()
    return fh.name


class ShowActivitiesServiceTests(unittest.TestCase):
    def test_default_inspect_does_not_include_activities(self):
        result = inspect_parser_analysis(
            _five_hour_driving_payload()["parserAnalysis"]
        )
        self.assertNotIn("activities", result)
        self.assertNotIn("diagnostics", result)

    def test_show_activities_returns_list(self):
        result = inspect_parser_analysis(
            _five_hour_driving_payload()["parserAnalysis"],
            show_activities=True,
        )
        self.assertIn("activities", result)
        self.assertIn("diagnostics", result)
        self.assertEqual(len(result["activities"]), 1)
        a = result["activities"][0]
        self.assertEqual(a["type"], "DRIVING")
        self.assertEqual(a["durationMinutes"], 300)
        self.assertEqual(a["driverId"], "PL123")
        self.assertIn("flags", a)
        for k in (
            "isManualEntry", "isOutOfScope", "isFerryTrain", "isMultiManning"
        ):
            self.assertIn(k, a["flags"])

    def test_activities_sorted_by_start(self):
        # Provide activities out of order — adapter preserves what we pass,
        # service then sorts.
        payload = {
            "driver_info": {"card_number": "X"},
            "timeline": [
                [_iso(2026, 5, 11, 9, 0), _iso(2026, 5, 11, 10, 0), 3, False],
                [_iso(2026, 5, 11, 6, 0), _iso(2026, 5, 11, 7, 0), 3, False],
                [_iso(2026, 5, 11, 7, 0), _iso(2026, 5, 11, 8, 0), 0, False],
            ],
        }
        result = inspect_parser_analysis(payload, show_activities=True)
        starts = [a["start"] for a in result["activities"]]
        self.assertEqual(starts, sorted(starts))
        # Indices are 0..N-1 in chronological order.
        self.assertEqual(
            [a["index"] for a in result["activities"]],
            list(range(len(result["activities"]))),
        )

    def test_unknown_activity_produces_warning(self):
        result = inspect_parser_analysis(
            _payload_with_mixed_types_and_gap_and_invalid()["parserAnalysis"],
            show_activities=True,
        )
        warnings = result["diagnostics"]["warnings"]
        unknowns = [w for w in warnings if w["type"] == "UNKNOWN_ACTIVITY"]
        self.assertEqual(len(unknowns), 1)
        self.assertIn("UNKNOWN", unknowns[0]["message"])

    def test_invalid_time_range_produces_warning(self):
        result = inspect_parser_analysis(
            _payload_with_mixed_types_and_gap_and_invalid()["parserAnalysis"],
            show_activities=True,
        )
        warnings = result["diagnostics"]["warnings"]
        invalids = [w for w in warnings if w["type"] == "INVALID_TIME_RANGE"]
        self.assertEqual(len(invalids), 1)
        # The invalid entry is index 3 in the raw input.
        self.assertEqual(invalids[0]["index"], 3)

    def test_gap_warning_above_threshold(self):
        result = inspect_parser_analysis(
            _payload_with_mixed_types_and_gap_and_invalid()["parserAnalysis"],
            show_activities=True,
            gap_warn_minutes=15,
        )
        gaps = [w for w in result["diagnostics"]["warnings"] if w["type"] == "GAP"]
        # Single 30-minute gap between 08:00 and 08:30.
        self.assertEqual(len(gaps), 1)
        self.assertEqual(gaps[0]["durationMinutes"], 30)

    def test_gap_below_threshold_silent(self):
        # 10-min gap with default threshold of 15 -> no warning.
        payload = {
            "driver_info": {"card_number": "X"},
            "timeline": [
                [_iso(2026, 5, 11, 6, 0), _iso(2026, 5, 11, 7, 0), 3, False],
                [_iso(2026, 5, 11, 7, 10), _iso(2026, 5, 11, 8, 0), 3, False],
            ],
        }
        result = inspect_parser_analysis(payload, show_activities=True)
        gaps = [w for w in result["diagnostics"]["warnings"] if w["type"] == "GAP"]
        self.assertEqual(gaps, [])

    def test_input_is_not_mutated(self):
        payload = _payload_with_mixed_types_and_gap_and_invalid()
        snapshot = copy.deepcopy(payload)
        inspect_parser_analysis(
            payload["parserAnalysis"], show_activities=True
        )
        self.assertEqual(payload, snapshot)

    def test_empty_input_with_show_activities(self):
        result = inspect_parser_analysis({}, show_activities=True)
        self.assertEqual(result["activities"], [])
        self.assertEqual(result["diagnostics"]["warnings"], [])


class ShowActivitiesCliTests(unittest.TestCase):
    def test_inspect_without_flag_omits_activities(self):
        path = _write_temp_json(_five_hour_driving_payload())
        buf = io.StringIO()
        saved = sys.stdout
        sys.stdout = buf
        try:
            rc = dev_eval.main([path, "--inspect"])
        finally:
            sys.stdout = saved
            os.unlink(path)
        self.assertEqual(rc, 0)
        out = json.loads(buf.getvalue())
        self.assertNotIn("activities", out)
        self.assertNotIn("diagnostics", out)

    def test_inspect_with_show_activities_flag(self):
        path = _write_temp_json(
            _payload_with_mixed_types_and_gap_and_invalid()
        )
        buf = io.StringIO()
        saved = sys.stdout
        sys.stdout = buf
        try:
            rc = dev_eval.main([path, "--inspect", "--show-activities"])
        finally:
            sys.stdout = saved
            os.unlink(path)
        self.assertEqual(rc, 0)
        out = json.loads(buf.getvalue())
        self.assertIn("activities", out)
        self.assertGreaterEqual(len(out["activities"]), 1)
        kinds = {w["type"] for w in out["diagnostics"]["warnings"]}
        self.assertIn("UNKNOWN_ACTIVITY", kinds)
        self.assertIn("INVALID_TIME_RANGE", kinds)
        self.assertIn("GAP", kinds)

    def test_gap_threshold_cli_override(self):
        # Bump threshold above 30 -> GAP warning suppressed.
        path = _write_temp_json(
            _payload_with_mixed_types_and_gap_and_invalid()
        )
        buf = io.StringIO()
        saved = sys.stdout
        sys.stdout = buf
        try:
            rc = dev_eval.main([
                path, "--inspect", "--show-activities",
                "--gap-warn-minutes", "60",
            ])
        finally:
            sys.stdout = saved
            os.unlink(path)
        self.assertEqual(rc, 0)
        out = json.loads(buf.getvalue())
        gaps = [
            w for w in out["diagnostics"]["warnings"] if w["type"] == "GAP"
        ]
        self.assertEqual(gaps, [])


if __name__ == "__main__":
    unittest.main()

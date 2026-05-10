"""Tests for the inspect / diagnostic surface.

Covers both the service entry point (``inspect_parser_analysis``) and the
CLI wiring (``dev_eval --inspect``). The same adapter and engine the HTTP
endpoint uses; we don't duplicate rule logic in tests.
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


def _five_hour_payload() -> dict:
    start = datetime(2026, 5, 11, 6, 0, tzinfo=timezone.utc)
    return {
        "countryProfile": "DE",
        "parserAnalysis": {
            "driver_info": {"card_number": "PL123"},
            "vehicles": [{"vehicle_registration_number": "WX-12345"}],
            "timeline": [
                [
                    start.isoformat(),
                    (start + timedelta(minutes=300)).isoformat(),
                    3,           # DRIVING (core.constants)
                    False,
                ],
            ],
        },
    }


def _mixed_payload_with_unknown() -> dict:
    """DRIVING + REST + UNKNOWN so we can verify byType + dataGaps."""
    start = datetime(2026, 5, 11, 6, 0, tzinfo=timezone.utc)
    return {
        "parserAnalysis": {
            "driver_info": {"card_number": "PL123"},
            "vehicles": [{"vehicle_registration_number": "WX-12345"}],
            "timeline": [
                [
                    start.isoformat(),
                    (start + timedelta(minutes=120)).isoformat(),
                    3, False,    # DRIVING 2h
                ],
                [
                    (start + timedelta(minutes=120)).isoformat(),
                    (start + timedelta(minutes=300)).isoformat(),
                    -1, False,   # UNKNOWN 3h
                ],
                [
                    (start + timedelta(minutes=300)).isoformat(),
                    (start + timedelta(minutes=960)).isoformat(),
                    0, False,    # REST 11h
                ],
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


class InspectServiceTests(unittest.TestCase):
    def test_5h_driving_summary(self):
        payload = _five_hour_payload()
        result = inspect_parser_analysis(payload["parserAnalysis"])
        self.assertEqual(result["countryProfile"], "DE")
        summary = result["activitySummary"]
        self.assertEqual(summary["count"], 1)
        self.assertEqual(summary["byType"]["DRIVING"]["count"], 1)
        self.assertEqual(summary["byType"]["DRIVING"]["minutes"], 300)
        self.assertEqual(summary["byType"]["REST"]["minutes"], 0)
        self.assertEqual(summary["byType"]["UNKNOWN"]["minutes"], 0)

        # Period covers exactly the single 5h slice.
        self.assertEqual(
            summary["periodStart"], "2026-05-11T06:00:00+00:00"
        )
        self.assertEqual(
            summary["periodEnd"], "2026-05-11T11:00:00+00:00"
        )

        # Driver / vehicle propagated through the adapter.
        self.assertEqual(result["driver"]["driverId"], "PL123")
        self.assertEqual(result["driver"]["vehicleId"], "WX-12345")

    def test_5h_driving_triggers_continuous_violation(self):
        # A single 5h-driving slice triggers the 4h30 rule and, because
        # there is no recognisable weekly rest in the surrounding week,
        # the weekly-rest "missing" warning. The inspect summary should
        # tally both deterministically.
        payload = _five_hour_payload()
        result = inspect_parser_analysis(payload["parserAnalysis"])
        vs = result["violationsSummary"]
        self.assertGreaterEqual(vs["count"], 1)
        self.assertEqual(vs["byRule"].get("EU_561_CONTINUOUS_DRIVING"), 1)
        # All severity buckets present even when zero.
        for level in ("INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"):
            self.assertIn(level, vs["bySeverity"])
        self.assertEqual(sum(vs["bySeverity"].values()), vs["count"])

    def test_unknown_window_surfaces_in_summary_and_gaps(self):
        payload = _mixed_payload_with_unknown()
        result = inspect_parser_analysis(payload["parserAnalysis"])
        by_type = result["activitySummary"]["byType"]
        self.assertEqual(by_type["DRIVING"]["minutes"], 120)
        self.assertEqual(by_type["UNKNOWN"]["minutes"], 180)
        self.assertEqual(by_type["REST"]["minutes"], 660)
        # The 3h UNKNOWN window is over the 30-min default threshold and
        # should show up as a data gap.
        self.assertGreaterEqual(result["dataGaps"]["count"], 1)

    def test_empty_input_returns_empty_diagnostics(self):
        result = inspect_parser_analysis({})
        self.assertEqual(result["activitySummary"]["count"], 0)
        self.assertEqual(result["violationsSummary"]["count"], 0)
        self.assertEqual(result["dataGaps"]["count"], 0)
        self.assertEqual(result["violations"], [])
        self.assertIsNone(result["activitySummary"]["periodStart"])
        self.assertIsNone(result["activitySummary"]["periodEnd"])

    def test_input_is_not_mutated(self):
        payload = _five_hour_payload()
        snapshot = copy.deepcopy(payload)
        inspect_parser_analysis(payload["parserAnalysis"])
        self.assertEqual(payload, snapshot)


class InspectCliTests(unittest.TestCase):
    def test_inspect_flag_prints_diagnostic_shape(self):
        path = _write_temp_json(_five_hour_payload())
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
        self.assertIn("activitySummary", out)
        self.assertIn("violationsSummary", out)
        self.assertEqual(
            out["activitySummary"]["byType"]["DRIVING"]["minutes"], 300
        )
        self.assertEqual(
            out["violationsSummary"]["byRule"].get("EU_561_CONTINUOUS_DRIVING"),
            1,
        )

    def test_inspect_writes_to_output_file(self):
        in_path = _write_temp_json(_five_hour_payload())
        out_path = in_path + ".out.json"
        try:
            rc = dev_eval.main([in_path, "--inspect", "-o", out_path])
            self.assertEqual(rc, 0)
            out = json.loads(Path(out_path).read_text(encoding="utf-8"))
            self.assertEqual(out["activitySummary"]["count"], 1)
            self.assertIn("dataGaps", out)
        finally:
            os.unlink(in_path)
            if os.path.exists(out_path):
                os.unlink(out_path)

    def test_inspect_function_directly(self):
        path = _write_temp_json(_five_hour_payload())
        try:
            result = dev_eval.inspect(path)
        finally:
            os.unlink(path)
        self.assertEqual(result["countryProfile"], "DE")
        self.assertEqual(
            result["activitySummary"]["byType"]["DRIVING"]["minutes"], 300
        )


if __name__ == "__main__":
    unittest.main()

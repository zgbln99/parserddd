"""Integration: parser-shaped input -> service -> Violation[].

We exercise the service entry point with two flavours of input:

1. A dict carrying ``timeline`` / ``driver_info`` / ``vehicles`` (the
   shape one could assemble from existing helpers without re-parsing).
2. A 5-hour-continuous-driving scenario must produce a
   ``EU_561_CONTINUOUS_DRIVING`` violation with the expected
   ``actualMinutes`` / ``limitMinutes`` / ``excessMinutes``.

The test does **not** touch the parser or hour calculation. It builds a
synthetic timeline tuple list that has the same shape the parser already
emits.
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.compliance.service import (
    evaluate_parser_analysis_for_violations,
)
from core.constants import DRIVING as C_DRIVING

UTC = timezone.utc


class ServiceIntegrationTests(unittest.TestCase):
    def test_continuous_driving_5h_flags_violation(self):
        start = datetime(2026, 5, 11, 6, 0, tzinfo=UTC)
        parser_analysis = {
            "driver_info": {"card_number": "PL123"},
            "vehicles": [{"vehicle_registration_number": "WX-12345"}],
            "timeline": [
                (start, start + timedelta(minutes=300), C_DRIVING, False),
            ],
        }

        result = evaluate_parser_analysis_for_violations(parser_analysis)

        self.assertEqual(result["countryProfile"], "DE")
        codes = [v["ruleCode"] for v in result["violations"]]
        self.assertIn("EU_561_CONTINUOUS_DRIVING", codes)

        cont = next(
            v for v in result["violations"]
            if v["ruleCode"] == "EU_561_CONTINUOUS_DRIVING"
        )
        self.assertEqual(cont["actualMinutes"], 300)
        self.assertEqual(cont["limitMinutes"], 270)
        self.assertEqual(cont["excessMinutes"], 30)
        self.assertEqual(cont["driverId"], "PL123")
        self.assertEqual(cont["vehicleId"], "WX-12345")

    def test_empty_input_returns_empty_list(self):
        self.assertEqual(
            evaluate_parser_analysis_for_violations({})["violations"], []
        )
        self.assertEqual(
            evaluate_parser_analysis_for_violations(
                {"timeline": []}
            )["violations"],
            [],
        )

    def test_include_events_renders_webhook_payloads(self):
        start = datetime(2026, 5, 11, 6, 0, tzinfo=UTC)
        parser_analysis = {
            "driver_info": {"card_number": "PL123"},
            "timeline": [
                (start, start + timedelta(minutes=300), C_DRIVING, False),
            ],
        }
        result = evaluate_parser_analysis_for_violations(
            parser_analysis, include_events=True
        )
        self.assertTrue(result["events"])
        ev = result["events"][0]
        self.assertEqual(ev["event"], "tachograph.violation.detected")
        self.assertEqual(ev["countryProfile"], "DE")
        self.assertIn("violation", ev)


if __name__ == "__main__":
    unittest.main()

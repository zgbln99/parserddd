"""Engine integration + webhook-event builder."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from backend.compliance import (
    ComplianceEngine,
    DE_PROFILE,
    Severity,
    build_webhook_event,
)
from backend.compliance.rules.continuous_driving import CODE as CONT_CODE
from backend.tests.compliance._factories import at, driving


class EngineTests(unittest.TestCase):
    def test_default_profile_is_de(self):
        e = ComplianceEngine()
        self.assertEqual(e.profile.code, "DE")
        self.assertEqual(e.profile.enforcement_authority, "BALM")

    def test_empty_input_returns_empty_list(self):
        e = ComplianceEngine()
        self.assertEqual(e.evaluate([]), [])

    def test_violations_grouped_per_driver(self):
        e = ComplianceEngine()
        acts = [
            driving(at(2026, 5, 11, 6, 0), 300, driver_id="A"),
            driving(at(2026, 5, 11, 6, 0), 300, driver_id="B"),
        ]
        out = e.evaluate(acts)
        drivers = {v.driver_id for v in out if v.rule_code == CONT_CODE}
        self.assertEqual(drivers, {"A", "B"})


class WebhookTests(unittest.TestCase):
    def test_event_shape(self):
        e = ComplianceEngine(profile=DE_PROFILE)
        v = e.evaluate([driving(at(2026, 5, 11, 6, 0), 300)])[0]
        ev = build_webhook_event(v)
        self.assertEqual(ev["event"], "tachograph.violation.detected")
        self.assertEqual(ev["countryProfile"], "DE")
        self.assertEqual(ev["severity"], v.severity.value)
        self.assertIn("violation", ev)
        self.assertEqual(ev["violation"]["ruleCode"], v.rule_code)


if __name__ == "__main__":
    unittest.main()

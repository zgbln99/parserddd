"""Continuous-driving (4h30) scenarios from the spec."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from backend.compliance import ComplianceEngine
from backend.compliance.models import ActivityType, Severity
from backend.compliance.rules.continuous_driving import CODE
from backend.tests.compliance._factories import (
    at,
    chain,
    driving,
    break_,
    rest,
)


class ContinuousDrivingTests(unittest.TestCase):
    def setUp(self):
        self.engine = ComplianceEngine()

    def _violations(self, activities):
        return [v for v in self.engine.evaluate(activities) if v.rule_code == CODE]

    def test_4h29_no_violation(self):
        acts = [driving(at(2026, 5, 11, 6, 0), 269)]
        self.assertEqual(self._violations(acts), [])

    def test_4h31_violation(self):
        acts = [driving(at(2026, 5, 11, 6, 0), 271)]
        v = self._violations(acts)
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].actual_minutes, 271)
        self.assertEqual(v[0].limit_minutes, 270)
        self.assertEqual(v[0].excess_minutes, 1)

    def test_4h30_then_45_break_then_drive_no_violation(self):
        acts = chain(at(2026, 5, 11, 6, 0), [
            (ActivityType.DRIVING, 270),
            (ActivityType.BREAK, 45),
            (ActivityType.DRIVING, 120),
        ])
        self.assertEqual(self._violations(acts), [])

    def test_valid_split_15_then_30_no_violation(self):
        acts = chain(at(2026, 5, 11, 6, 0), [
            (ActivityType.DRIVING, 120),   # 2h
            (ActivityType.BREAK, 15),
            (ActivityType.DRIVING, 150),   # 2h30
            (ActivityType.BREAK, 30),
            (ActivityType.DRIVING, 60),
        ])
        self.assertEqual(self._violations(acts), [])

    def test_invalid_split_30_then_15_violation(self):
        # 30 + 15 doesn't reset; total driving 120 + 150 + 60 = 330 > 270.
        acts = chain(at(2026, 5, 11, 6, 0), [
            (ActivityType.DRIVING, 120),
            (ActivityType.BREAK, 30),
            (ActivityType.DRIVING, 150),
            (ActivityType.BREAK, 15),
            (ActivityType.DRIVING, 60),
        ])
        v = self._violations(acts)
        self.assertGreaterEqual(len(v), 1)
        self.assertGreater(v[0].actual_minutes, 270)

    def test_5h_driving_violation_with_30_excess(self):
        acts = [driving(at(2026, 5, 11, 6, 0), 300)]
        v = self._violations(acts)
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].excess_minutes, 30)
        self.assertEqual(v[0].severity, Severity.HIGH)

    def test_severity_scale(self):
        cases = [
            (271, Severity.MEDIUM),
            (285, Severity.MEDIUM),    # +15
            (290, Severity.HIGH),      # +20
            (300, Severity.HIGH),      # +30
            (320, Severity.CRITICAL),  # +50
        ]
        for total, want in cases:
            with self.subTest(total=total):
                v = self._violations([driving(at(2026, 5, 11, 6, 0), total)])
                self.assertEqual(v[0].severity, want)

    def test_evidence_present(self):
        acts = [driving(at(2026, 5, 11, 6, 0), 300)]
        v = self._violations(acts)[0]
        self.assertTrue(v.evidence)
        self.assertEqual(v.evidence[0].activity_type, "DRIVING")


if __name__ == "__main__":
    unittest.main()

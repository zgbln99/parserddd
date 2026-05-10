"""Data-gap / missing-card warnings."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from backend.compliance import ComplianceEngine
from backend.compliance.models import Severity
from backend.compliance.rules.missing_card_or_data_gap import CODE
from backend.tests.compliance._factories import (
    at,
    driving,
    rest,
    unknown,
)


class DataGapTests(unittest.TestCase):
    def setUp(self):
        self.engine = ComplianceEngine()

    def _by_code(self, activities, code):
        return [v for v in self.engine.evaluate(activities) if v.rule_code == code]

    def test_short_gap_below_threshold(self):
        acts = [
            driving(at(2026, 5, 11, 6, 0), 60),
            # 5-min gap (below 30-min default threshold)
            driving(at(2026, 5, 11, 7, 5), 60),
        ]
        self.assertEqual(self._by_code(acts, CODE), [])

    def test_long_gap_warning(self):
        acts = [
            driving(at(2026, 5, 11, 6, 0), 60),
            driving(at(2026, 5, 11, 9, 0), 60),  # 2h gap
        ]
        v = self._by_code(acts, CODE)
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].severity, Severity.MEDIUM)
        self.assertTrue(v[0].extra.get("requiresVerification"))

    def test_unknown_activity_emits_warning(self):
        acts = [
            driving(at(2026, 5, 11, 6, 0), 60),
            unknown(at(2026, 5, 11, 7, 0), 90),
            driving(at(2026, 5, 11, 8, 30), 60),
        ]
        v = self._by_code(acts, CODE)
        # Should at least flag the UNKNOWN window.
        self.assertGreaterEqual(len(v), 1)
        kinds = {ev.activity_type for vio in v for ev in vio.evidence}
        self.assertIn("UNKNOWN", kinds)

    def test_huge_gap_escalates_to_high(self):
        acts = [
            driving(at(2026, 5, 11, 6, 0), 60),
            driving(at(2026, 5, 11, 14, 0), 60),  # 7h gap
        ]
        v = self._by_code(acts, CODE)
        self.assertEqual(v[0].severity, Severity.HIGH)


if __name__ == "__main__":
    unittest.main()

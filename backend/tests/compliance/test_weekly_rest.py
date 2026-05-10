"""Weekly rest scenarios."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from datetime import timedelta

from backend.compliance import ComplianceEngine
from backend.compliance.rules.weekly_rest import (
    CODE_MISSING,
    CODE_REDUCED,
    CODE_SHORT,
)
from backend.tests.compliance._factories import at, driving, rest


def _week_with_driving_and_weekly_rest(monday_6, weekly_rest_minutes):
    acts = []
    # 5 days of 8h driving + 11h rest each. A small driving slice precedes
    # the weekly rest so the weekly rest stays its own RestPeriod (not
    # coalesced with the trailing daily rest).
    cur = monday_6
    for _ in range(5):
        acts.append(driving(cur, 480))
        cur = cur + timedelta(minutes=480)
        acts.append(rest(cur, 660))
        cur = cur + timedelta(minutes=660)
    acts.append(driving(cur, 30))
    cur = cur + timedelta(minutes=30)
    acts.append(rest(cur, weekly_rest_minutes))
    return acts


class WeeklyRestTests(unittest.TestCase):
    def setUp(self):
        self.engine = ComplianceEngine()

    def _by_code(self, activities, code):
        return [v for v in self.engine.evaluate(activities) if v.rule_code == code]

    def test_45h_no_violation(self):
        acts = _week_with_driving_and_weekly_rest(at(2026, 5, 11, 6, 0), 45 * 60)
        self.assertEqual(self._by_code(acts, CODE_SHORT), [])
        self.assertEqual(self._by_code(acts, CODE_REDUCED), [])

    def test_30h_reduced_compensation_required(self):
        acts = _week_with_driving_and_weekly_rest(at(2026, 5, 11, 6, 0), 30 * 60)
        v = self._by_code(acts, CODE_REDUCED)
        self.assertEqual(len(v), 1)
        self.assertTrue(v[0].extra.get("compensationRequired"))

    def test_23h59_short_violation(self):
        acts = _week_with_driving_and_weekly_rest(at(2026, 5, 11, 6, 0), 24 * 60 - 1)
        v = self._by_code(acts, CODE_SHORT)
        self.assertEqual(len(v), 1)

    def test_no_weekly_rest_warning(self):
        # Drive every day, never rest more than the 11h daily window.
        acts = []
        cur = at(2026, 5, 11, 6, 0)
        for _ in range(7):
            acts.append(driving(cur, 480))
            cur = cur + timedelta(minutes=480)
            acts.append(rest(cur, 660))
            cur = cur + timedelta(minutes=660)
        v = self._by_code(acts, CODE_MISSING)
        self.assertGreaterEqual(len(v), 1)
        self.assertTrue(v[0].extra.get("requiresVerification"))


if __name__ == "__main__":
    unittest.main()

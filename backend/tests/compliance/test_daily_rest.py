"""Daily rest scenarios."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from datetime import timedelta

from backend.compliance import ComplianceEngine
from backend.compliance.rules.daily_rest import (
    CODE_REDUCED_LIMIT,
    CODE_SHORT,
)
from backend.tests.compliance._factories import at, driving, rest


class DailyRestTests(unittest.TestCase):
    def setUp(self):
        self.engine = ComplianceEngine()

    def _by_code(self, activities, code):
        return [v for v in self.engine.evaluate(activities) if v.rule_code == code]

    def test_11h_rest_no_violation(self):
        acts = [
            driving(at(2026, 5, 11, 6, 0), 240),
            rest(at(2026, 5, 11, 10, 0), 660),
        ]
        self.assertEqual(self._by_code(acts, CODE_SHORT), [])

    def test_9h30_rest_no_violation_within_allowance(self):
        acts = [
            driving(at(2026, 5, 11, 6, 0), 240),
            rest(at(2026, 5, 11, 10, 0), 570),
        ]
        self.assertEqual(self._by_code(acts, CODE_SHORT), [])

    def test_short_pause_during_shift_is_not_a_daily_rest_violation(self):
        # 7-minute pause between two driving segments. Without the
        # candidate-floor guard, this would be reported as "daily rest
        # too short" — a false positive that drove the office crazy.
        acts = [
            driving(at(2026, 5, 11, 6, 0), 60),
            rest(at(2026, 5, 11, 7, 0), 7),
            driving(at(2026, 5, 11, 7, 7), 120),
        ]
        self.assertEqual(self._by_code(acts, CODE_SHORT), [])

    def test_3h_pause_still_not_a_daily_rest_violation(self):
        # 3h rest in the middle of a long shift — still well below the
        # 4h floor so we don't pretend it's a daily-rest attempt.
        acts = [
            driving(at(2026, 5, 11, 6, 0), 240),
            rest(at(2026, 5, 11, 10, 0), 180),     # 3h
            driving(at(2026, 5, 11, 13, 0), 60),
        ]
        self.assertEqual(self._by_code(acts, CODE_SHORT), [])

    def test_8h59_rest_violation(self):
        acts = [
            driving(at(2026, 5, 11, 6, 0), 240),
            rest(at(2026, 5, 11, 10, 0), 539),
        ]
        v = self._by_code(acts, CODE_SHORT)
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].actual_minutes, 539)

    def test_four_reduced_rests_between_weekly_rests_violation(self):
        # 4 reduced rests of 9h30, tightly packed; then a trailing 1-min
        # activity 8 days after start so total coverage exceeds 7 days
        # and the rule has enough context to assert the count.
        acts = []
        cur = at(2026, 5, 11, 6, 0)
        for _ in range(4):
            acts.append(driving(cur, 240))      # 4h
            cur = cur + timedelta(minutes=240)
            acts.append(rest(cur, 570))         # 9h30 reduced
            cur = cur + timedelta(minutes=570)
        acts.append(driving(at(2026, 5, 11, 6, 0) + timedelta(days=8), 1))
        v = self._by_code(acts, CODE_REDUCED_LIMIT)
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].actual_minutes, 4)
        self.assertEqual(v[0].limit_minutes, 3)


if __name__ == "__main__":
    unittest.main()

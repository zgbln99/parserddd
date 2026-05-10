"""Weekly (56h) and fortnightly (90h) driving."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from datetime import timedelta

from backend.compliance import ComplianceEngine
from backend.compliance.rules.weekly_driving import CODE as WEEKLY_CODE
from backend.compliance.rules.fortnightly_driving import CODE as FORTNIGHT_CODE
from backend.tests.compliance._factories import at, driving, rest


def _spread_driving(week_monday_6, total_minutes):
    """Spread driving across 7 days, 1h gap of REST between each chunk."""
    acts = []
    per_day = total_minutes // 7
    leftover = total_minutes - per_day * 7
    for d in range(7):
        start = week_monday_6 + timedelta(days=d)
        minutes = per_day + (leftover if d == 6 else 0)
        if minutes > 0:
            acts.append(driving(start, minutes))
            acts.append(rest(start + timedelta(minutes=minutes), 720))
    return acts


class WeeklyDrivingTests(unittest.TestCase):
    def setUp(self):
        self.engine = ComplianceEngine()

    def _by_code(self, activities, code):
        return [v for v in self.engine.evaluate(activities) if v.rule_code == code]

    def test_exactly_56h_no_violation(self):
        # Monday 2026-05-11.
        acts = _spread_driving(at(2026, 5, 11, 6, 0), 56 * 60)
        self.assertEqual(self._by_code(acts, WEEKLY_CODE), [])

    def test_56h01_violation(self):
        acts = _spread_driving(at(2026, 5, 11, 6, 0), 56 * 60 + 1)
        v = self._by_code(acts, WEEKLY_CODE)
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].excess_minutes, 1)


class FortnightlyDrivingTests(unittest.TestCase):
    def setUp(self):
        self.engine = ComplianceEngine()

    def _by_code(self, activities, code):
        return [v for v in self.engine.evaluate(activities) if v.rule_code == code]

    def test_exactly_90h_no_violation(self):
        week1 = _spread_driving(at(2026, 5, 11, 6, 0), 45 * 60)
        week2 = _spread_driving(at(2026, 5, 18, 6, 0), 45 * 60)
        self.assertEqual(self._by_code(week1 + week2, FORTNIGHT_CODE), [])

    def test_90h01_violation(self):
        week1 = _spread_driving(at(2026, 5, 11, 6, 0), 45 * 60)
        week2 = _spread_driving(at(2026, 5, 18, 6, 0), 45 * 60 + 1)
        v = self._by_code(week1 + week2, FORTNIGHT_CODE)
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].excess_minutes, 1)


if __name__ == "__main__":
    unittest.main()

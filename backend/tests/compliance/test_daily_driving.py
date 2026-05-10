"""Daily driving (Art. 6(1))."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from datetime import timedelta

from backend.compliance import ComplianceEngine
from backend.compliance.models import ActivityType
from backend.compliance.rules.daily_driving import CODE, CODE_TOO_MANY_EXT
from backend.tests.compliance._factories import (
    at,
    chain,
    driving,
    rest,
)


class DailyDrivingTests(unittest.TestCase):
    def setUp(self):
        self.engine = ComplianceEngine()

    def _by_code(self, activities, code):
        return [v for v in self.engine.evaluate(activities) if v.rule_code == code]

    def test_8h59_no_violation(self):
        acts = [driving(at(2026, 5, 11, 6, 0), 539)]
        self.assertEqual(self._by_code(acts, CODE), [])

    def test_9h30_extension_no_violation(self):
        acts = [driving(at(2026, 5, 11, 6, 0), 570)]
        self.assertEqual(self._by_code(acts, CODE), [])

    def test_10h01_violation(self):
        acts = [driving(at(2026, 5, 11, 6, 0), 601)]
        v = self._by_code(acts, CODE)
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].excess_minutes, 1)

    def test_three_extensions_in_a_week_violation(self):
        # Mon, Tue, Wed each at 9h30. Plus a long rest separating days so
        # the daily summary buckets correctly.
        acts = []
        for day_offset in (0, 1, 2):
            day_start = at(2026, 5, 11, 6, 0) + timedelta(days=day_offset)
            acts.append(driving(day_start, 570))
            acts.append(rest(day_start + timedelta(minutes=570), 720))  # 12h rest
        v = self._by_code(acts, CODE_TOO_MANY_EXT)
        self.assertEqual(len(v), 1)
        self.assertEqual(v[0].actual_minutes, 3)
        self.assertEqual(v[0].limit_minutes, 2)


if __name__ == "__main__":
    unittest.main()

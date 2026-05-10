"""Tests for partial-data behaviour.

When the analysis window is shorter than a transport week (or a fortnight),
rules that depend on that window should abstain rather than emit false
positives. The single-source-of-truth for the coverage signal is
``ComplianceFacts.coverage``.
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from backend.compliance import ComplianceEngine
from backend.compliance.rules.continuous_driving import CODE as CONT_CODE
from backend.compliance.rules.fortnightly_driving import CODE as FORTNIGHT_CODE
from backend.compliance.rules.weekly_rest import CODE_MISSING as WK_MISSING
from backend.compliance.service import inspect_parser_analysis
from backend.tests.compliance._factories import at, driving, rest


class WeeklyRestMissingPartialPeriodTests(unittest.TestCase):
    def setUp(self):
        self.engine = ComplianceEngine()

    def _codes(self, activities):
        return [v.rule_code for v in self.engine.evaluate(activities)]

    def test_5h_driving_does_not_trigger_weekly_rest_missing(self):
        acts = [driving(at(2026, 5, 11, 6, 0), 300)]
        codes = self._codes(acts)
        self.assertIn(CONT_CODE, codes)
        self.assertNotIn(WK_MISSING, codes)

    def test_short_window_fortnightly_rule_abstains(self):
        # Two weeks' worth of driving but the wall-clock span is < 14
        # days; the fortnightly rule should not fire.
        acts = [driving(at(2026, 5, 11, 6, 0), 91 * 60)]  # 91h in one slice
        self.assertNotIn(FORTNIGHT_CODE, self._codes(acts))


class InspectCoverageTests(unittest.TestCase):
    def test_coverage_block_for_5h_payload(self):
        from datetime import datetime, timezone
        start = datetime(2026, 5, 11, 6, 0, tzinfo=timezone.utc)
        parser_analysis = {
            "driver_info": {"card_number": "PL123"},
            "vehicles": [{"vehicle_registration_number": "WX-12345"}],
            "timeline": [
                (start, start + timedelta(minutes=300), 3, False),
            ],
        }
        result = inspect_parser_analysis(parser_analysis)
        cov = result["coverage"]
        self.assertLess(cov["days"], 1.0)
        self.assertEqual(cov["minutes"], 300)
        self.assertFalse(cov["sufficientForWeeklyRules"])
        self.assertFalse(cov["sufficientForFortnightlyRules"])

        # The whole point of the coverage signal: weekly-rest MISSING
        # must not be emitted for a sub-day window.
        codes = [v["ruleCode"] for v in result["violations"]]
        self.assertNotIn(WK_MISSING, codes)
        self.assertIn(CONT_CODE, codes)

    def test_coverage_block_for_two_week_payload(self):
        from datetime import datetime, timezone
        start = datetime(2026, 5, 11, 6, 0, tzinfo=timezone.utc)
        # Trivial 1-hour-per-day driving across 15 wall-clock days.
        timeline = []
        for d in range(15):
            day = start + timedelta(days=d)
            timeline.append((day, day + timedelta(minutes=60), 3, False))
        parser_analysis = {
            "driver_info": {"card_number": "PL123"},
            "timeline": timeline,
        }
        result = inspect_parser_analysis(parser_analysis)
        cov = result["coverage"]
        self.assertGreaterEqual(cov["days"], 14.0)
        self.assertTrue(cov["sufficientForWeeklyRules"])
        self.assertTrue(cov["sufficientForFortnightlyRules"])


class SufficientWindowFortnightlyTests(unittest.TestCase):
    def test_15_day_span_with_91h_driving_in_one_pair_triggers(self):
        # Build 15 calendar days. The first 14 contain 6.5h driving each
        # (= 91h across two weeks), the 15th day is a 1-minute marker so
        # the span genuinely reaches 14 days of wall-clock coverage AND
        # there are two consecutive transport weeks of driving.
        engine = ComplianceEngine()
        acts = []
        for d in range(14):
            day = at(2026, 5, 11, 6, 0) + timedelta(days=d)
            acts.append(driving(day, 390))     # 6h30
            acts.append(rest(day + timedelta(minutes=390), 660))
        acts.append(driving(at(2026, 5, 11, 6, 0) + timedelta(days=14, minutes=1), 1))
        codes = [v.rule_code for v in engine.evaluate(acts)]
        self.assertIn(FORTNIGHT_CODE, codes)


if __name__ == "__main__":
    unittest.main()

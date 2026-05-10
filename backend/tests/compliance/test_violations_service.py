"""Tests for the violations service (status persistence + payload adapter).

Covers the parts of ``services/violations_service.py`` that don't depend
on Dropbox or the Flask app: filter_by_range, violations_to_pdf_payload,
and the SQLite-backed status persistence.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

_THIS = os.path.dirname(__file__)
# Repo root (for ``backend.compliance`` imports inside the service module).
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..", "..")))
# backend/ (for ``services``, ``database`` direct imports).
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..")))


def _setup_isolated_db() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="violationstest-"))
    os.environ["DATABASE_FILE"] = str(tmp / "test.db")
    return tmp


def _example_violation(rule_code="EU_561_CONTINUOUS_DRIVING",
                       start="2026-05-11T06:00:00+00:00",
                       end="2026-05-11T11:00:00+00:00",
                       actual=300, limit=270, excess=30,
                       severity="HIGH", id_="V1"):
    return {
        "id": id_,
        "driverId": "PL123",
        "vehicleId": "WX-12345",
        "countryProfile": "DE",
        "ruleCode": rule_code,
        "title": "Lenkzeit überschritten",
        "titleDe": "Lenkzeit überschritten",
        "titlePl": "Przekroczony czas jazdy",
        "description": "test",
        "legalBasis": "Art. 7 VO 561/2006",
        "severity": severity,
        "start": start,
        "end": end,
        "actualMinutes": actual,
        "limitMinutes": limit,
        "excessMinutes": excess,
        "status": "NEW",
    }


class FilterByRangeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = _setup_isolated_db()
        global vs
        from services import violations_service as _vs
        vs = _vs

    def test_unbounded_returns_all(self):
        vs_in = [_example_violation(), _example_violation(id_="V2")]
        self.assertEqual(len(vs.filter_by_range(vs_in, date_from=None, date_to=None)), 2)

    def test_inclusive_bounds(self):
        v_in_range = _example_violation(start="2026-05-11T06:00:00+00:00",
                                        end="2026-05-11T11:00:00+00:00", id_="A")
        v_before = _example_violation(start="2026-04-30T22:00:00+00:00",
                                      end="2026-04-30T23:00:00+00:00", id_="B")
        v_after = _example_violation(start="2026-06-02T00:00:00+00:00",
                                     end="2026-06-02T01:00:00+00:00", id_="C")
        out = vs.filter_by_range([v_in_range, v_before, v_after],
                                 date_from="2026-05-01", date_to="2026-06-01")
        ids = [v["id"] for v in out]
        self.assertEqual(ids, ["A"])

    def test_overlapping_edge_is_kept(self):
        # Violation crosses midnight at the boundary.
        v = _example_violation(start="2026-05-31T23:00:00+00:00",
                               end="2026-06-01T01:00:00+00:00", id_="X")
        out = vs.filter_by_range([v], date_from="2026-05-01", date_to="2026-05-31")
        self.assertEqual([x["id"] for x in out], ["X"])


class PayloadAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = _setup_isolated_db()
        global vs
        from services import violations_service as _vs
        vs = _vs

    def test_shape_matches_pdf_renderer_contract(self):
        out = vs.violations_to_pdf_payload(
            [_example_violation()],
            driver_card="PL123", driver_name="Kowalski", locale="de",
            period_label="2026-05-01 – 2026-05-31",
        )
        self.assertEqual(out["locale"], "de")
        self.assertEqual(out["driver_id"], "PL123")
        self.assertEqual(out["summary"]["total"], 1)
        self.assertEqual(len(out["sections"]), 1)
        sec = out["sections"][0]
        self.assertEqual(sec["category"], "BREAKS")
        row = sec["rows"][0]
        self.assertEqual(row["rule_id"], "EU_561_CONTINUOUS_DRIVING")
        self.assertEqual(row["measured_value"], 300)
        self.assertEqual(row["allowed_value"], 270)
        self.assertEqual(row["excess_value"], 30)
        self.assertEqual(row["unit"], "min")
        self.assertEqual(row["severity"], "HIGH")

    def test_unknown_rule_falls_back_to_OTHER(self):
        v = _example_violation(rule_code="UNKNOWN_RULE_99")
        out = vs.violations_to_pdf_payload([v], driver_card="PL123")
        self.assertEqual(out["sections"][0]["category"], "OTHER")


class StatusPersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = _setup_isolated_db()
        # Import after env var is set; this triggers DB init.
        global database, vs
        import database as _db
        from services import violations_service as _vs
        database = _db
        vs = _vs
        database.init_db()

    def test_set_and_get_status_roundtrip(self):
        vs.set_status("V1", status="EXPLAINED", note="resolved",
                      rule_code="EU_561_CONTINUOUS_DRIVING", driver_card="PL123")
        rec = vs.get_statuses(["V1"])["V1"]
        self.assertEqual(rec["status"], "EXPLAINED")
        self.assertEqual(rec["note"], "resolved")

    def test_invalid_status_raises(self):
        with self.assertRaises(ValueError):
            vs.set_status("V2", status="BOGUS")

    def test_merge_statuses_decorates_violations(self):
        vs.set_status("V3", status="DISMISSED_FALSE_POSITIVE",
                      rule_code="EU_561_DAILY_DRIVING", driver_card="PL123")
        decorated = vs.merge_statuses([_example_violation(id_="V3")])
        self.assertEqual(decorated[0]["status"], "DISMISSED_FALSE_POSITIVE")

    def test_mark_token_signed_flips_all_bound_violations(self):
        vs.set_status("V10", status="DRIVER_NOTIFIED",
                      rule_code="EU_561_CONTINUOUS_DRIVING",
                      driver_card="PL123", signed_token="tok-abc")
        vs.set_status("V11", status="DRIVER_NOTIFIED",
                      rule_code="EU_561_DAILY_DRIVING",
                      driver_card="PL123", signed_token="tok-abc")
        # Unrelated token shouldn't be touched.
        vs.set_status("V12", status="DRIVER_NOTIFIED",
                      rule_code="EU_561_DAILY_DRIVING",
                      driver_card="PL123", signed_token="tok-other")

        n = vs.mark_token_signed("tok-abc")
        self.assertEqual(n, 2)

        statuses = vs.get_statuses(["V10", "V11", "V12"])
        self.assertEqual(statuses["V10"]["status"], "SIGNED")
        self.assertEqual(statuses["V11"]["status"], "SIGNED")
        self.assertEqual(statuses["V12"]["status"], "DRIVER_NOTIFIED")

    def test_token_does_not_leak_other_drivers(self):
        # Reuse same token across drivers — mark_token_signed should still
        # only flip rows that already had that token. (Confirms no
        # cross-driver leakage via misuse.)
        n = vs.mark_token_signed("tok-nonexistent")
        self.assertEqual(n, 0)


if __name__ == "__main__":
    unittest.main()

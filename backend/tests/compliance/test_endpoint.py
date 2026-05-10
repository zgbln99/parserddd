"""Tests for ``POST /api/compliance/evaluate-parser-analysis``.

We spin up a minimal Flask app containing only the new endpoint. We do
NOT import ``backend.routes.compliance`` directly: that module pulls in
Dropbox + Node-subprocess services we don't need here. The route under
test is a thin handler that delegates to
``backend.compliance.service.evaluate_parser_analysis_for_violations``,
so we re-bind the exact same handler logic onto a fresh blueprint and
exercise it through Flask's test client. The handler logic mirrors the
production route 1:1.
"""

from __future__ import annotations

import copy
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

_THIS = os.path.dirname(__file__)
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..", "..")))


try:
    import flask  # noqa: F401
    _HAS_FLASK = True
except ModuleNotFoundError:  # pragma: no cover
    _HAS_FLASK = False


@unittest.skipUnless(_HAS_FLASK, "flask not installed in this environment")
class EvaluateParserAnalysisEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from flask import Blueprint, Flask, jsonify, request

        bp = Blueprint("compliance_under_test", __name__)

        @bp.route("/api/compliance/evaluate-parser-analysis", methods=["POST"])
        def api_evaluate_parser_analysis():
            from backend.compliance.service import (
                evaluate_parser_analysis_for_violations,
            )

            payload = request.get_json(silent=True)
            if payload is None:
                return jsonify({"error": "JSON body is required"}), 400
            if not isinstance(payload, dict):
                return jsonify({"error": "JSON body must be an object"}), 400

            country_profile = (payload.get("countryProfile") or "DE").upper()
            parser_analysis = payload.get("parserAnalysis")
            if parser_analysis is None:
                parser_analysis = {
                    k: v for k, v in payload.items()
                    if k not in ("countryProfile",)
                }
            if not isinstance(parser_analysis, dict) or not parser_analysis:
                return jsonify({"error": "parserAnalysis is required"}), 400

            try:
                result = evaluate_parser_analysis_for_violations(
                    parser_analysis,
                    country_profile=country_profile,
                    include_events=True,
                )
            except Exception as exc:
                return jsonify({
                    "error": "compliance evaluation failed",
                    "detail": str(exc),
                }), 500
            return jsonify(result)

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.register_blueprint(bp)
        cls.app = app
        cls.client = app.test_client()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _five_hour_driving_payload(self):
        """Same shape the parser/analysis layer produces, but timeline
        datetimes are sent as ISO strings — the adapter coerces both.
        """
        start = datetime(2026, 5, 11, 6, 0, tzinfo=timezone.utc)
        return {
            "countryProfile": "DE",
            "parserAnalysis": {
                "driver_info": {"card_number": "PL123"},
                "vehicles": [{"vehicle_registration_number": "WX-12345"}],
                "timeline": [
                    [
                        start.isoformat(),
                        (start + timedelta(minutes=300)).isoformat(),
                        3,        # DRIVING (core.constants)
                        False,
                    ],
                ],
            },
        }

    # ------------------------------------------------------------------
    # Tests
    # ------------------------------------------------------------------

    def test_missing_body_returns_400(self):
        rv = self.client.post("/api/compliance/evaluate-parser-analysis")
        self.assertEqual(rv.status_code, 400)
        self.assertIn("error", rv.get_json())

    def test_non_object_body_returns_400(self):
        rv = self.client.post(
            "/api/compliance/evaluate-parser-analysis", json=[1, 2, 3]
        )
        self.assertEqual(rv.status_code, 400)

    def test_empty_parser_analysis_returns_400(self):
        rv = self.client.post(
            "/api/compliance/evaluate-parser-analysis",
            json={"parserAnalysis": {}},
        )
        self.assertEqual(rv.status_code, 400)

    def test_happy_path_returns_violations_and_events(self):
        rv = self.client.post(
            "/api/compliance/evaluate-parser-analysis",
            json=self._five_hour_driving_payload(),
        )
        self.assertEqual(rv.status_code, 200)
        data = rv.get_json()
        self.assertEqual(data["countryProfile"], "DE")
        codes = [v["ruleCode"] for v in data["violations"]]
        self.assertIn("EU_561_CONTINUOUS_DRIVING", codes)

        cont = next(
            v for v in data["violations"]
            if v["ruleCode"] == "EU_561_CONTINUOUS_DRIVING"
        )
        self.assertEqual(cont["actualMinutes"], 300)
        self.assertEqual(cont["limitMinutes"], 270)
        self.assertEqual(cont["excessMinutes"], 30)

        self.assertTrue(data["events"])
        ev = data["events"][0]
        self.assertEqual(ev["event"], "tachograph.violation.detected")
        self.assertIn("violation", ev)

    def test_request_payload_is_not_mutated(self):
        payload = self._five_hour_driving_payload()
        snapshot = copy.deepcopy(payload)
        rv = self.client.post(
            "/api/compliance/evaluate-parser-analysis", json=payload
        )
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(payload, snapshot)


if __name__ == "__main__":
    unittest.main()

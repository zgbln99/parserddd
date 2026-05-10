"""Tests for the developer CLI helper ``backend.compliance.dev_eval``.

The helper is intentionally tiny: read JSON, run the service, dump JSON.
We verify both the programmatic ``run()`` and the ``main()`` argv path,
plus the wrapper / unwrapped input shapes.
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

_THIS = os.path.dirname(__file__)
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(_THIS, "..", "..", "..")))

from backend.compliance import dev_eval


def _five_hour_payload() -> dict:
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
                    3,
                    False,
                ],
            ],
        },
    }


def _write_temp_json(payload: dict) -> str:
    fh = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    )
    json.dump(payload, fh)
    fh.close()
    return fh.name


class DevEvalRunTests(unittest.TestCase):
    def test_run_returns_violations_and_events(self):
        path = _write_temp_json(_five_hour_payload())
        try:
            result = dev_eval.run(path)
        finally:
            os.unlink(path)
        self.assertEqual(result["countryProfile"], "DE")
        codes = [v["ruleCode"] for v in result["violations"]]
        self.assertIn("EU_561_CONTINUOUS_DRIVING", codes)
        self.assertTrue(result["events"])

    def test_run_accepts_unwrapped_analysis_dict(self):
        payload = _five_hour_payload()
        # Flatten: drop the parserAnalysis wrapper.
        flattened = {"countryProfile": "DE", **payload["parserAnalysis"]}
        path = _write_temp_json(flattened)
        try:
            result = dev_eval.run(path)
        finally:
            os.unlink(path)
        self.assertEqual(result["countryProfile"], "DE")
        self.assertTrue(
            any(v["ruleCode"] == "EU_561_CONTINUOUS_DRIVING"
                for v in result["violations"])
        )

    def test_run_no_events_flag(self):
        path = _write_temp_json(_five_hour_payload())
        try:
            result = dev_eval.run(path, include_events=False)
        finally:
            os.unlink(path)
        self.assertNotIn("events", result)

    def test_run_rejects_non_object_json(self):
        path = _write_temp_json([1, 2, 3])  # type: ignore[arg-type]
        try:
            with self.assertRaises(ValueError):
                dev_eval.run(path)
        finally:
            os.unlink(path)


class DevEvalMainTests(unittest.TestCase):
    def test_main_writes_to_stdout(self):
        path = _write_temp_json(_five_hour_payload())
        buf = io.StringIO()
        saved = sys.stdout
        sys.stdout = buf
        try:
            rc = dev_eval.main([path])
        finally:
            sys.stdout = saved
            os.unlink(path)
        self.assertEqual(rc, 0)
        out = json.loads(buf.getvalue())
        self.assertEqual(out["countryProfile"], "DE")
        self.assertTrue(out["violations"])

    def test_main_writes_to_output_file(self):
        in_path = _write_temp_json(_five_hour_payload())
        out_path = in_path + ".out.json"
        try:
            rc = dev_eval.main([in_path, "-o", out_path])
            self.assertEqual(rc, 0)
            out = json.loads(Path(out_path).read_text(encoding="utf-8"))
            self.assertIn("violations", out)
            self.assertIn("events", out)
        finally:
            os.unlink(in_path)
            if os.path.exists(out_path):
                os.unlink(out_path)


if __name__ == "__main__":
    unittest.main()

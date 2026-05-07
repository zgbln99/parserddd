"""Tests for the driver-signing token service.

Run with: python3 -m pytest backend/test_sign_service.py -v
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))


def _setup_isolated_db() -> Path:
    """Point the database module at a fresh temp file before any imports."""
    tmp = Path(tempfile.mkdtemp(prefix="signtest-"))
    os.environ["DATABASE_FILE"] = str(tmp / "test.db")
    return tmp


class SignServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = _setup_isolated_db()
        # Import after env is set so the database module picks it up.
        global database, sign_service  # noqa: PLW0603
        import database as _database  # type: ignore[import-not-found]
        from services import sign_service as _sign_service  # type: ignore[import-not-found]
        database = _database
        sign_service = _sign_service
        database.init_db()

    def setUp(self):
        # Clean tokens between tests.
        with database.get_db() as db:
            db.execute("DELETE FROM signing_tokens")
            db.commit()

    def _payload(self) -> dict:
        return {
            "locale": "de",
            "driver_id": "DRV-1",
            "evaluated_at": "2026-03-01T00:00:00Z",
            "summary": {"total": 1, "driver_fine_total_eur": 30, "company_fine_total_eur": 90},
            "sections": [
                {
                    "category": "BREAKS",
                    "heading": "Lenkpausen",
                    "rows": [
                        {
                            "rule_id": "EU_561_ART7_BREAK_AFTER_4H30",
                            "category": "BREAKS",
                            "title": "Fehlende Pause",
                            "legal_basis": "Art. 7 VO (EG) 561/2006",
                            "explanation": "...",
                            "start_time": "2026-03-01T06:00:00Z",
                            "end_time": "2026-03-01T11:00:00Z",
                            "measured_value": 300,
                            "allowed_value": 270,
                            "excess_value": 30,
                            "unit": "minutes",
                            "driver_fine_eur": 30,
                            "company_fine_eur": 90,
                            "status": "pending",
                            "severity": None,
                        },
                    ],
                    "subtotal_driver_eur": 30,
                    "subtotal_company_eur": 90,
                },
            ],
            "not_evaluable": [],
        }

    def test_create_then_get_returns_payload_and_hash(self):
        rec = sign_service.create_token(
            driver_card="DRV-1",
            driver_name="Hans Muster",
            payload=self._payload(),
            locale="de",
        )
        self.assertEqual(rec.driver_name, "Hans Muster")
        self.assertEqual(rec.status, "pending")
        self.assertGreater(len(rec.token), 30)
        self.assertEqual(len(rec.payload_hash), 64)

        fetched = sign_service.get_token(rec.token)
        self.assertEqual(fetched.payload_hash, rec.payload_hash)
        self.assertEqual(fetched.payload["sections"][0]["heading"], "Lenkpausen")

    def test_get_unknown_token_404(self):
        with self.assertRaises(sign_service.SigningError) as ctx:
            sign_service.get_token("does-not-exist")
        self.assertEqual(ctx.exception.status, 404)

    def test_consume_marks_used_and_blocks_reuse(self):
        rec = sign_service.create_token(
            driver_card="DRV-2",
            driver_name="X",
            payload=self._payload(),
        )
        signed = sign_service.consume_token(
            rec.token,
            signature_png_b64="A" * 200,
            signer_name="Hans Muster",
            driver_remark=None,
            ip="127.0.0.1",
            user_agent="pytest",
            pdf_dropbox_path="/Verstoesse-Unterschriften/X/2026-03-01.pdf",
        )
        self.assertEqual(signed.status, "signed")
        self.assertIsNotNone(signed.used_at)

        # Second attempt must be rejected with 410 ("already signed").
        with self.assertRaises(sign_service.SigningError) as ctx:
            sign_service.get_token(rec.token)
        self.assertEqual(ctx.exception.status, 410)

    def test_expired_token_marked_and_410(self):
        rec = sign_service.create_token(
            driver_card="DRV-3",
            driver_name="X",
            payload=self._payload(),
        )
        # Force the row to look expired without sleeping.
        with database.get_db() as db:
            past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
            db.execute(
                "UPDATE signing_tokens SET expires_at = ? WHERE token = ?",
                (past, rec.token),
            )
            db.commit()
        with self.assertRaises(sign_service.SigningError) as ctx:
            sign_service.get_token(rec.token)
        self.assertEqual(ctx.exception.status, 410)
        # Status should now be 'expired' so the admin UI sees it.
        with database.get_db() as db:
            row = db.execute(
                "SELECT status FROM signing_tokens WHERE token = ?",
                (rec.token,),
            ).fetchone()
        self.assertEqual(row["status"], "expired")

    def test_consume_validates_inputs(self):
        rec = sign_service.create_token(
            driver_card="DRV-4",
            driver_name="X",
            payload=self._payload(),
        )
        with self.assertRaises(sign_service.SigningError):
            sign_service.consume_token(
                rec.token,
                signature_png_b64="",
                signer_name="X",
                driver_remark=None,
                ip=None,
                user_agent=None,
                pdf_dropbox_path=None,
            )
        with self.assertRaises(sign_service.SigningError):
            sign_service.consume_token(
                rec.token,
                signature_png_b64="A" * 200,
                signer_name=" ",
                driver_remark=None,
                ip=None,
                user_agent=None,
                pdf_dropbox_path=None,
            )

    def test_create_rejects_unknown_locale(self):
        with self.assertRaises(sign_service.SigningError):
            sign_service.create_token(
                driver_card="DRV",
                driver_name="X",
                payload=self._payload(),
                locale="fr",
            )

    def test_list_tokens_returns_summary_without_payload(self):
        sign_service.create_token(
            driver_card="DRV-A",
            driver_name="A",
            payload=self._payload(),
        )
        sign_service.create_token(
            driver_card="DRV-B",
            driver_name="B",
            payload=self._payload(),
        )
        items = sign_service.list_tokens()
        self.assertEqual(len(items), 2)
        for item in items:
            # The list endpoint must NOT leak the payload or the signature.
            self.assertNotIn("payload_json", item)
            self.assertNotIn("signature_png", item)


if __name__ == "__main__":
    unittest.main()

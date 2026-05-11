"""Per-violation persistence + adapter to the existing sign-link payload shape.

This module is the bridge between the activity-based compliance engine
(``backend.compliance``) and the existing signing infrastructure
(``signing_tokens`` table, ``sign_service``, ``render_signed_pdf``,
``SignPage``).

It does **not** re-implement any rules. It:
* fetches / stores per-violation status (NEW / EXPLAINED / SIGNED / …),
* converts a list of engine ``Violation.to_dict()`` payloads into the
  PdfReport-style payload that the existing signing PDF renderer expects.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

# Make ``backend.compliance`` importable regardless of cwd. See the same
# trick in ``routes/compliance.py``.
_BACKEND_PARENT = str(Path(__file__).resolve().parent.parent.parent)
if _BACKEND_PARENT not in sys.path:
    sys.path.insert(0, _BACKEND_PARENT)

from database import get_db


# ---------------------------------------------------------------------------
# Status persistence
# ---------------------------------------------------------------------------

ALLOWED_STATUSES = {
    "NEW",
    "REVIEWED",
    "EXPLAINED",
    "DRIVER_NOTIFIED",
    "TRAINING_REQUIRED",
    "DISMISSED_FALSE_POSITIVE",
    "SIGNED",
}


def get_statuses(violation_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Return ``{violation_id: {status, note, signed_token, updated_at}}``."""
    ids = [v for v in violation_ids if v]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    with get_db() as db:
        rows = db.execute(
            f"SELECT violation_id, status, note, signed_token, updated_at, "
            f"       updated_by "
            f"FROM violation_statuses WHERE violation_id IN ({placeholders})",
            ids,
        ).fetchall()
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        out[r["violation_id"]] = {
            "status": r["status"],
            "note": r["note"] or "",
            "signedToken": r["signed_token"] or "",
            "updatedAt": r["updated_at"],
            "updatedBy": r["updated_by"] or "",
        }
    return out


def set_status(
    violation_id: str,
    *,
    status: str,
    note: str = "",
    updated_by: str = "",
    rule_code: str = "",
    driver_card: str = "",
    signed_token: Optional[str] = None,
) -> None:
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"invalid status: {status}")
    if not violation_id:
        raise ValueError("violation_id is required")
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        # Upsert. SQLite's "INSERT ... ON CONFLICT ... DO UPDATE" is widely
        # supported (>= 3.24). On older builds the second statement falls
        # back to a manual upsert.
        try:
            db.execute(
                """
                INSERT INTO violation_statuses
                    (violation_id, rule_code, driver_card, status, note,
                     signed_token, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(violation_id) DO UPDATE SET
                    status = excluded.status,
                    note = excluded.note,
                    signed_token = COALESCE(NULLIF(excluded.signed_token, ''),
                                            violation_statuses.signed_token),
                    rule_code = COALESCE(NULLIF(excluded.rule_code, ''),
                                         violation_statuses.rule_code),
                    driver_card = COALESCE(NULLIF(excluded.driver_card, ''),
                                           violation_statuses.driver_card),
                    updated_at = excluded.updated_at,
                    updated_by = excluded.updated_by
                """,
                (
                    violation_id, rule_code, driver_card, status, note,
                    signed_token or "", now, updated_by,
                ),
            )
        except Exception:
            # Fallback for ancient SQLite without UPSERT support.
            existing = db.execute(
                "SELECT id FROM violation_statuses WHERE violation_id = ?",
                (violation_id,),
            ).fetchone()
            if existing:
                db.execute(
                    """
                    UPDATE violation_statuses
                    SET status = ?, note = ?, updated_at = ?, updated_by = ?,
                        signed_token = COALESCE(NULLIF(?, ''), signed_token),
                        rule_code = COALESCE(NULLIF(?, ''), rule_code),
                        driver_card = COALESCE(NULLIF(?, ''), driver_card)
                    WHERE violation_id = ?
                    """,
                    (status, note, now, updated_by, signed_token or "",
                     rule_code, driver_card, violation_id),
                )
            else:
                db.execute(
                    """
                    INSERT INTO violation_statuses
                        (violation_id, rule_code, driver_card, status, note,
                         signed_token, updated_at, updated_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (violation_id, rule_code, driver_card, status, note,
                     signed_token or "", now, updated_by),
                )
        db.commit()


def merge_statuses(violations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Decorate engine violations with persisted ``status`` / ``note``."""
    if not violations:
        return violations
    ids = [v.get("id") for v in violations if v.get("id")]
    persisted = get_statuses(ids)
    for v in violations:
        rec = persisted.get(v.get("id") or "")
        if rec:
            v["status"] = rec["status"]
            if rec.get("note"):
                v["statusNote"] = rec["note"]
            if rec.get("signedToken"):
                v["signedToken"] = rec["signedToken"]
            v["statusUpdatedAt"] = rec["updatedAt"]
    return violations


def mark_token_signed(token: str) -> int:
    """Flip every violation that referenced ``token`` to status SIGNED.

    Returns the number of rows updated.
    """
    if not token:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        cur = db.execute(
            "UPDATE violation_statuses SET status = 'SIGNED', updated_at = ? "
            "WHERE signed_token = ? AND status != 'SIGNED'",
            (now, token),
        )
        db.commit()
        return cur.rowcount or 0


# ---------------------------------------------------------------------------
# Date-range filtering
# ---------------------------------------------------------------------------

def filter_by_range(
    violations: list[dict[str, Any]],
    *,
    date_from: Optional[str],
    date_to: Optional[str],
) -> list[dict[str, Any]]:
    """Keep violations whose [start, end] intersects [date_from, date_to].

    Both bounds are inclusive ISO dates ("YYYY-MM-DD"). When a bound is
    ``None`` it's treated as unbounded.
    """
    if not date_from and not date_to:
        return list(violations)

    lo = _parse_iso_date(date_from, end_of_day=False) if date_from else None
    hi = _parse_iso_date(date_to, end_of_day=True) if date_to else None

    out: list[dict[str, Any]] = []
    for v in violations:
        try:
            v_start = datetime.fromisoformat(v["start"])
            v_end = datetime.fromisoformat(v["end"])
        except (KeyError, ValueError):
            continue
        if lo and v_end < lo:
            continue
        if hi and v_start > hi:
            continue
        out.append(v)
    return out


def _parse_iso_date(s: str, *, end_of_day: bool) -> datetime:
    # Accept "YYYY-MM-DD" only; let datetime raise on garbage.
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    if end_of_day and d.hour == 0 and d.minute == 0:
        d = d.replace(hour=23, minute=59, second=59)
    return d


# ---------------------------------------------------------------------------
# Sign-link payload adapter
# ---------------------------------------------------------------------------

# Mapping of new-engine rule codes to PdfReport categories. The existing
# PDF renderer groups rows by ``category``; we keep the bucketing simple
# (driving / breaks / rest / data quality) — enough for a readable PDF.
_CATEGORY_BY_RULE = {
    "EU_561_CONTINUOUS_DRIVING": ("BREAKS", "Lenkzeitunterbrechung"),
    "EU_561_DAILY_DRIVING": ("DRIVING_TIME", "Tageslenkzeit"),
    "EU_561_DAILY_DRIVING_EXTENSIONS": ("DRIVING_TIME", "Tageslenkzeit"),
    "EU_561_WEEKLY_DRIVING": ("DRIVING_TIME", "Wochenlenkzeit"),
    "EU_561_FORTNIGHTLY_DRIVING": ("DRIVING_TIME", "Doppelwochenlenkzeit"),
    "EU_561_DAILY_REST_SHORT": ("REST", "Tägliche Ruhezeit"),
    "EU_561_DAILY_REST_TOO_MANY_REDUCED": ("REST", "Tägliche Ruhezeit"),
    "EU_561_WEEKLY_REST_MISSING": ("REST", "Wöchentliche Ruhezeit"),
    "EU_561_WEEKLY_REST_SHORT": ("REST", "Wöchentliche Ruhezeit"),
    "EU_561_WEEKLY_REST_REDUCED": ("REST", "Wöchentliche Ruhezeit"),
    "EU_165_MISSING_CARD_OR_DATA_GAP": ("CARD", "Karte / Datenlücken"),
    "DE_MILOG_MINDESTLOHN": ("WORKING_TIME", "Mindestlohn (MiLoG)"),
}

_DEFAULT_CATEGORY = ("OTHER", "Sonstige")


def violations_to_pdf_payload(
    violations: Iterable[Mapping[str, Any]],
    *,
    driver_card: str,
    driver_name: str = "",
    locale: str = "de",
    period_label: str = "",
) -> dict[str, Any]:
    """Convert engine violation dicts into the PdfReport shape.

    The existing ``render_signed_pdf`` reads:
        ``payload['sections'][*]['category']``
        ``payload['sections'][*]['heading']``
        ``payload['sections'][*]['rows'][*]`` with rule_id, title, legal_basis,
        explanation, start_time, end_time, measured_value, allowed_value,
        excess_value, unit, severity, status.

    We map our ``Violation.to_dict()`` fields 1:1 onto that.
    """
    sections_by_cat: dict[str, dict[str, Any]] = {}
    for v in violations:
        rule = v.get("ruleCode") or ""
        cat, heading = _CATEGORY_BY_RULE.get(rule, _DEFAULT_CATEGORY)
        sec = sections_by_cat.setdefault(cat, {
            "category": cat,
            "heading": heading,
            "rows": [],
            "subtotal_driver_eur": None,
            "subtotal_company_eur": None,
        })
        sec["rows"].append({
            "rule_id": rule,
            "category": cat,
            "title": (v.get("titleDe") or v.get("title")
                      or v.get("titlePl") or rule),
            "legal_basis": v.get("legalBasis") or "",
            "explanation": v.get("description") or "",
            "start_time": v.get("start") or "",
            "end_time": v.get("end") or "",
            "measured_value": v.get("actualMinutes"),
            "allowed_value": v.get("limitMinutes"),
            "excess_value": v.get("excessMinutes"),
            "unit": "min",
            "driver_fine_eur": None,
            "company_fine_eur": None,
            "status": v.get("status") or "NEW",
            "severity": v.get("severity") or "MEDIUM",
            "violation_id": v.get("id") or "",
        })

    total = sum(len(s["rows"]) for s in sections_by_cat.values())
    by_category = {k: len(s["rows"]) for k, s in sections_by_cat.items()}

    return {
        "locale": locale,
        "driver_id": driver_card,
        "driver_name": driver_name,
        "period_label": period_label,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total": total,
            "driver_fine_total_eur": None,
            "company_fine_total_eur": None,
            "by_category": by_category,
            "not_evaluable_rule_ids": [],
        },
        "sections": list(sections_by_cat.values()),
        "not_evaluable": [],
    }

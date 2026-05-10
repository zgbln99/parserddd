"""Developer helper: run compliance on a JSON dump of parser analysis.

This is a thin convenience for local experiments — **not** part of the
production runtime. It does no IO beyond reading the input JSON file and
writing the result to stdout (or a chosen path). It does not touch the
parser, the timeline builder, hour calculations, Samsara, Dropbox, or any
database.

Usage::

    python3 -m backend.compliance.dev_eval ./sample_parser_analysis.json
    python3 -m backend.compliance.dev_eval ./payload.json --profile DE
    python3 -m backend.compliance.dev_eval ./payload.json --no-events
    python3 -m backend.compliance.dev_eval ./payload.json -o out.json
    python3 -m backend.compliance.dev_eval ./payload.json --inspect

The input JSON shape mirrors the request body of
``POST /api/compliance/evaluate-parser-analysis``. Either a ``parserAnalysis``
wrapper or the analysis dict at the top level is accepted.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping

from backend.compliance.service import (
    evaluate_parser_analysis_for_violations,
    inspect_parser_analysis,
)


def run(
    input_path: str | Path,
    *,
    country_profile: str = "DE",
    include_events: bool = True,
) -> dict[str, Any]:
    """Load a JSON file and run compliance on its contents.

    Returns the ``{countryProfile, violations[, events]}`` dict.
    """
    parser_analysis, profile = _load_payload(input_path, country_profile)
    return evaluate_parser_analysis_for_violations(
        parser_analysis,
        country_profile=profile,
        include_events=include_events,
    )


def inspect(
    input_path: str | Path,
    *,
    country_profile: str = "DE",
) -> dict[str, Any]:
    """Diagnostic counterpart to :func:`run` — surfaces what the adapter
    and the engine *see* in the input. Reuses the production service so
    no rule logic is duplicated.
    """
    parser_analysis, profile = _load_payload(input_path, country_profile)
    return inspect_parser_analysis(
        parser_analysis,
        country_profile=profile,
    )


def _load_payload(
    input_path: str | Path,
    fallback_profile: str,
) -> tuple[Any, str]:
    path = Path(input_path)
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    parser_analysis = _extract_parser_analysis(payload)
    profile = (
        (payload.get("countryProfile") if isinstance(payload, dict) else None)
        or fallback_profile
    )
    return parser_analysis, str(profile).upper()


def _extract_parser_analysis(payload: Any) -> Mapping[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("input JSON must be an object")
    nested = payload.get("parserAnalysis")
    if isinstance(nested, dict):
        return nested
    # Treat the whole document as the analysis dict (drop top-level
    # ``countryProfile`` if present so we don't pass it through).
    return {k: v for k, v in payload.items() if k != "countryProfile"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="dev_eval",
        description="Run compliance on a JSON dump of parser analysis.",
    )
    parser.add_argument("input", help="path to JSON file with parserAnalysis")
    parser.add_argument(
        "--profile",
        default="DE",
        help="country profile code (default: DE)",
    )
    parser.add_argument(
        "--no-events",
        dest="events",
        action="store_false",
        help="skip the webhook events array",
    )
    parser.add_argument(
        "--inspect",
        action="store_true",
        help=(
            "diagnostic mode — print activity / violation / data-gap "
            "summaries instead of the plain evaluation result"
        ),
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="optional output JSON path (default: stdout)",
    )
    args = parser.parse_args(argv)

    if args.inspect:
        result = inspect(args.input, country_profile=args.profile)
    else:
        result = run(
            args.input,
            country_profile=args.profile,
            include_events=args.events,
        )

    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered + "\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())

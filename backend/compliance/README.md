# `backend.compliance` — tachograph violation engine

Deterministic detector for driver-card / tachograph violations under
EU 561/2006 and EU 165/2014, with a German (BALM) reporting profile.

The module is **independent of the parser, importer and download
machinery**. It consumes a normalised activity list and returns
structured violations.

```
raw DDD / Samsara activity
    -> existing parser / normalizer
    -> NormalizedActivity[]
    -> ComplianceEngine
    -> Violation[]
    -> dashboard / webhook / automation
```

Samsara already pulls card and VU data daily — this engine therefore does
**not** check download deadlines, retention, or any importer concern.

## Quickstart

```python
from backend.compliance import ComplianceEngine, NormalizedActivity, ActivityType
from datetime import datetime
from zoneinfo import ZoneInfo

CET = ZoneInfo("Europe/Berlin")
activities = [
    NormalizedActivity(
        driver_id="driver_123",
        type=ActivityType.DRIVING,
        start=datetime(2026, 5, 11, 6, 0, tzinfo=CET),
        end=datetime(2026, 5, 11, 11, 0, tzinfo=CET),
    ),
]

engine = ComplianceEngine()                # DE profile by default
violations = engine.evaluate(activities)
for v in violations:
    print(v.rule_code, v.severity, v.actual_minutes, "/", v.limit_minutes)
```

## Architecture

```
backend/compliance/
    __init__.py             # public API
    engine.py               # ComplianceEngine + build_webhook_event
    models.py               # NormalizedActivity, Violation, facts, context
    severity.py             # severity scales (minutes -> Severity)
    _time.py                # half-open intervals, week/day bounds
    facts/
        driving_blocks.py
        daily_work_periods.py
        rest_periods.py
        week_summaries.py
        data_gaps.py
    rules/
        continuous_driving.py        # EU 561 Art. 7
        daily_driving.py             # EU 561 Art. 6(1)
        weekly_driving.py            # EU 561 Art. 6(2)
        fortnightly_driving.py       # EU 561 Art. 6(3)
        daily_rest.py                # EU 561 Art. 8
        weekly_rest.py               # EU 561 Art. 8(6)
        missing_card_or_data_gap.py  # EU 165 Art. 34
    profiles/
        base.py                      # CountryProfile dataclass
        eu_561.py                    # baseline limits
        de.py                        # DE / BALM
```

* **`facts/`** modules are pure builders. Same input -> same output.
* **`rules/`** modules each export `CODE`, `LEGAL_BASIS` and
  `evaluate(context)`. They never compute facts themselves; the engine
  threads facts through `ComplianceContext`.
* **`profiles/`** carries every tunable number and reporting label.
  Magic numbers live here, never inside rules.

## Models

`NormalizedActivity` — input. Half-open `[start, end)` interval with
timezone-aware datetimes. Fields cover the cases the spec calls out:
`is_out_of_scope`, `is_ferry_train`, `is_multi_manning`, `is_manual_entry`.

`Violation` — output. Rule code, German + Polish title, legal basis,
severity, `actual_minutes` / `limit_minutes` / `excess_minutes`, evidence
items, automation hint, status (`NEW` by default).

## Rules implemented

| Code | What it detects |
| --- | --- |
| `EU_561_CONTINUOUS_DRIVING` | jazda > 4h30 bez 45-min przerwy lub poprawnego splitu 15+30 |
| `EU_561_DAILY_DRIVING` | jazda dzienna > 10h |
| `EU_561_DAILY_DRIVING_EXTENSIONS` | więcej niż 2 dni > 9h w tygodniu |
| `EU_561_WEEKLY_DRIVING` | jazda tygodniowa > 56h |
| `EU_561_FORTNIGHTLY_DRIVING` | jazda dwutygodniowa > 90h |
| `EU_561_DAILY_REST_SHORT` | odpoczynek dzienny < 9h |
| `EU_561_DAILY_REST_TOO_MANY_REDUCED` | więcej niż 3 skrócone odpoczynki dzienne między tygodniowymi |
| `EU_561_WEEKLY_REST_MISSING` | brak rozpoznawalnego odpoczynku tygodniowego |
| `EU_561_WEEKLY_REST_SHORT` | odpoczynek tygodniowy < 24h |
| `EU_561_WEEKLY_REST_REDUCED` | odpoczynek tygodniowy 24..<45h (compensation required) |
| `EU_165_MISSING_CARD_OR_DATA_GAP` | luki/UNKNOWN powyżej progu — wymaga weryfikacji |

## Severity, not fines

The engine assigns `INFO`/`LOW`/`MEDIUM`/`HIGH`/`CRITICAL` based on the
size of the breach. **Mandate amounts are intentionally not computed** —
that's a separate concern that needs an up-to-date German fine catalogue
and is out of scope for this iteration. See `severity.py` for thresholds.

## Webhook / automation event

```python
from backend.compliance import build_webhook_event

event = build_webhook_event(violation)
# {
#   "event": "tachograph.violation.detected",
#   "driverId": "...",
#   "vehicleId": "...",
#   "countryProfile": "DE",
#   "ruleCode": "EU_561_CONTINUOUS_DRIVING",
#   "severity": "HIGH",
#   "start": "2026-05-11T07:15:00+02:00",
#   "end": "2026-05-11T12:27:00+02:00",
#   "violation": { ...full Violation dict... }
# }
```

Send this dict to n8n / Slack / a webhook of your choice; nothing in this
package does IO.

## Adding a new rule

1. Create `rules/my_new_rule.py` exporting `CODE`, `LEGAL_BASIS` and
   `evaluate(context) -> list[Violation]`.
2. Register it in `engine.DEFAULT_RULES` (or pass a custom tuple to
   `ComplianceEngine(rules=...)`).
3. Add a unit-test file under `backend/tests/compliance/`.

A rule is just a function. There is no shared base class, no registry to
mutate at import time, no DI container.

## Tests

```
python3 -m unittest discover -s backend/tests/compliance -t .
```

The synthetic scenarios match the spec checklist: 4h29/4h31/split orders,
8h59/9h30/10h01 daily, 56h/56h01 weekly, 90h/90h01 fortnight,
11h/9h30/8h59 daily rest, four-reduced cap, 45h/30h/23h59 weekly rest,
gap-below-threshold / gap-warning / UNKNOWN.

## Open TODOs (intentional)

* Daily framing uses calendar days as a fallback. True legal framing is
  rest-to-rest and is marked `TODO` in `facts/daily_work_periods.py`.
* Weekly-rest compensation tracking sets `compensationRequired` but does
  not yet check that the make-up rest happens within 3 weeks.
* AVAILABILITY handling inside driving blocks is conservative; the legal
  treatment near a 15-minute split leg is documented as a TODO.
* Mandate (€) calculation is deliberately not implemented — severity is
  the only risk signal at this stage.

# @parserddd/compliance

Deterministic German/EU tachograph compliance engine for normalized DDD timelines.

## Coverage

All four phases from the spec are implemented and exercised by tests.

### Phase 1 — Foundation

- JSON schemas (`compliance-rule`, `fine-mapping`) — draft 2020-12, validated by Ajv2020
- Strict YAML loader, duplicate-id detection, recursive bundle loading
- Domain types: `Activity`, `Timeline`, `DriverDay`, `DriverWeek`, `Rule`,
  `Violation`, `EvaluationResult`, `FineMapping`, `DriverSignature`, `AuditLog`,
  `AdministrativeContext` (downloads/inspections/retention)
- Calc utilities: half-open intervals, gap finding, DST-aware tz keys, ISO
  weeks, rolling 2-week, continuous-driving segments, rest-run detection
- Timeline normalizer: source-priority merge, gap-fill as UNKNOWN, contiguity
  invariants

### Phase 2 — Evaluators

| Category | rule_id(s) | Module |
| --- | --- | --- |
| A — country entries | `EU_165_MISSING_START_COUNTRY`, `EU_165_MISSING_END_COUNTRY` | `country-entry.ts` |
| A — manual entries | `EU_165_MISSING_MANUAL_ENTRY`, `EU_165_INCOMPLETE_MANUAL_ENTRY` | `manual-entry.ts` |
| B — card | `EU_165_DRIVING_WITHOUT_CARD`, `EU_165_CARD_REMOVED_TOO_EARLY`, `EU_165_WRONG_SLOT`, `EU_165_MISSING_CO_DRIVER` | `card.ts` |
| C — activity selection | `EU_165_REST_DURING_WORK`, `EU_165_OUT_MISUSE`, `EU_165_AVAILABILITY_INSTEAD_OF_WORK` | `activity-selection.ts` |
| D — driving time | `EU_561_ART6_DAILY_DRIVING`, `EU_561_ART6_WEEKLY_DRIVING`, `EU_561_ART6_TWO_WEEK_DRIVING` | `driving-time.ts` |
| D — break 4h30 | `EU_561_ART7_BREAK_AFTER_4H30` | `break-4h30.ts` |
| D — rest | `EU_561_ART8_DAILY_REST`, `EU_561_ART8_WEEKLY_REST` | `rest.ts` |
| E — KrFArbZG | `DE_KRFARBZG_DAILY_WORKING_TIME`, `DE_KRFARBZG_WEEKLY_WORKING_TIME`, `DE_KRFARBZG_BREAKS`, `DE_KRFARBZG_NIGHT_WORK` | `working-time.ts` |
| F — downloads / retention | `EU_165_DOWNLOAD_CARD_28`, `EU_165_DOWNLOAD_VU_90`, `EU_165_DATA_RETENTION`, `EU_165_MISSING_INSPECTION` | `downloads.ts` |
| G — events / faults / printout / manipulation | `EU_165_TACHOGRAPH_EVENT`, `EU_165_TACHOGRAPH_FAULT`, `EU_165_PRINTOUT_REQUIRED`, `EU_165_MANIPULATION_INDICATOR` | `events-faults.ts` |

### Phase 3 — Reporting / signatures / audit

- `reporting/summary.ts` — `summarizeViolations`, `groupViolations`, `violationToRow`
- `reporting/pdf-structure.ts` — `buildPdfReport(result, locale)` with DE/EN/PL
  category headings, sub-totals, locale-bound rows
- `signatures/workflow.ts` — `signViolation`, `disputeViolation`, `correctViolation`,
  `hashViolation`, `canonicalize`, with strict transition guards
- `audit/log.ts` — append-only, hash-chained `AuditLog` with `verify()`

### Phase 4 — Tests

72 vitest cases across 16 files, including DST spring-forward, ferry/train
interruption, multi-manning, OUT misuse, split-break ordering (15+30 vs 30+15),
manual-entry gaps, card-out windows, weekly/two-week budgets, KrFArbZG night
work, download cadence, retention, inspection, hash-chain tamper detection.

## Engine guarantees

- **No AI at runtime.** Decisions reproduce only from the YAML rule pack.
- **No silent compliance.** Required-data-missing → `not_evaluable`.
- **No invented fines.** Unknown amounts stay `null` (TODO).
- **Stable output.** Content-hashed `violation_id`; engine + rule-set versions
  stamped on every record.

## Quickstart

```ts
import {
  loadComplianceBundle,
  normalizeTimeline,
  evaluateAll,
  buildPdfReport,
} from "@parserddd/compliance";

const { rules, fines } = await loadComplianceBundle("./rules");
const timeline = normalizeTimeline({ /* parsed DDD */ });
const result = evaluateAll({
  timeline,
  rules,
  fines,
  evaluated_at: new Date(),
  time_zone: "Europe/Berlin",
  administrative: {
    downloads: [...],
    inspections: [...],
    retention: [...],
  },
});

const report = buildPdfReport(result, "pl");
```

## Tests

```bash
npm install
npm test            # vitest, 76 cases
npm run typecheck   # strict tsc --noEmit
```

## Python bridge

Backend Flask invokes the engine through `backend/services/compliance_engine.py`:

```python
from backend.services.compliance_engine import ComplianceEngine
engine = ComplianceEngine()
result = engine.evaluate(payload)             # → dict (EvaluationResult)
report = engine.report(result, locale="pl")  # → dict (PdfReport)
```

The bridge spawns `node dist/cli/engine-cli.js`, so build the package first:

```bash
cd src/compliance && npm install && npm run build
```

Override locations via env vars:
- `COMPLIANCE_NODE_BIN` (default: `which node`)
- `COMPLIANCE_CLI_ENTRY` (default: `src/compliance/dist/cli/engine-cli.js`)
- `COMPLIANCE_RULES_ROOT` (default: repo `rules/`)
- `COMPLIANCE_TIMEOUT_SECONDS` (default: 30)

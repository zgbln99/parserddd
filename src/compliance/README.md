# @parserddd/compliance

Deterministic German/EU tachograph compliance engine for normalized DDD timelines.

## Status

Phase 1 (foundation) and the first slice of Phase 2 (evaluators A — country
entry + manual entries) are implemented and covered by tests. The remaining
evaluators (driving without card, daily/weekly driving time, breaks, rests,
working time, downloads, printouts, events, manipulation) are scaffolded but
not yet wired in — see `evaluators/registry.ts` for the next-up list.

## Engine guarantees

- **No AI at runtime.** Every decision is reproduced from the YAML rule pack.
- **No silent compliance.** When required input is missing, the engine
  returns `not_evaluable` for that rule rather than treating it as compliant.
- **No invented fines.** Unknown driver/company fines stay `null`.
- **Stable output.** Violation ids are content-hashed; engine + rule-set
  versions are stamped on every record.

## Quickstart

```ts
import {
  loadComplianceBundle,
  normalizeTimeline,
  evaluateAll,
} from "@parserddd/compliance";

const { rules, fines } = await loadComplianceBundle("./rules");
const timeline = normalizeTimeline({ /* parsed DDD */ });
const result = evaluateAll({
  timeline,
  rules,
  fines,
  evaluated_at: new Date(),
  time_zone: "Europe/Berlin",
});

console.log(result.violations.length, "violations");
console.log(result.not_evaluable, "rules could not be evaluated");
```

## Tests

```bash
npm install
npm test            # vitest
npm run typecheck   # strict tsc --noEmit
```

## Layout

```
src/compliance/
  loaders/         YAML → typed Rule/Fine indices
  validators/      Ajv2020 JSON schema validators
  normalizers/     Raw activities → dense, contiguous Timeline
  calculations/    Time, overlaps, weekly buckets, continuous-driving
  evaluators/      One file per rule family (country, manual, …)
  reporting/       Phase 3: PDF/i18n/audit-friendly report shapes
  signatures/      Phase 3: driver signature + dispute workflow
  audit/           Phase 3: append-only audit log
  schemas/         JSON-Schema definitions for rule packs
  fixtures/        Test builders (activity/cardSession/manualEntry)
  tests/           Vitest suites
  types/           Domain models (Activity, Timeline, Violation, …)
```

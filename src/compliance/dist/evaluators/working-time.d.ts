import type { Evaluator } from "./base.js";
/**
 * KrFArbZG (Arbeitszeit für Kraftfahrer) evaluators.
 *
 * Working time = WORK + DRIVING (AVAILABILITY does NOT count, REST/UNKNOWN
 * never count). Daily and weekly limits apply to that sum.
 *
 * Break rule (§ 5):
 *   - >6h working time → 30 min break required
 *   - >9h working time → 45 min break required
 *   Splits are allowed in chunks of >= minimum_split_minutes (default 15).
 */
export declare const workingTimeEvaluator: Evaluator;
//# sourceMappingURL=working-time.d.ts.map
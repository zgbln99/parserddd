import type { Evaluator } from "./base.js";
import type { AdministrativeContext } from "../types/administrative.js";
/**
 * Category F — download cadence, retention, inspection records.
 *
 * Each rule REQUIRES the `EvaluatorContext.administrative` block. When that
 * block is absent we return `not_evaluable` per spec — never treat missing
 * data as compliance.
 */
export declare const downloadsEvaluator: Evaluator;
export type _AdministrativeContextRef = AdministrativeContext;
//# sourceMappingURL=downloads.d.ts.map
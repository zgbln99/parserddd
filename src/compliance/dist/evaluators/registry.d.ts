import type { Evaluator, EvaluatorContext } from "./base.js";
import type { EvaluationResult } from "../types/violation.js";
/**
 * Default evaluator registry.
 *
 * Order is fixed so engine output is stable run-to-run. Categories are
 * grouped roughly by spec order:
 *   A — country entries / manual entries
 *   B — card slot
 *   C — activity selection
 *   D — driving time / breaks / rests
 *   E — KrFArbZG working time / breaks / night
 *   F — downloads / retention / inspection
 *   G — events / faults / printout / manipulation
 */
export declare const DEFAULT_EVALUATORS: readonly Evaluator[];
export declare function evaluateAll(ctx: EvaluatorContext, evaluators?: readonly Evaluator[]): EvaluationResult;
//# sourceMappingURL=registry.d.ts.map
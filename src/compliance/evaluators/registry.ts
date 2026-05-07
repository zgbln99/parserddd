import type { Evaluator, EvaluatorContext } from "./base.js";
import { combineEvaluations } from "./base.js";
import type { EvaluationResult, RuleEvaluation } from "../types/violation.js";
import { countryEntryEvaluator } from "./country-entry.js";
import { manualEntryEvaluator } from "./manual-entry.js";

/**
 * The default evaluator registry.
 *
 * Order matters: evaluators run in this exact sequence and the resulting
 * `rule_evaluations` array preserves the order. UI/reporting layers may
 * group by category, but the engine output itself is stable so diffs
 * between runs are reviewable.
 */
export const DEFAULT_EVALUATORS: readonly Evaluator[] = Object.freeze([
  countryEntryEvaluator,
  manualEntryEvaluator,
  // Future: drivingWithoutCardEvaluator, breakAfter4h30Evaluator,
  // dailyDrivingEvaluator, weeklyDrivingEvaluator, twoWeekDrivingEvaluator,
  // dailyRestEvaluator, weeklyRestEvaluator, krfArbZgWeeklyWorkingTime,
  // krfArbZgBreaks, downloadCadenceEvaluator, ...
]);

export function evaluateAll(
  ctx: EvaluatorContext,
  evaluators: readonly Evaluator[] = DEFAULT_EVALUATORS,
): EvaluationResult {
  const all: RuleEvaluation[] = [];
  for (const evaluator of evaluators) {
    all.push(...evaluator.evaluate(ctx));
  }
  return combineEvaluations(ctx, all);
}

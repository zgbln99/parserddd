import type { Timeline } from "../types/timeline.js";
import type { AdministrativeContext } from "../types/administrative.js";
import type { FineIndex, Rule, RuleIndex } from "../types/rule.js";
import type { EvaluationResult, RuleEvaluation, Violation, ViolationStatus, ViolationUnit } from "../types/violation.js";
import type { ActivityId, MultilingualText } from "../types/common.js";
/** Static engine version. Bump on any output-shape or logic change. */
export declare const ENGINE_VERSION = "0.1.0";
export interface EvaluatorContext {
    readonly timeline: Timeline;
    readonly rules: RuleIndex;
    readonly fines: FineIndex;
    readonly evaluated_at: Date;
    /** IANA tz used for local-day grouping. */
    readonly time_zone: string;
    /**
     * Optional admin data: download events, inspections, retention.
     * Required for category F (downloads / retention) — when missing, those
     * evaluators return `not_evaluable`.
     */
    readonly administrative?: AdministrativeContext;
}
/**
 * An evaluator owns one or more rule_ids and decides what violations they
 * produce. Evaluators are PURE — they must read only from `ctx` and return
 * a `RuleEvaluation` per rule they handle.
 *
 * If required data is missing on the timeline, the evaluator MUST return
 * `not_evaluable` rather than `compliant`. Defaulting to compliant on
 * missing data is a SPEC VIOLATION.
 */
export interface Evaluator {
    /** rule_ids this evaluator owns. */
    readonly rule_ids: readonly string[];
    evaluate(ctx: EvaluatorContext): readonly RuleEvaluation[];
}
/** Build a Violation with stable defaults — every evaluator should use this. */
export declare function buildViolation(args: {
    rule: Rule;
    fines: FineIndex;
    driver_id: Timeline["driver_id"];
    start_time: Date;
    end_time: Date;
    measured_value: number | null;
    allowed_value: number | null;
    excess_value: number | null;
    unit: ViolationUnit;
    source_activity_ids: readonly ActivityId[];
    confidence: number;
    status?: ViolationStatus;
    rule_set_version: string;
    explanation_override?: MultilingualText;
}): Violation;
/** Helper: combine the per-rule evaluations into an EvaluationResult. */
export declare function combineEvaluations(ctx: EvaluatorContext, evaluations: readonly RuleEvaluation[]): EvaluationResult;
/** Resolve the rule_set version that owns a given rule. */
export declare function ruleSetVersionFor(rules: RuleIndex, rule_id: string): string;
//# sourceMappingURL=base.d.ts.map
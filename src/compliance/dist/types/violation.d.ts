import type { ActivityId, Confidence, DriverId, MultilingualText, ViolationId } from "./common.js";
import type { RuleCategory, RuleSeverity } from "./rule.js";
/**
 * Workflow status of a single violation. Mirrors the value set required by
 * the spec — DO NOT widen without coordinating with the audit/log schema.
 */
export type ViolationStatus = "pending" | "signed" | "disputed" | "corrected" | "not_evaluable";
/**
 * Canonical violation record. Every field listed in the engine spec must be
 * present in the output, even if null — downstream PDF/i18n consumers rely
 * on the stable shape.
 */
export interface Violation {
    readonly violation_id: ViolationId;
    readonly driver_id: DriverId;
    readonly rule_id: string;
    readonly category: RuleCategory;
    readonly severity: RuleSeverity | null;
    readonly legal_basis: MultilingualText;
    readonly title: MultilingualText;
    readonly explanation: MultilingualText;
    readonly start_time: Date;
    readonly end_time: Date;
    /**
     * Measured value for the rule's metric, in the rule's natural unit
     * (minutes for time rules, count for count rules, etc.). `null` when
     * the rule could not be evaluated (status = "not_evaluable").
     */
    readonly measured_value: number | null;
    readonly allowed_value: number | null;
    readonly excess_value: number | null;
    readonly unit: ViolationUnit;
    readonly source_activity_ids: readonly ActivityId[];
    /** EUR. `null` means "fine not catalogued yet" — never invent amounts. */
    readonly driver_fine_eur: number | null;
    readonly company_fine_eur: number | null;
    readonly confidence: Confidence;
    readonly status: ViolationStatus;
    /** Engine version + ruleset versions used to produce this violation. */
    readonly engine_version: string;
    readonly rule_set_version: string;
}
export type ViolationUnit = "minutes" | "hours" | "count" | "days" | "kilometers" | "none";
/**
 * Result of evaluating a single rule against a timeline. Either produces a
 * list of violations, or signals that the rule could not be evaluated and
 * therefore must NOT default to compliant.
 */
export type RuleEvaluation = {
    readonly status: "evaluated";
    readonly rule_id: string;
    readonly violations: readonly Violation[];
} | {
    readonly status: "not_evaluable";
    readonly rule_id: string;
    readonly reason: string;
    readonly missing_fields: readonly string[];
} | {
    readonly status: "compliant";
    readonly rule_id: string;
};
export interface EvaluationResult {
    readonly driver_id: DriverId;
    readonly engine_version: string;
    readonly evaluated_at: Date;
    readonly rule_set_versions: Readonly<Record<string, string | number>>;
    readonly rule_evaluations: readonly RuleEvaluation[];
    readonly violations: readonly Violation[];
    readonly not_evaluable: readonly {
        rule_id: string;
        reason: string;
    }[];
}
//# sourceMappingURL=violation.d.ts.map
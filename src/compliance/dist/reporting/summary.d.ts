import type { EvaluationResult, Violation } from "../types/violation.js";
import type { Locale } from "../types/common.js";
import type { RuleCategory } from "../types/rule.js";
/**
 * Aggregated summary suitable for headline KPIs / dashboards. The shape is
 * stable so the frontend can bind directly without having to re-aggregate.
 */
export interface ViolationSummary {
    readonly total: number;
    readonly by_category: Readonly<Record<RuleCategory, number>>;
    readonly by_status: Readonly<Record<string, number>>;
    readonly by_severity: Readonly<Record<string, number>>;
    readonly driver_fine_total_eur: number | null;
    readonly company_fine_total_eur: number | null;
    readonly fine_unknown_count: number;
    readonly not_evaluable_rule_ids: readonly string[];
}
export declare function summarizeViolations(result: EvaluationResult): ViolationSummary;
/**
 * Group violations by category and rule id. Useful for the in-app drill-down
 * UI and the section structure of PDF reports.
 */
export interface GroupedViolations {
    readonly by_category: Readonly<Record<RuleCategory, readonly Violation[]>>;
    readonly by_rule: ReadonlyMap<string, readonly Violation[]>;
}
export declare function groupViolations(result: EvaluationResult): GroupedViolations;
/**
 * Render a violation as a flat, locale-bound row. PDF/Excel exporters can
 * map directly over `violationToRow` to build their tables.
 */
export interface ViolationRow {
    readonly rule_id: string;
    readonly category: RuleCategory;
    readonly title: string;
    readonly legal_basis: string;
    readonly explanation: string;
    readonly start_time: string;
    readonly end_time: string;
    readonly measured_value: number | null;
    readonly allowed_value: number | null;
    readonly excess_value: number | null;
    readonly unit: Violation["unit"];
    readonly driver_fine_eur: number | null;
    readonly company_fine_eur: number | null;
    readonly status: Violation["status"];
    readonly severity: Violation["severity"];
}
export declare function violationToRow(v: Violation, locale: Locale): ViolationRow;
//# sourceMappingURL=summary.d.ts.map
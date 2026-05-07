import type {
  EvaluationResult,
  Violation,
} from "../types/violation.js";
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

export function summarizeViolations(result: EvaluationResult): ViolationSummary {
  const by_category: Partial<Record<RuleCategory, number>> = {};
  const by_status: Record<string, number> = {};
  const by_severity: Record<string, number> = {};
  let driver_fine_total: number | null = 0;
  let company_fine_total: number | null = 0;
  let fine_unknown = 0;

  for (const v of result.violations) {
    by_category[v.category] = (by_category[v.category] ?? 0) + 1;
    by_status[v.status] = (by_status[v.status] ?? 0) + 1;
    const sev = v.severity ?? "UNCLASSIFIED";
    by_severity[sev] = (by_severity[sev] ?? 0) + 1;

    if (v.driver_fine_eur === null || v.company_fine_eur === null) {
      fine_unknown += 1;
    }
    if (driver_fine_total !== null) {
      if (v.driver_fine_eur === null) driver_fine_total = null;
      else driver_fine_total += v.driver_fine_eur;
    }
    if (company_fine_total !== null) {
      if (v.company_fine_eur === null) company_fine_total = null;
      else company_fine_total += v.company_fine_eur;
    }
  }

  return Object.freeze({
    total: result.violations.length,
    by_category: Object.freeze(by_category) as Readonly<Record<RuleCategory, number>>,
    by_status: Object.freeze(by_status),
    by_severity: Object.freeze(by_severity),
    driver_fine_total_eur: driver_fine_total,
    company_fine_total_eur: company_fine_total,
    fine_unknown_count: fine_unknown,
    not_evaluable_rule_ids: Object.freeze(
      result.not_evaluable.map((x) => x.rule_id),
    ),
  });
}

/**
 * Group violations by category and rule id. Useful for the in-app drill-down
 * UI and the section structure of PDF reports.
 */
export interface GroupedViolations {
  readonly by_category: Readonly<Record<RuleCategory, readonly Violation[]>>;
  readonly by_rule: ReadonlyMap<string, readonly Violation[]>;
}

export function groupViolations(result: EvaluationResult): GroupedViolations {
  const byCategory: Partial<Record<RuleCategory, Violation[]>> = {};
  const byRule = new Map<string, Violation[]>();
  for (const v of result.violations) {
    (byCategory[v.category] ??= []).push(v);
    const list = byRule.get(v.rule_id) ?? [];
    list.push(v);
    byRule.set(v.rule_id, list);
  }
  const frozenByRule = new Map<string, readonly Violation[]>();
  for (const [k, vs] of byRule) frozenByRule.set(k, Object.freeze([...vs]));
  return Object.freeze({
    by_category: Object.freeze(
      Object.fromEntries(
        Object.entries(byCategory).map(([k, vs]) => [k, Object.freeze(vs)]),
      ) as Record<RuleCategory, readonly Violation[]>,
    ),
    by_rule: frozenByRule,
  });
}

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

export function violationToRow(v: Violation, locale: Locale): ViolationRow {
  return {
    rule_id: v.rule_id,
    category: v.category,
    title: v.title[locale],
    legal_basis: v.legal_basis[locale],
    explanation: v.explanation[locale],
    start_time: v.start_time.toISOString(),
    end_time: v.end_time.toISOString(),
    measured_value: v.measured_value,
    allowed_value: v.allowed_value,
    excess_value: v.excess_value,
    unit: v.unit,
    driver_fine_eur: v.driver_fine_eur,
    company_fine_eur: v.company_fine_eur,
    status: v.status,
    severity: v.severity,
  };
}

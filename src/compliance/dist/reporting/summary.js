export function summarizeViolations(result) {
    const by_category = {};
    const by_status = {};
    const by_severity = {};
    let driver_fine_total = 0;
    let company_fine_total = 0;
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
            if (v.driver_fine_eur === null)
                driver_fine_total = null;
            else
                driver_fine_total += v.driver_fine_eur;
        }
        if (company_fine_total !== null) {
            if (v.company_fine_eur === null)
                company_fine_total = null;
            else
                company_fine_total += v.company_fine_eur;
        }
    }
    return Object.freeze({
        total: result.violations.length,
        by_category: Object.freeze(by_category),
        by_status: Object.freeze(by_status),
        by_severity: Object.freeze(by_severity),
        driver_fine_total_eur: driver_fine_total,
        company_fine_total_eur: company_fine_total,
        fine_unknown_count: fine_unknown,
        not_evaluable_rule_ids: Object.freeze(result.not_evaluable.map((x) => x.rule_id)),
    });
}
export function groupViolations(result) {
    const byCategory = {};
    const byRule = new Map();
    for (const v of result.violations) {
        (byCategory[v.category] ??= []).push(v);
        const list = byRule.get(v.rule_id) ?? [];
        list.push(v);
        byRule.set(v.rule_id, list);
    }
    const frozenByRule = new Map();
    for (const [k, vs] of byRule)
        frozenByRule.set(k, Object.freeze([...vs]));
    return Object.freeze({
        by_category: Object.freeze(Object.fromEntries(Object.entries(byCategory).map(([k, vs]) => [k, Object.freeze(vs)]))),
        by_rule: frozenByRule,
    });
}
export function violationToRow(v, locale) {
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
//# sourceMappingURL=summary.js.map
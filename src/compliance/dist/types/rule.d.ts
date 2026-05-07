import type { MultilingualText } from "./common.js";
export type RuleCategory = "DRIVING_TIME" | "BREAKS" | "REST" | "WORKING_TIME" | "TACHOGRAPH" | "MANUAL_ENTRY" | "COUNTRY_ENTRY" | "CARD" | "ACTIVITY_SELECTION" | "DOWNLOAD" | "PRINTOUT" | "EVENT_FAULT" | "MANIPULATION" | "MULTI_MANNING" | "NIGHT_WORK";
export type RuleSeverity = "MINOR" | "SERIOUS" | "VERY_SERIOUS" | "MOST_SERIOUS";
/**
 * Compliance rule as parsed from YAML and validated against
 * compliance-rule.schema.json.
 *
 * `logic` is intentionally untyped here — each evaluator narrows it via a
 * dedicated guard (see evaluators/*.ts). This keeps YAML the single source
 * of legal parameters while the engine stays type-safe at evaluation time.
 */
export interface Rule {
    readonly rule_id: string;
    readonly category: RuleCategory;
    readonly legal_basis: MultilingualText;
    readonly title: MultilingualText;
    readonly explanation?: MultilingualText;
    readonly severity?: RuleSeverity;
    readonly logic?: Readonly<Record<string, unknown>>;
    readonly tags?: readonly string[];
}
export interface RuleSet {
    readonly rule_set: string;
    readonly version: string | number;
    readonly jurisdiction?: "EU" | "DE" | "PL" | "AT" | "FR" | "IT" | "ES" | "NL";
    readonly rules: readonly Rule[];
    /** Absolute path the rule set was loaded from. Used in audit logs. */
    readonly source_path: string;
}
/** Lookup container created by the loader for O(1) rule access by id. */
export interface RuleIndex {
    readonly rule_sets: readonly RuleSet[];
    readonly by_id: ReadonlyMap<string, Rule>;
    readonly by_category: ReadonlyMap<RuleCategory, readonly Rule[]>;
}
/**
 * A single fine entry in a fine mapping file. `null` amount means
 * "value not yet known — preserve TODO status" (engine MUST NOT invent it).
 */
export interface FineEntry {
    readonly amount_eur: number | null;
    readonly min_eur?: number;
    readonly max_eur?: number;
    readonly per_hour_eur?: number;
    readonly todo?: boolean;
}
export interface FineMapping {
    readonly violation_reference: string;
    readonly source?: string;
    readonly notes?: string;
    readonly driver?: FineEntry;
    readonly company?: FineEntry;
}
export interface FineSet {
    readonly rule_set: string;
    readonly version: string | number;
    readonly currency: string;
    readonly fines: readonly FineMapping[];
    readonly source_path: string;
}
export interface FineIndex {
    readonly fine_sets: readonly FineSet[];
    readonly by_rule_id: ReadonlyMap<string, FineMapping>;
}
//# sourceMappingURL=rule.d.ts.map
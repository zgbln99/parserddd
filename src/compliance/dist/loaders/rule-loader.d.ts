import type { FineIndex, FineSet, RuleIndex, RuleSet } from "../types/rule.js";
export declare class RuleLoadError extends Error {
    readonly source_path: string;
    readonly issues: readonly {
        path: string;
        message: string;
    }[];
    constructor(source_path: string, message: string, issues?: readonly {
        path: string;
        message: string;
    }[]);
}
/**
 * Load a single rule-set YAML file and validate it against the JSON schema.
 *
 * Throws RuleLoadError on any schema violation — we never silently accept a
 * partial rule set, because a missing parameter would silently default the
 * downstream evaluator to "compliant".
 */
export declare function loadRuleSetFile(file_path: string): RuleSet;
/**
 * Load a single fine-mapping YAML file and validate it against the schema.
 */
export declare function loadFineSetFile(file_path: string): FineSet;
/**
 * Recursively load every YAML file under the given directories and build a
 * fine + rule index.
 *
 * Resolution rules:
 * - Files named "fines*.yaml" or whose top-level has `fines:` go to the fine index.
 * - Files with top-level `rules:` go to the rule index.
 * - Anything else is rejected — there is no third bucket.
 *
 * Duplicate rule_id across rule sets throws — the engine must have a single
 * authoritative definition per rule id.
 */
export declare function loadComplianceBundle(...roots: string[]): Promise<{
    rules: RuleIndex;
    fines: FineIndex;
}>;
export declare function buildRuleIndex(rule_sets: readonly RuleSet[]): RuleIndex;
export declare function buildFineIndex(fine_sets: readonly FineSet[]): FineIndex;
//# sourceMappingURL=rule-loader.d.ts.map
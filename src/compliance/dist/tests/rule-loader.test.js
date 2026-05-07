import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadComplianceBundle, loadFineSetFile, loadRuleSetFile, RuleLoadError, } from "../loaders/rule-loader.js";
const RULES_ROOT = resolve(__dirname, "..", "..", "..", "rules");
describe("rule-loader", () => {
    it("loads every YAML in /rules without errors", async () => {
        const bundle = await loadComplianceBundle(RULES_ROOT);
        expect(bundle.rules.rule_sets.length).toBeGreaterThanOrEqual(4);
        expect(bundle.rules.by_id.has("EU_561_ART6_DAILY_DRIVING")).toBe(true);
        expect(bundle.rules.by_id.has("EU_561_ART7_BREAK_AFTER_4H30")).toBe(true);
        expect(bundle.rules.by_id.has("EU_165_MISSING_MANUAL_ENTRY")).toBe(true);
        expect(bundle.rules.by_id.has("EU_165_MISSING_START_COUNTRY")).toBe(true);
        expect(bundle.rules.by_id.has("EU_165_MISSING_END_COUNTRY")).toBe(true);
        expect(bundle.fines.by_rule_id.has("EU_561_ART7_BREAK_AFTER_4H30")).toBe(true);
    });
    it("indexes rules by category", async () => {
        const bundle = await loadComplianceBundle(RULES_ROOT);
        const country = bundle.rules.by_category.get("COUNTRY_ENTRY") ?? [];
        expect(country.map((r) => r.rule_id).sort()).toEqual([
            "EU_165_MISSING_END_COUNTRY",
            "EU_165_MISSING_START_COUNTRY",
        ]);
    });
    it("rejects YAML missing required fields", () => {
        const dir = mkdtempSync(resolve(tmpdir(), "compl-"));
        const file = resolve(dir, "bad.yaml");
        writeFileSync(file, "rule_set: BAD\nversion: 1\nrules:\n  - rule_id: X_BAD\n    category: REST\n");
        expect(() => loadRuleSetFile(file)).toThrow(RuleLoadError);
    });
    it("rejects rule_id duplicates across sets", async () => {
        const dir = mkdtempSync(resolve(tmpdir(), "compl-"));
        writeFileSync(resolve(dir, "a.yaml"), `rule_set: A\nversion: 1\nrules:\n  - rule_id: DUP\n    category: REST\n    legal_basis: { de: a, en: a, pl: a }\n    title: { de: a, en: a, pl: a }\n`);
        writeFileSync(resolve(dir, "b.yaml"), `rule_set: B\nversion: 1\nrules:\n  - rule_id: DUP\n    category: REST\n    legal_basis: { de: b, en: b, pl: b }\n    title: { de: b, en: b, pl: b }\n`);
        await expect(loadComplianceBundle(dir)).rejects.toThrow(/duplicate rule_id DUP/);
    });
    it("loads a fine set with null amounts preserved", () => {
        const dir = mkdtempSync(resolve(tmpdir(), "compl-"));
        const file = resolve(dir, "f.yaml");
        writeFileSync(file, `rule_set: FX\nversion: 1\nfines:\n  - violation_reference: SOME_RULE\n    driver: { amount_eur: null, todo: true }\n    company: { amount_eur: 100 }\n`);
        const set = loadFineSetFile(file);
        expect(set.fines[0]?.driver?.amount_eur).toBeNull();
        expect(set.fines[0]?.driver?.todo).toBe(true);
        expect(set.fines[0]?.company?.amount_eur).toBe(100);
    });
});
//# sourceMappingURL=rule-loader.test.js.map
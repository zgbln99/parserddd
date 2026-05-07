import { describe, expect, it } from "vitest";
import { evaluateAll } from "../evaluators/registry.js";
import { activity, cardSession } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";
import { groupViolations, summarizeViolations, violationToRow, } from "../reporting/summary.js";
import { buildPdfReport } from "../reporting/pdf-structure.js";
describe("reporting layer", () => {
    it("summarizes a multi-violation scenario by category and status", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
            activities: [
                activity("2026-03-02T06:00:00Z", "2026-03-02T11:30:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T11:30:00Z", "2026-03-02T11:45:00Z", { kind: "REST" }),
                activity("2026-03-02T11:45:00Z", "2026-03-02T17:00:00Z", { kind: "DRIVING" }),
            ],
            card_sessions: [
                cardSession("2026-03-02T05:00:00Z", "2026-03-02T18:00:00Z", {
                    start_country: null,
                    end_country: null,
                }),
            ],
        });
        const result = evaluateAll(ctx);
        const summary = summarizeViolations(result);
        expect(summary.total).toBeGreaterThan(0);
        expect(summary.by_category).toBeTruthy();
        expect(summary.by_status.pending).toBeGreaterThan(0);
    });
    it("groups violations by category and rule_id", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
            card_sessions: [
                cardSession("2026-03-02T05:00:00Z", "2026-03-02T18:00:00Z", {
                    start_country: null,
                    end_country: "DE",
                }),
            ],
        });
        const result = evaluateAll(ctx);
        const grouped = groupViolations(result);
        expect(grouped.by_rule.has("EU_165_MISSING_START_COUNTRY")).toBe(true);
    });
    it("renders a PDF-ready report in DE/EN/PL with locale-bound strings", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
            card_sessions: [
                cardSession("2026-03-02T05:00:00Z", "2026-03-02T18:00:00Z", {
                    start_country: null,
                    end_country: "DE",
                }),
            ],
        });
        const result = evaluateAll(ctx);
        const de = buildPdfReport(result, "de");
        const pl = buildPdfReport(result, "pl");
        expect(de.locale).toBe("de");
        expect(pl.locale).toBe("pl");
        expect(de.sections.length).toBeGreaterThan(0);
        const deRow = de.sections[0]?.rows[0];
        const plRow = pl.sections[0]?.rows[0];
        expect(deRow?.title).not.toBe(plRow?.title);
        expect(deRow?.title).toContain("Anfangsland");
        expect(plRow?.title).toContain("kraj");
    });
    it("violationToRow flattens to locale-bound strings", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
            card_sessions: [
                cardSession("2026-03-02T05:00:00Z", "2026-03-02T18:00:00Z", {
                    start_country: null,
                    end_country: "DE",
                }),
            ],
        });
        const result = evaluateAll(ctx);
        const v = result.violations[0];
        if (!v)
            throw new Error("expected at least one violation");
        const row = violationToRow(v, "en");
        expect(row.title).toContain("start country");
    });
});
//# sourceMappingURL=reporting.test.js.map
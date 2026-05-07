import { describe, expect, it } from "vitest";
import { evaluateAll } from "../evaluators/registry.js";
import { breakAfter4h30Evaluator } from "../evaluators/break-4h30.js";
import { activity } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";
describe("break-after-4h30 evaluator", () => {
    it("does not flag 4h30 of driving with a 45min break right after", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T18:00:00Z" },
            activities: [
                activity("2026-03-02T06:00:00Z", "2026-03-02T10:30:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T10:30:00Z", "2026-03-02T11:15:00Z", { kind: "REST" }),
                activity("2026-03-02T11:15:00Z", "2026-03-02T15:00:00Z", { kind: "DRIVING" }),
            ],
        });
        const r = evaluateAll(ctx, [breakAfter4h30Evaluator]);
        expect(r.violations).toEqual([]);
    });
    it("flags 5h continuous driving without a qualifying break", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T18:00:00Z" },
            activities: [
                activity("2026-03-02T06:00:00Z", "2026-03-02T11:00:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T11:00:00Z", "2026-03-02T11:45:00Z", { kind: "REST" }),
            ],
        });
        const r = evaluateAll(ctx, [breakAfter4h30Evaluator]);
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0]?.measured_value).toBeGreaterThan(270);
    });
    it("accepts the 15+30 split pattern in the legal order", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T18:00:00Z" },
            activities: [
                activity("2026-03-02T06:00:00Z", "2026-03-02T08:00:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T08:00:00Z", "2026-03-02T08:15:00Z", { kind: "REST" }),
                activity("2026-03-02T08:15:00Z", "2026-03-02T10:30:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T10:30:00Z", "2026-03-02T11:00:00Z", { kind: "REST" }),
                activity("2026-03-02T11:00:00Z", "2026-03-02T15:30:00Z", { kind: "DRIVING" }),
            ],
        });
        const r = evaluateAll(ctx, [breakAfter4h30Evaluator]);
        expect(r.violations).toEqual([]);
    });
    it("rejects the 30+15 reversed split (legal order is 15 then 30)", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T18:00:00Z" },
            activities: [
                activity("2026-03-02T06:00:00Z", "2026-03-02T07:30:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T07:30:00Z", "2026-03-02T08:00:00Z", { kind: "REST" }),
                activity("2026-03-02T08:00:00Z", "2026-03-02T13:00:00Z", { kind: "DRIVING" }),
            ],
        });
        const r = evaluateAll(ctx, [breakAfter4h30Evaluator]);
        expect(r.violations.length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=break-4h30.test.js.map
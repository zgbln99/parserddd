import { describe, expect, it } from "vitest";
import { restEvaluator } from "../evaluators/rest.js";
import { evaluateAll } from "../evaluators/registry.js";
import { activity } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";
describe("rest evaluator", () => {
    it("flags daily rest below 9h", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-04T00:00:00Z" },
            activities: [
                activity("2026-03-02T05:00:00Z", "2026-03-02T15:00:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T15:00:00Z", "2026-03-02T22:00:00Z", { kind: "REST" }),
                activity("2026-03-02T22:00:00Z", "2026-03-03T08:00:00Z", { kind: "DRIVING" }),
            ],
        });
        const r = evaluateAll(ctx, [restEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART8_DAILY_REST").length).toBeGreaterThan(0);
    });
    it("accepts a regular 11h rest", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-04T00:00:00Z" },
            activities: [
                activity("2026-03-02T05:00:00Z", "2026-03-02T13:00:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T13:00:00Z", "2026-03-03T00:00:00Z", { kind: "REST" }),
                activity("2026-03-03T00:00:00Z", "2026-03-03T08:00:00Z", { kind: "DRIVING" }),
            ],
        });
        const r = evaluateAll(ctx, [restEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART8_DAILY_REST")).toEqual([]);
    });
    it("accepts a 3+9 split daily rest (Art. 4(g))", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-04T00:00:00Z" },
            activities: [
                // shift 1: 5h drive → 3h rest → 5h drive → 9h rest → shift 2 starts
                activity("2026-03-02T05:00:00Z", "2026-03-02T10:00:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T10:00:00Z", "2026-03-02T13:00:00Z", { kind: "REST" }),
                activity("2026-03-02T13:00:00Z", "2026-03-02T18:00:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T18:00:00Z", "2026-03-03T03:00:00Z", { kind: "REST" }),
                activity("2026-03-03T03:00:00Z", "2026-03-03T11:00:00Z", { kind: "DRIVING" }),
            ],
        });
        const r = evaluateAll(ctx, [restEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART8_DAILY_REST")).toEqual([]);
    });
    it("rejects a 3+8 attempt (second block must be >=9h)", async () => {
        // Driver took a 3h rest (could have been the first block of a split) but
        // the second rest is only 8h — neither a valid split (3+9) nor a valid
        // reduced rest (>=9h) on its own. The 3h rest is therefore a "failed
        // attempt" and the 8h rest is too short.
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-04T00:00:00Z" },
            activities: [
                activity("2026-03-02T05:00:00Z", "2026-03-02T10:00:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T10:00:00Z", "2026-03-02T13:00:00Z", { kind: "REST" }),
                activity("2026-03-02T13:00:00Z", "2026-03-02T18:00:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T18:00:00Z", "2026-03-03T02:00:00Z", { kind: "REST" }),
                activity("2026-03-03T02:00:00Z", "2026-03-03T08:00:00Z", { kind: "DRIVING" }),
            ],
        });
        const r = evaluateAll(ctx, [restEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART8_DAILY_REST").length).toBeGreaterThan(0);
    });
    it("flags weekly rest overdue (next weekly rest >6×24h after previous end)", async () => {
        // First weekly rest ends 2026-03-02T00:00. Next must start by 2026-03-08T00:00.
        // We give the next one starting 2026-03-09T00:00 — that's 1 day late.
        const acts = [
            activity("2026-02-28T00:00:00Z", "2026-03-02T00:00:00Z", { kind: "REST" }),
        ];
        for (let d = 0; d < 7; d++) {
            const day = 2 + d;
            acts.push(activity(`2026-03-${String(day).padStart(2, "0")}T06:00:00Z`, `2026-03-${String(day).padStart(2, "0")}T14:00:00Z`, { kind: "WORK" }));
        }
        acts.push(activity("2026-03-09T00:00:00Z", "2026-03-11T00:00:00Z", { kind: "REST" }));
        const ctx = await makeScenario({
            range: { start: "2026-02-28T00:00:00Z", end: "2026-03-11T00:00:00Z" },
            activities: acts,
        });
        const r = evaluateAll(ctx, [restEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART8_WEEKLY_REST").length).toBeGreaterThan(0);
    });
    it("compliant when next weekly rest starts within 6×24h", async () => {
        const acts = [
            activity("2026-02-28T00:00:00Z", "2026-03-02T00:00:00Z", { kind: "REST" }),
        ];
        for (let d = 0; d < 5; d++) {
            const day = 2 + d;
            acts.push(activity(`2026-03-${String(day).padStart(2, "0")}T06:00:00Z`, `2026-03-${String(day).padStart(2, "0")}T14:00:00Z`, { kind: "WORK" }));
        }
        acts.push(activity("2026-03-07T00:00:00Z", "2026-03-09T00:00:00Z", { kind: "REST" }));
        const ctx = await makeScenario({
            range: { start: "2026-02-28T00:00:00Z", end: "2026-03-09T00:00:00Z" },
            activities: acts,
        });
        const r = evaluateAll(ctx, [restEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART8_WEEKLY_REST")).toEqual([]);
    });
    it("flags a week with no >=24h rest", async () => {
        const acts = [];
        for (let d = 0; d < 7; d++) {
            const day = 2 + d;
            acts.push(activity(`2026-03-${String(day).padStart(2, "0")}T06:00:00Z`, `2026-03-${String(day).padStart(2, "0")}T14:00:00Z`, { kind: "WORK" }));
        }
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-09T00:00:00Z" },
            activities: acts,
        });
        const r = evaluateAll(ctx, [restEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART8_WEEKLY_REST").length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=rest.test.js.map
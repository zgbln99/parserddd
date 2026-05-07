import { describe, expect, it } from "vitest";
import { evaluateAll } from "../evaluators/registry.js";
import { activity } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";
describe("edge cases", () => {
    it("handles DST spring-forward without throwing", async () => {
        // 2026-03-29: Europe/Berlin clocks jump from 02:00 → 03:00 local.
        const ctx = await makeScenario({
            range: { start: "2026-03-28T22:00:00Z", end: "2026-03-29T22:00:00Z" },
            activities: [
                activity("2026-03-29T00:00:00Z", "2026-03-29T08:00:00Z", { kind: "DRIVING" }),
            ],
        });
        expect(() => evaluateAll(ctx)).not.toThrow();
    });
    it("ferry/train interruption does not break the rest run", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-04T00:00:00Z" },
            activities: [
                activity("2026-03-02T05:00:00Z", "2026-03-02T13:00:00Z", { kind: "DRIVING" }),
                activity("2026-03-02T13:00:00Z", "2026-03-02T19:00:00Z", { kind: "REST" }),
                activity("2026-03-02T19:00:00Z", "2026-03-02T20:00:00Z", {
                    kind: "WORK",
                    ferry_train: true,
                }),
                activity("2026-03-02T20:00:00Z", "2026-03-03T00:30:00Z", { kind: "REST" }),
                activity("2026-03-03T00:30:00Z", "2026-03-03T08:30:00Z", { kind: "DRIVING" }),
            ],
        });
        const r = evaluateAll(ctx);
        // The ferry-train interruption should NOT cause the daily-rest evaluator
        // to mis-count and emit a violation for that span.
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART8_DAILY_REST")).toEqual([]);
    });
    it("OUT-of-scope activity short enough does not flag misuse", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
            activities: [
                activity("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z", {
                    kind: "DRIVING",
                    out_of_scope: true,
                }),
            ],
        });
        const r = evaluateAll(ctx);
        expect(r.violations.filter((v) => v.rule_id === "EU_165_OUT_MISUSE")).toEqual([]);
    });
    it("entirely empty activity list still produces a normalized timeline", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
            activities: [],
        });
        expect(ctx.timeline.activities.length).toBeGreaterThan(0);
        expect(ctx.timeline.activities[0]?.kind).toBe("UNKNOWN");
    });
});
//# sourceMappingURL=edge-cases.test.js.map
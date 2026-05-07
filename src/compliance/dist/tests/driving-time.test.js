import { describe, expect, it } from "vitest";
import { evaluateAll } from "../evaluators/registry.js";
import { drivingTimeEvaluator } from "../evaluators/driving-time.js";
import { activity } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";
const day = (offset, drivingHours) => activity(`2026-03-${String(2 + offset).padStart(2, "0")}T06:00:00Z`, `2026-03-${String(2 + offset).padStart(2, "0")}T${String(6 + drivingHours).padStart(2, "0")}:00:00Z`, { kind: "DRIVING" });
describe("driving-time evaluator", () => {
    it("permits up to 9h normal driving on Monday", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-03T00:00:00Z" },
            activities: [day(0, 9)],
        });
        const r = evaluateAll(ctx, [drivingTimeEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART6_DAILY_DRIVING")).toEqual([]);
    });
    it("permits 10h once a week as the first extension day", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-03T00:00:00Z" },
            activities: [day(0, 10)],
        });
        const r = evaluateAll(ctx, [drivingTimeEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART6_DAILY_DRIVING")).toEqual([]);
    });
    it("flags a 3rd 10h extension in the same ISO week", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-08T00:00:00Z" },
            activities: [day(0, 10), day(1, 10), day(2, 10)],
        });
        const r = evaluateAll(ctx, [drivingTimeEvaluator]);
        const viol = r.violations.filter((v) => v.rule_id === "EU_561_ART6_DAILY_DRIVING");
        expect(viol).toHaveLength(1);
    });
    it("flags any day above 10h regardless of extension budget", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-03T00:00:00Z" },
            activities: [day(0, 11)],
        });
        const r = evaluateAll(ctx, [drivingTimeEvaluator]);
        const viol = r.violations.filter((v) => v.rule_id === "EU_561_ART6_DAILY_DRIVING");
        expect(viol).toHaveLength(1);
        expect(viol[0]?.measured_value).toBe(11 * 60);
        expect(viol[0]?.allowed_value).toBe(10 * 60);
    });
    it("flags weekly driving > 56h", async () => {
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-09T00:00:00Z" },
            activities: [day(0, 10), day(1, 10), day(2, 10), day(3, 10), day(4, 10), day(5, 10)],
        });
        const r = evaluateAll(ctx, [drivingTimeEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART6_WEEKLY_DRIVING")).toHaveLength(1);
    });
    it("flags two-week driving > 90h", async () => {
        const acts = [];
        for (let week = 0; week < 2; week++) {
            const monday = 2 + week * 7;
            for (let d = 0; d < 6; d++) {
                const dayDate = monday + d;
                acts.push(activity(`2026-03-${String(dayDate).padStart(2, "0")}T06:00:00Z`, `2026-03-${String(dayDate).padStart(2, "0")}T14:30:00Z`, { kind: "DRIVING" }));
            }
        }
        const ctx = await makeScenario({
            range: { start: "2026-03-02T00:00:00Z", end: "2026-03-16T00:00:00Z" },
            activities: acts,
        });
        const r = evaluateAll(ctx, [drivingTimeEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_561_ART6_TWO_WEEK_DRIVING").length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=driving-time.test.js.map
import { describe, expect, it } from "vitest";
import { eventsFaultsEvaluator } from "../evaluators/events-faults.js";
import { evaluateAll } from "../evaluators/registry.js";
import { tachoEvent, printoutFx } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";
const RANGE = { start: "2026-03-02T00:00:00Z", end: "2026-03-03T00:00:00Z" };
describe("events / faults / manipulation / printout evaluator", () => {
    it("classifies events vs faults vs manipulation by code prefix", async () => {
        const ctx = await makeScenario({
            range: RANGE,
            events: [
                tachoEvent("EVENT_OVER_SPEED", "2026-03-02T08:00:00Z"),
                tachoEvent("FAULT_CARD_INSERT_FAILURE", "2026-03-02T09:00:00Z", {
                    end: new Date("2026-03-02T09:30:00Z"),
                }),
                tachoEvent("MANIPULATION_MOTION_SENSOR", "2026-03-02T10:00:00Z"),
            ],
            printouts: [printoutFx("2026-03-02T09:30:00Z")],
        });
        const r = evaluateAll(ctx, [eventsFaultsEvaluator]);
        const ids = r.violations.map((v) => v.rule_id);
        expect(ids).toContain("EU_165_TACHOGRAPH_EVENT");
        expect(ids).toContain("EU_165_TACHOGRAPH_FAULT");
        expect(ids).toContain("EU_165_MANIPULATION_INDICATOR");
    });
    it("flags fault without printout", async () => {
        const ctx = await makeScenario({
            range: RANGE,
            events: [
                tachoEvent("FAULT_PRINTER", "2026-03-02T08:00:00Z", {
                    end: new Date("2026-03-02T09:00:00Z"),
                }),
            ],
            printouts: [],
        });
        const r = evaluateAll(ctx, [eventsFaultsEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_165_PRINTOUT_REQUIRED")).toHaveLength(1);
    });
    it("counts an existing matching printout as compliant for that fault", async () => {
        const ctx = await makeScenario({
            range: RANGE,
            events: [
                tachoEvent("FAULT_PRINTER", "2026-03-02T08:00:00Z", {
                    end: new Date("2026-03-02T09:00:00Z"),
                }),
            ],
            printouts: [printoutFx("2026-03-02T09:30:00Z")],
        });
        const r = evaluateAll(ctx, [eventsFaultsEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_165_PRINTOUT_REQUIRED")).toEqual([]);
    });
});
//# sourceMappingURL=events-faults.test.js.map
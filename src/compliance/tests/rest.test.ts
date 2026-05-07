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
    expect(
      r.violations.filter((v) => v.rule_id === "EU_561_ART8_DAILY_REST").length,
    ).toBeGreaterThan(0);
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
    expect(
      r.violations.filter((v) => v.rule_id === "EU_561_ART8_DAILY_REST"),
    ).toEqual([]);
  });

  it("flags a week with no >=24h rest", async () => {
    const acts = [];
    for (let d = 0; d < 7; d++) {
      const day = 2 + d;
      acts.push(
        activity(
          `2026-03-${String(day).padStart(2, "0")}T06:00:00Z`,
          `2026-03-${String(day).padStart(2, "0")}T14:00:00Z`,
          { kind: "WORK" },
        ),
      );
    }
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-09T00:00:00Z" },
      activities: acts,
    });
    const r = evaluateAll(ctx, [restEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "EU_561_ART8_WEEKLY_REST").length,
    ).toBeGreaterThan(0);
  });
});

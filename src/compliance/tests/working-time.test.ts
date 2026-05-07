import { describe, expect, it } from "vitest";
import { workingTimeEvaluator } from "../evaluators/working-time.js";
import { evaluateAll } from "../evaluators/registry.js";
import { activity } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";

describe("working-time evaluator (KrFArbZG)", () => {
  it("flags daily work above 10h", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-03T00:00:00Z" },
      activities: [
        activity("2026-03-02T05:00:00Z", "2026-03-02T16:00:00Z", { kind: "WORK" }),
      ],
    });
    const r = evaluateAll(ctx, [workingTimeEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "DE_KRFARBZG_DAILY_WORKING_TIME"),
    ).toHaveLength(1);
  });

  it("flags missing 30min break after 6h work", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-03T00:00:00Z" },
      activities: [
        activity("2026-03-02T06:00:00Z", "2026-03-02T13:00:00Z", { kind: "WORK" }),
      ],
    });
    const r = evaluateAll(ctx, [workingTimeEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "DE_KRFARBZG_BREAKS"),
    ).toHaveLength(1);
  });

  it("flags night work day above 10h", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-03T00:00:00Z" },
      activities: [
        activity("2026-03-02T01:00:00Z", "2026-03-02T15:00:00Z", { kind: "WORK" }),
      ],
    });
    const r = evaluateAll(ctx, [workingTimeEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "DE_KRFARBZG_NIGHT_WORK").length,
    ).toBeGreaterThan(0);
  });
});

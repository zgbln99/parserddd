import { describe, expect, it } from "vitest";
import { evaluateAll } from "../evaluators/registry.js";
import { activitySelectionEvaluator } from "../evaluators/activity-selection.js";
import { activity, cardSession } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";

describe("activity-selection evaluator", () => {
  it("flags rest selected during a card session that recorded movement", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
      activities: [
        activity("2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z", { kind: "REST" }),
      ],
      card_sessions: [
        cardSession("2026-03-02T05:00:00Z", "2026-03-02T18:00:00Z", {
          start_odometer_km: 100_000,
          end_odometer_km: 100_200,
        }),
      ],
    });
    const r = evaluateAll(ctx, [activitySelectionEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "EU_165_REST_DURING_WORK"),
    ).toHaveLength(1);
  });

  it("flags OUT misuse on long OUT runs", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-03T08:00:00Z" },
      activities: [
        activity("2026-03-02T06:00:00Z", "2026-03-03T06:00:00Z", {
          kind: "DRIVING",
          out_of_scope: true,
        }),
      ],
    });
    const r = evaluateAll(ctx, [activitySelectionEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "EU_165_OUT_MISUSE").length,
    ).toBeGreaterThan(0);
  });

  it("flags availability sandwich pattern", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
      activities: [
        activity("2026-03-02T06:00:00Z", "2026-03-02T09:00:00Z", { kind: "DRIVING" }),
        activity("2026-03-02T09:00:00Z", "2026-03-02T09:30:00Z", { kind: "AVAILABILITY" }),
        activity("2026-03-02T09:30:00Z", "2026-03-02T13:00:00Z", { kind: "DRIVING" }),
      ],
    });
    const r = evaluateAll(ctx, [activitySelectionEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "EU_165_AVAILABILITY_INSTEAD_OF_WORK")
        .length,
    ).toBeGreaterThan(0);
  });
});

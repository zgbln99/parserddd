import { describe, expect, it } from "vitest";
import { evaluateAll } from "../evaluators/registry.js";
import { cardEvaluator } from "../evaluators/card.js";
import { activity, cardSession } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";

describe("card evaluator", () => {
  it("flags driving without card_inserted=true", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
      activities: [
        activity("2026-03-02T06:00:00Z", "2026-03-02T08:00:00Z", {
          kind: "DRIVING",
          card_inserted: false,
        }),
      ],
      card_sessions: [],
    });
    const r = evaluateAll(ctx, [cardEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "EU_165_DRIVING_WITHOUT_CARD"),
    ).toHaveLength(1);
  });

  it("flags wrong slot (driving on co-driver slot)", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
      activities: [
        activity("2026-03-02T06:00:00Z", "2026-03-02T08:00:00Z", {
          kind: "DRIVING",
          slot: "CO_DRIVER",
        }),
      ],
      card_sessions: [
        cardSession("2026-03-02T05:00:00Z", "2026-03-02T18:00:00Z"),
      ],
    });
    const r = evaluateAll(ctx, [cardEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "EU_165_WRONG_SLOT"),
    ).toHaveLength(1);
  });

  it("flags card removed too early when shift continues", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
      activities: [
        activity("2026-03-02T06:00:00Z", "2026-03-02T11:00:00Z", { kind: "DRIVING" }),
        activity("2026-03-02T11:00:00Z", "2026-03-02T14:00:00Z", { kind: "WORK" }),
      ],
      card_sessions: [
        cardSession("2026-03-02T05:00:00Z", "2026-03-02T11:00:00Z"),
      ],
    });
    const r = evaluateAll(ctx, [cardEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "EU_165_CARD_REMOVED_TOO_EARLY")
        .length,
    ).toBeGreaterThan(0);
  });

  it("flags missing co-driver when multi_manning declared", async () => {
    const ctx = await makeScenario({
      range: { start: "2026-03-02T00:00:00Z", end: "2026-03-02T20:00:00Z" },
      activities: [
        activity("2026-03-02T06:00:00Z", "2026-03-02T14:00:00Z", {
          kind: "DRIVING",
          notes: ["multi_manning"],
        }),
      ],
      card_sessions: [
        cardSession("2026-03-02T05:00:00Z", "2026-03-02T18:00:00Z"),
      ],
    });
    const r = evaluateAll(ctx, [cardEvaluator]);
    expect(
      r.violations.filter((v) => v.rule_id === "EU_165_MISSING_CO_DRIVER"),
    ).toHaveLength(1);
  });
});

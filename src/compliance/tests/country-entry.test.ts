import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadComplianceBundle } from "../loaders/rule-loader.js";
import { normalizeTimeline } from "../normalizers/timeline-normalizer.js";
import { evaluateAll } from "../evaluators/registry.js";
import { TEST_DRIVER, activity, cardSession } from "../fixtures/builder.js";

const RULES_ROOT = resolve(__dirname, "..", "..", "..", "rules");
const TZ = "Europe/Berlin";

async function makeCtx(opts: {
  card_sessions: Parameters<typeof cardSession>[2][];
}) {
  const bundle = await loadComplianceBundle(RULES_ROOT);
  const timeline = normalizeTimeline({
    driver_id: TEST_DRIVER,
    range_start: new Date("2026-01-10T00:00:00Z"),
    range_end: new Date("2026-01-10T22:00:00Z"),
    activity_candidates: [
      activity("2026-01-10T06:00:00Z", "2026-01-10T08:00:00Z", { kind: "DRIVING" }),
    ],
    card_sessions: opts.card_sessions.map((o, i) =>
      cardSession(`2026-01-10T0${5 + i}:00:00Z`, `2026-01-10T0${9 + i}:00:00Z`, o ?? {}),
    ),
    manual_entries: [],
    events: [],
    printouts: [],
  });
  return {
    timeline,
    rules: bundle.rules,
    fines: bundle.fines,
    evaluated_at: new Date("2026-01-11T00:00:00Z"),
    time_zone: TZ,
  };
}

describe("country-entry evaluator", () => {
  it("flags a card session missing start_country", async () => {
    const ctx = await makeCtx({
      card_sessions: [{ start_country: null, end_country: "DE" }],
    });
    const result = evaluateAll(ctx);
    const startViolations = result.violations.filter(
      (v) => v.rule_id === "EU_165_MISSING_START_COUNTRY",
    );
    expect(startViolations).toHaveLength(1);
    expect(startViolations[0]?.driver_fine_eur).toBeNull();
    expect(startViolations[0]?.title.de).toContain("Anfangsland");
    expect(startViolations[0]?.legal_basis.pl).toContain("ust. 7");
    expect(startViolations[0]?.status).toBe("pending");
  });

  it("flags a card session missing end_country", async () => {
    const ctx = await makeCtx({
      card_sessions: [{ start_country: "DE", end_country: null }],
    });
    const result = evaluateAll(ctx);
    const endViolations = result.violations.filter(
      (v) => v.rule_id === "EU_165_MISSING_END_COUNTRY",
    );
    expect(endViolations).toHaveLength(1);
  });

  it("emits no violation when both countries are present", async () => {
    const ctx = await makeCtx({
      card_sessions: [{ start_country: "DE", end_country: "PL" }],
    });
    const result = evaluateAll(ctx);
    expect(
      result.violations.filter(
        (v) =>
          v.rule_id === "EU_165_MISSING_START_COUNTRY" ||
          v.rule_id === "EU_165_MISSING_END_COUNTRY",
      ),
    ).toEqual([]);
  });

  it("returns not_evaluable when no card sessions are present", async () => {
    const ctx = await makeCtx({ card_sessions: [] });
    const result = evaluateAll(ctx);
    const ne = result.not_evaluable.map((x) => x.rule_id);
    expect(ne).toContain("EU_165_MISSING_START_COUNTRY");
    expect(ne).toContain("EU_165_MISSING_END_COUNTRY");
  });

  it("violation output carries multilingual texts and engine version", async () => {
    const ctx = await makeCtx({
      card_sessions: [{ start_country: null, end_country: null }],
    });
    const result = evaluateAll(ctx);
    const v = result.violations.find((x) => x.rule_id === "EU_165_MISSING_START_COUNTRY");
    expect(v?.legal_basis.de).toBeTruthy();
    expect(v?.legal_basis.en).toBeTruthy();
    expect(v?.legal_basis.pl).toBeTruthy();
    expect(v?.title.de).toBeTruthy();
    expect(v?.engine_version).toBeTruthy();
  });
});

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadComplianceBundle } from "../loaders/rule-loader.js";
import { normalizeTimeline } from "../normalizers/timeline-normalizer.js";
import { evaluateAll } from "../evaluators/registry.js";
import {
  TEST_DRIVER,
  activity,
  cardSession,
  manualEntry,
} from "../fixtures/builder.js";

const RULES_ROOT = resolve(__dirname, "..", "..", "..", "rules");
const TZ = "Europe/Berlin";
const RANGE_START = new Date("2026-02-01T00:00:00Z");
const RANGE_END = new Date("2026-02-01T20:00:00Z");

async function makeCtx(opts: {
  cards: ReturnType<typeof cardSession>[];
  manuals: ReturnType<typeof manualEntry>[];
  activities?: ReturnType<typeof activity>[];
}) {
  const bundle = await loadComplianceBundle(RULES_ROOT);
  const timeline = normalizeTimeline({
    driver_id: TEST_DRIVER,
    range_start: RANGE_START,
    range_end: RANGE_END,
    activity_candidates:
      opts.activities ??
      [
        activity("2026-02-01T06:00:00Z", "2026-02-01T08:00:00Z", { kind: "DRIVING" }),
      ],
    card_sessions: opts.cards,
    manual_entries: opts.manuals,
    events: [],
    printouts: [],
  });
  return {
    timeline,
    rules: bundle.rules,
    fines: bundle.fines,
    evaluated_at: new Date("2026-02-02T00:00:00Z"),
    time_zone: TZ,
  };
}

describe("manual-entry evaluator", () => {
  it("flags a card-out window with no manual entry", async () => {
    const ctx = await makeCtx({
      cards: [
        cardSession("2026-02-01T06:00:00Z", "2026-02-01T18:00:00Z", {
          start_country: "DE",
          end_country: "DE",
        }),
      ],
      manuals: [],
    });
    const result = evaluateAll(ctx);
    const v = result.violations.filter(
      (x) => x.rule_id === "EU_165_MISSING_MANUAL_ENTRY",
    );
    // Two card-out windows: [00:00, 06:00) and [18:00, 20:00)
    expect(v).toHaveLength(2);
    const totalMinutes = v.reduce((s, x) => s + (x.measured_value ?? 0), 0);
    expect(totalMinutes).toBe(8 * 60);
  });

  it("counts as compliant when manual entry covers the whole card-out window", async () => {
    const ctx = await makeCtx({
      cards: [
        cardSession("2026-02-01T06:00:00Z", "2026-02-01T18:00:00Z"),
      ],
      manuals: [
        manualEntry("2026-02-01T00:00:00Z", "2026-02-01T06:00:00Z"),
        manualEntry("2026-02-01T18:00:00Z", "2026-02-01T20:00:00Z"),
      ],
    });
    const result = evaluateAll(ctx);
    expect(
      result.violations.filter(
        (x) => x.rule_id === "EU_165_MISSING_MANUAL_ENTRY",
      ),
    ).toEqual([]);
  });

  it("flags an incomplete manual entry", async () => {
    const ctx = await makeCtx({
      cards: [
        cardSession("2026-02-01T06:00:00Z", "2026-02-01T18:00:00Z"),
      ],
      manuals: [
        manualEntry("2026-02-01T00:00:00Z", "2026-02-01T06:00:00Z", { complete: false }),
        manualEntry("2026-02-01T18:00:00Z", "2026-02-01T20:00:00Z", { complete: true }),
      ],
    });
    const result = evaluateAll(ctx);
    const incomplete = result.violations.filter(
      (x) => x.rule_id === "EU_165_INCOMPLETE_MANUAL_ENTRY",
    );
    expect(incomplete).toHaveLength(1);
  });

  it("returns not_evaluable when activities exist but no card sessions", async () => {
    const ctx = await makeCtx({
      cards: [],
      manuals: [],
      activities: [
        activity("2026-02-01T06:00:00Z", "2026-02-01T08:00:00Z", { kind: "DRIVING" }),
      ],
    });
    const result = evaluateAll(ctx);
    const ne = result.not_evaluable.map((x) => x.rule_id);
    expect(ne).toContain("EU_165_MISSING_MANUAL_ENTRY");
  });

  it("ignores trivial sub-minute gaps between back-to-back card sessions", async () => {
    const ctx = await makeCtx({
      cards: [
        cardSession("2026-02-01T00:00:00Z", "2026-02-01T10:00:00Z"),
        cardSession("2026-02-01T10:00:30Z", "2026-02-01T20:00:00Z"),
      ],
      manuals: [],
    });
    const result = evaluateAll(ctx);
    expect(
      result.violations.filter(
        (x) => x.rule_id === "EU_165_MISSING_MANUAL_ENTRY",
      ),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { downloadsEvaluator } from "../evaluators/downloads.js";
import { evaluateAll } from "../evaluators/registry.js";
import { activity, downloadFx, inspectionFx, retentionFx } from "../fixtures/builder.js";
import { makeScenario } from "../fixtures/scenario.js";
const RANGE = { start: "2026-01-01T00:00:00Z", end: "2026-04-01T00:00:00Z" };
describe("downloads / retention / inspections evaluator", () => {
    it("returns not_evaluable when administrative is missing", async () => {
        const ctx = await makeScenario({
            range: RANGE,
            activities: [
                activity("2026-01-02T06:00:00Z", "2026-01-02T08:00:00Z", { kind: "DRIVING" }),
            ],
        });
        const r = evaluateAll(ctx, [downloadsEvaluator]);
        const ne = r.not_evaluable.map((x) => x.rule_id);
        expect(ne).toContain("EU_165_DOWNLOAD_CARD_28");
        expect(ne).toContain("EU_165_DOWNLOAD_VU_90");
        expect(ne).toContain("EU_165_DATA_RETENTION");
        expect(ne).toContain("EU_165_MISSING_INSPECTION");
    });
    it("flags card download gap > 28 days", async () => {
        const ctx = await makeScenario({
            range: RANGE,
            evaluated_at: "2026-04-01T00:00:00Z",
            administrative: {
                downloads: [
                    downloadFx("CARD", "2026-01-05T00:00:00Z"),
                    downloadFx("CARD", "2026-02-15T00:00:00Z"),
                ],
                inspections: [inspectionFx("2025-06-01T00:00:00Z")],
                retention: [],
            },
        });
        const r = evaluateAll(ctx, [downloadsEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_165_DOWNLOAD_CARD_28").length).toBeGreaterThan(0);
    });
    it("compliant when all downloads + inspection are within limits", async () => {
        const ctx = await makeScenario({
            range: RANGE,
            evaluated_at: "2026-02-15T00:00:00Z",
            administrative: {
                downloads: [
                    downloadFx("CARD", "2026-01-20T00:00:00Z"),
                    downloadFx("CARD", "2026-02-10T00:00:00Z"),
                    downloadFx("VEHICLE_UNIT", "2026-01-05T00:00:00Z"),
                    downloadFx("VEHICLE_UNIT", "2026-02-01T00:00:00Z"),
                ],
                inspections: [inspectionFx("2025-08-01T00:00:00Z")],
                retention: [],
            },
        });
        const r = evaluateAll(ctx, [downloadsEvaluator]);
        expect(r.violations).toEqual([]);
    });
    it("flags retention removed too early", async () => {
        const ctx = await makeScenario({
            range: RANGE,
            evaluated_at: "2026-04-01T00:00:00Z",
            administrative: {
                downloads: [
                    downloadFx("CARD", "2026-03-15T00:00:00Z"),
                    downloadFx("VEHICLE_UNIT", "2026-03-15T00:00:00Z"),
                ],
                inspections: [inspectionFx("2025-08-01T00:00:00Z")],
                retention: [
                    retentionFx("CARD", "2025-12-31T00:00:00Z", {
                        removed_at: new Date("2024-12-01T00:00:00Z"),
                    }),
                ],
            },
        });
        const r = evaluateAll(ctx, [downloadsEvaluator]);
        expect(r.violations.filter((v) => v.rule_id === "EU_165_DATA_RETENTION").length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=downloads.test.js.map
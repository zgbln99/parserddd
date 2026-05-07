import { describe, expect, it } from "vitest";
import { normalizeTimeline, TimelineInvariantError, } from "../normalizers/timeline-normalizer.js";
import { TEST_DRIVER, activity, cardSession, manualEntry } from "../fixtures/builder.js";
describe("timeline-normalizer", () => {
    it("fills gaps with UNKNOWN activities", () => {
        const tl = normalizeTimeline({
            driver_id: TEST_DRIVER,
            range_start: new Date("2026-01-10T00:00:00Z"),
            range_end: new Date("2026-01-10T08:00:00Z"),
            activity_candidates: [
                activity("2026-01-10T02:00:00Z", "2026-01-10T03:00:00Z", { kind: "DRIVING" }),
            ],
            card_sessions: [],
            manual_entries: [],
            events: [],
            printouts: [],
        });
        expect(tl.activities).toHaveLength(3);
        expect(tl.activities[0]?.kind).toBe("UNKNOWN");
        expect(tl.activities[1]?.kind).toBe("DRIVING");
        expect(tl.activities[2]?.kind).toBe("UNKNOWN");
        expect(tl.activities[0]?.start.toISOString()).toBe("2026-01-10T00:00:00.000Z");
        expect(tl.activities[2]?.end.toISOString()).toBe("2026-01-10T08:00:00.000Z");
    });
    it("merges overlapping candidates by source priority", () => {
        const tl = normalizeTimeline({
            driver_id: TEST_DRIVER,
            range_start: new Date("2026-01-10T00:00:00Z"),
            range_end: new Date("2026-01-10T01:00:00Z"),
            activity_candidates: [
                activity("2026-01-10T00:00:00Z", "2026-01-10T01:00:00Z", { kind: "REST", source: "INFERRED", confidence: 0.5 }),
                activity("2026-01-10T00:00:00Z", "2026-01-10T01:00:00Z", { kind: "DRIVING", source: "CARD", confidence: 1 }),
            ],
            card_sessions: [],
            manual_entries: [],
            events: [],
            printouts: [],
        });
        expect(tl.activities).toHaveLength(1);
        expect(tl.activities[0]?.kind).toBe("DRIVING");
        expect(tl.activities[0]?.source).toBe("CARD");
    });
    it("preserves additional streams (cards, manuals)", () => {
        const tl = normalizeTimeline({
            driver_id: TEST_DRIVER,
            range_start: new Date("2026-01-10T00:00:00Z"),
            range_end: new Date("2026-01-10T08:00:00Z"),
            activity_candidates: [
                activity("2026-01-10T00:00:00Z", "2026-01-10T08:00:00Z", { kind: "REST" }),
            ],
            card_sessions: [
                cardSession("2026-01-10T05:00:00Z", "2026-01-10T07:00:00Z", { start_country: "DE", end_country: "PL" }),
            ],
            manual_entries: [
                manualEntry("2026-01-10T00:00:00Z", "2026-01-10T05:00:00Z", { complete: true }),
            ],
            events: [],
            printouts: [],
        });
        expect(tl.card_sessions).toHaveLength(1);
        expect(tl.manual_entries).toHaveLength(1);
    });
    it("throws on inverted ranges", () => {
        expect(() => normalizeTimeline({
            driver_id: TEST_DRIVER,
            range_start: new Date("2026-01-10T08:00:00Z"),
            range_end: new Date("2026-01-10T00:00:00Z"),
            activity_candidates: [],
            card_sessions: [],
            manual_entries: [],
            events: [],
            printouts: [],
        })).toThrow(TimelineInvariantError);
    });
    it("guarantees contiguous, non-overlapping activities", () => {
        const tl = normalizeTimeline({
            driver_id: TEST_DRIVER,
            range_start: new Date("2026-01-10T00:00:00Z"),
            range_end: new Date("2026-01-10T10:00:00Z"),
            activity_candidates: [
                activity("2026-01-10T00:00:00Z", "2026-01-10T03:00:00Z", { kind: "REST" }),
                activity("2026-01-10T03:00:00Z", "2026-01-10T06:00:00Z", { kind: "DRIVING" }),
                activity("2026-01-10T06:00:00Z", "2026-01-10T10:00:00Z", { kind: "WORK" }),
            ],
            card_sessions: [],
            manual_entries: [],
            events: [],
            printouts: [],
        });
        for (let i = 1; i < tl.activities.length; i++) {
            expect(tl.activities[i]?.start.getTime()).toBe(tl.activities[i - 1]?.end.getTime());
        }
    });
});
//# sourceMappingURL=normalizer.test.js.map
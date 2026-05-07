import { resolve } from "node:path";
import { loadComplianceBundle } from "../loaders/rule-loader.js";
import { normalizeTimeline } from "../normalizers/timeline-normalizer.js";
import { TEST_DRIVER } from "./builder.js";
export const RULES_ROOT = resolve(__dirname, "..", "..", "..", "rules");
let cache = null;
export async function loadBundleCached() {
    if (cache)
        return cache;
    cache = await loadComplianceBundle(RULES_ROOT);
    return cache;
}
const D = (x) => (typeof x === "string" ? new Date(x) : x);
export async function makeScenario(input) {
    const bundle = await loadBundleCached();
    if (!bundle)
        throw new Error("rule bundle failed to load");
    const timeline = normalizeTimeline({
        driver_id: TEST_DRIVER,
        range_start: D(input.range.start),
        range_end: D(input.range.end),
        activity_candidates: input.activities ?? [],
        card_sessions: input.card_sessions ?? [],
        manual_entries: input.manual_entries ?? [],
        events: input.events ?? [],
        printouts: input.printouts ?? [],
    });
    return {
        timeline,
        rules: bundle.rules,
        fines: bundle.fines,
        evaluated_at: D(input.evaluated_at ?? "2026-03-01T00:00:00Z"),
        time_zone: input.time_zone ?? "Europe/Berlin",
        administrative: input.administrative,
    };
}
//# sourceMappingURL=scenario.js.map
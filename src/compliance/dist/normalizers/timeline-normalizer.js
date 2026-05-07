import { fillGapsAsUnknown, mergeActivities, } from "../calculations/activity-merge.js";
import { sortIntervals } from "../calculations/time.js";
export class TimelineInvariantError extends Error {
    invariant;
    constructor(invariant, detail) {
        super(`timeline invariant violated [${invariant}]: ${detail}`);
        this.name = "TimelineInvariantError";
        this.invariant = invariant;
    }
}
/**
 * Build a deterministic Timeline from raw parsed input.
 *
 * Steps:
 *  1. Merge activity candidates (resolves overlaps, picks best source/kind).
 *  2. Fill holes with UNKNOWN activities so the resulting list is dense.
 *  3. Sort & deep-freeze for evaluator safety.
 *  4. Verify invariants and throw if anything is off — evaluators MUST be
 *     able to assume a clean timeline.
 */
export function normalizeTimeline(input) {
    if (input.range_end <= input.range_start) {
        throw new TimelineInvariantError("range", `range_end (${input.range_end.toISOString()}) must be after range_start (${input.range_start.toISOString()})`);
    }
    const merged = mergeActivities(input.activity_candidates);
    const template = pickTemplate(merged, input);
    const dense = fillGapsAsUnknown(merged, input.range_start, input.range_end, template);
    const activities = sortIntervals(dense);
    enforceInvariants(activities, input);
    const timeline = Object.freeze({
        driver_id: input.driver_id,
        range: { start: input.range_start, end: input.range_end },
        activities: Object.freeze(activities),
        card_sessions: Object.freeze(sortIntervals([...input.card_sessions])),
        manual_entries: Object.freeze(sortIntervals([...input.manual_entries])),
        events: Object.freeze([...input.events]),
        printouts: Object.freeze([...input.printouts]),
    });
    return timeline;
}
function pickTemplate(activities, input) {
    if (activities.length > 0) {
        const a = activities[0];
        return { driver_id: a.driver_id, vehicle_id: a.vehicle_id, slot: a.slot };
    }
    return { driver_id: input.driver_id, vehicle_id: null, slot: "DRIVER" };
}
function enforceInvariants(activities, input) {
    if (activities.length === 0) {
        throw new TimelineInvariantError("non-empty", "timeline has zero activities after gap filling — should have at least one UNKNOWN block");
    }
    const first = activities[0];
    const last = activities[activities.length - 1];
    if (first.start.getTime() !== input.range_start.getTime()) {
        throw new TimelineInvariantError("covers-start", `first activity starts at ${first.start.toISOString()} but range starts at ${input.range_start.toISOString()}`);
    }
    if (last.end.getTime() !== input.range_end.getTime()) {
        throw new TimelineInvariantError("covers-end", `last activity ends at ${last.end.toISOString()} but range ends at ${input.range_end.toISOString()}`);
    }
    for (let i = 1; i < activities.length; i++) {
        const prev = activities[i - 1];
        const curr = activities[i];
        if (curr.start.getTime() !== prev.end.getTime()) {
            throw new TimelineInvariantError("contiguous", `gap or overlap between activity ${i - 1} (ends ${prev.end.toISOString()}) and ${i} (starts ${curr.start.toISOString()})`);
        }
        if (curr.end <= curr.start) {
            throw new TimelineInvariantError("positive-duration", `activity ${i} has non-positive duration`);
        }
    }
}
//# sourceMappingURL=timeline-normalizer.js.map
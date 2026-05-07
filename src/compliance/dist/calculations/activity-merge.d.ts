import type { Activity, ActivityCandidate } from "../types/activity.js";
/**
 * Merge a set of overlapping/duplicated raw activity candidates into a
 * single, contiguous, non-overlapping list of activities.
 *
 * Conflict resolution policy (deterministic):
 *   1. Higher confidence wins.
 *   2. CARD beats VEHICLE_UNIT beats MANUAL_ENTRY beats INFERRED.
 *   3. DRIVING beats WORK beats AVAILABILITY beats REST beats UNKNOWN.
 *
 * Rule (1)+(2) make sure card data trumps speculative inferences. Rule (3)
 * matches the "more restrictive activity wins on overlap" convention used
 * by every European tachograph analyzer the author is aware of — DRIVING
 * is never optimistically downgraded to REST on conflict.
 */
export declare function mergeActivities(candidates: readonly ActivityCandidate[]): Activity[];
/**
 * Detect uncovered windows inside `[range_start, range_end)` and emit them
 * as UNKNOWN activities. The normalizer uses this to ensure the timeline is
 * dense — evaluators can then trust there are no implicit gaps.
 */
export declare function fillGapsAsUnknown(activities: readonly Activity[], range_start: Date, range_end: Date, template: Pick<Activity, "driver_id" | "vehicle_id" | "slot">): Activity[];
//# sourceMappingURL=activity-merge.d.ts.map
import type { Activity } from "../types/activity.js";
import type { TimeInterval } from "../types/common.js";
/**
 * Find every "rest run": a maximal consecutive subsequence of REST
 * activities. AVAILABILITY explicitly does NOT count as rest under EU 561
 * Art. 4(g) — only REST does.
 *
 * Ferry/train interruptions ARE allowed inside a daily rest under Art. 9(1)
 * provided the activity is marked `ferry_train: true`. We pass them through
 * the run by treating them as if they were REST when computing duration.
 */
export interface RestRun extends TimeInterval {
    readonly minutes: number;
    readonly activities: readonly Activity[];
    readonly contains_ferry_train: boolean;
}
export declare function findRestRuns(activities: readonly Activity[]): RestRun[];
/**
 * EU 561 Art. 4(g) "split daily rest": a regular daily rest may be taken in
 * two periods, the first at least 3 hours uninterrupted and the second at
 * least 9 hours uninterrupted, totalling at least 12 hours.
 *
 * Returns the equivalent total minutes of a valid 3+9 split inside the
 * given window, or 0 if no valid split exists. Order matters — the 3h block
 * must come before the 9h block, because EU 561 explicitly says so.
 */
export declare function splitDailyRestMinutes(rests: readonly RestRun[], window: TimeInterval, first_min_minutes?: number, second_min_minutes?: number): number;
/**
 * Slide a 24h "operational day" window over the timeline starting from each
 * end-of-rest moment, and return the longest rest window that fits within
 * the next 24h.
 *
 * For Art. 8(2) we need to verify that within each 24h window starting at
 * shift start there is at least one REST run of `regular`/`reduced` length.
 */
export declare function longestRestWithin(rests: readonly RestRun[], window: TimeInterval): number;
//# sourceMappingURL=rest-windows.d.ts.map
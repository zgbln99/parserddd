import type { TimeInterval } from "../types/common.js";
export declare const MS_PER_MINUTE = 60000;
export declare const MS_PER_HOUR = 3600000;
export declare const MS_PER_DAY = 86400000;
/** Duration of a half-open interval, in whole milliseconds (>= 0). */
export declare function durationMs(interval: TimeInterval): number;
/** Duration in minutes, rounded to integer. */
export declare function durationMinutes(interval: TimeInterval): number;
/** Sum of durations in minutes for a list of intervals. */
export declare function sumMinutes(intervals: readonly TimeInterval[]): number;
/** True iff [a.start,a.end) and [b.start,b.end) overlap. */
export declare function overlaps(a: TimeInterval, b: TimeInterval): boolean;
/** Returns the overlap interval, or null if disjoint. */
export declare function intersect(a: TimeInterval, b: TimeInterval): TimeInterval | null;
/** True iff `outer` fully contains `inner` (closed-open semantics). */
export declare function contains(outer: TimeInterval, inner: TimeInterval): boolean;
/** Sort intervals ascending by start; stable-sorts by end as tiebreaker. */
export declare function sortIntervals<T extends TimeInterval>(xs: readonly T[]): T[];
/**
 * Build the (sorted, non-overlapping) gap intervals inside `bounds` that are
 * not covered by any of the input intervals. Useful for finding manual-entry
 * gaps and "no card" windows.
 */
export declare function findGaps(bounds: TimeInterval, covered: readonly TimeInterval[]): TimeInterval[];
/**
 * Local date key (YYYY-MM-DD) for a timestamp under a fixed timezone offset.
 *
 * `tz_offset_minutes` is the offset added to UTC to obtain local time
 * (Europe/Berlin = +60 in winter, +120 in summer). We expect a DST-aware
 * caller to supply the right offset for the moment in question — see
 * `localDateKey` in time-zones.ts for the higher-level helper.
 */
export declare function utcDateKey(date: Date): string;
export declare function shiftedDateKey(date: Date, tz_offset_minutes: number): string;
//# sourceMappingURL=time.d.ts.map
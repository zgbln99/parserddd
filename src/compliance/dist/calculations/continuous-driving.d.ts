import type { Activity } from "../types/activity.js";
/**
 * EU 561/2006 Art. 7 break detection.
 *
 * A break "interrupts" a driving period if it is at least 15 minutes
 * uninterrupted. After 4h30 of driving without a 45-minute break (which may
 * be split as 15 + 30 in that order), a violation occurs.
 *
 * This helper finds every continuous driving span and the latest moment by
 * which a 45-minute (cumulative) break needed to start. Splitting rules are
 * encoded by the caller via the `split_pattern` from the YAML rule set.
 *
 * Implementation note: "driving" includes only DRIVING activities. Short
 * non-driving activities of duration < min_break_minutes are treated as part
 * of the driving span (this matches the AETR/EU 561 interpretation).
 */
export interface DrivingSegment {
    readonly start: Date;
    readonly end: Date;
    /** Total driving minutes inside the segment. */
    readonly driving_minutes: number;
    /**
     * The activities that form the segment, in chronological order. May
     * include short non-driving activities that did not qualify as breaks.
     */
    readonly activities: readonly Activity[];
}
export interface ContinuousDrivingOptions {
    readonly min_break_minutes: number;
    readonly split_pattern?: readonly number[];
}
/**
 * Split the timeline into "driving segments" separated by qualifying breaks.
 *
 * A break qualifies if either:
 *  - it lasts >= `min_break_minutes` (default 45) of pure non-driving (REST,
 *    AVAILABILITY, or WORK does NOT qualify under Art. 7 — only REST and
 *    BREAK count; we accept REST for now and leave WORK/AVAILABILITY
 *    upstream), OR
 *  - the cumulative pattern matches `split_pattern` (e.g. [15, 30]) in
 *    order, with no driving in between.
 *
 * Note: per EU 561 the FIRST split must be at least 15 minutes and the
 * SECOND at least 30 minutes, and they must be in that order. The pattern
 * array encodes the minimum lengths in legal order.
 */
export declare function splitDrivingSegments(activities: readonly Activity[], options: ContinuousDrivingOptions): DrivingSegment[];
/**
 * Returns the maximum continuous driving minutes inside a segment, ignoring
 * any incidental non-driving micro-pauses. This is the value compared to the
 * 4h30 threshold from EU 561 Art. 7.
 */
export declare function maxContinuousDrivingMinutes(segment: DrivingSegment): number;
//# sourceMappingURL=continuous-driving.d.ts.map
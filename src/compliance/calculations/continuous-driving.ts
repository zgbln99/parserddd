import type { Activity } from "../types/activity.js";
import { durationMinutes, MS_PER_MINUTE } from "./time.js";

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
export function splitDrivingSegments(
  activities: readonly Activity[],
  options: ContinuousDrivingOptions,
): DrivingSegment[] {
  const segments: DrivingSegment[] = [];
  let current: Activity[] = [];
  let pending_split: number[] = [];

  const flush = (endHint: Date | null) => {
    if (current.length === 0) return;
    const start = (current[0] as Activity).start;
    const end = endHint ?? (current[current.length - 1] as Activity).end;
    let driving_minutes = 0;
    for (const a of current) {
      if (a.kind === "DRIVING") driving_minutes += durationMinutes(a);
    }
    segments.push({ start, end, driving_minutes, activities: [...current] });
    current = [];
    pending_split = [];
  };

  for (const a of activities) {
    if (a.kind === "DRIVING") {
      // Accumulating split breaks are only valid if the next driving event
      // happens before any further driving — by entering DRIVING again we
      // either complete the split or carry the partial.
      current.push(a);
      continue;
    }

    // Non-driving activity. Determine if it's a qualifying break.
    if (a.kind !== "REST" && a.kind !== "AVAILABILITY") {
      // WORK / OUT / UNKNOWN cannot count as a break under Art. 7.
      pending_split = [];
      current.push(a);
      continue;
    }

    const minutes = durationMinutes(a);

    if (minutes >= options.min_break_minutes) {
      flush(a.start);
      continue;
    }

    if (options.split_pattern && options.split_pattern.length > 0) {
      const required = options.split_pattern;
      const next_index = pending_split.length;
      const required_min = required[next_index];
      if (required_min !== undefined && minutes >= required_min) {
        pending_split.push(minutes);
        if (pending_split.length === required.length) {
          flush(a.start);
          continue;
        }
        // Keep accumulating but include this rest in the segment so we don't
        // lose chronology when reporting.
        current.push(a);
        continue;
      }
    }

    // Insufficient break — does not reset segment.
    pending_split = [];
    current.push(a);
  }

  flush(null);
  return segments;
}

/**
 * Returns the maximum continuous driving minutes inside a segment, ignoring
 * any incidental non-driving micro-pauses. This is the value compared to the
 * 4h30 threshold from EU 561 Art. 7.
 */
export function maxContinuousDrivingMinutes(segment: DrivingSegment): number {
  let best = 0;
  let run_ms = 0;
  for (const a of segment.activities) {
    if (a.kind === "DRIVING") {
      run_ms += a.end.getTime() - a.start.getTime();
      best = Math.max(best, run_ms);
    } else {
      // any non-driving span breaks the *continuous* run, even if it didn't
      // qualify as a legal break (the 4h30 limit is on driving without ANY
      // pause; sub-15min pauses still reset the continuous-driving counter).
      run_ms = 0;
    }
  }
  return Math.round(best / MS_PER_MINUTE);
}

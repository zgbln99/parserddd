import type { Activity } from "../types/activity.js";
import type { TimeInterval } from "../types/common.js";
import { MS_PER_MINUTE } from "./time.js";

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

export function findRestRuns(activities: readonly Activity[]): RestRun[] {
  const out: RestRun[] = [];
  let current: Activity[] = [];
  let ferry = false;

  const flush = () => {
    if (current.length === 0) return;
    const start = (current[0] as Activity).start;
    const end = (current[current.length - 1] as Activity).end;
    out.push({
      start,
      end,
      minutes: Math.round((end.getTime() - start.getTime()) / MS_PER_MINUTE),
      activities: [...current],
      contains_ferry_train: ferry,
    });
    current = [];
    ferry = false;
  };

  for (const a of activities) {
    const counts =
      a.kind === "REST" ||
      (a.ferry_train && (a.kind === "WORK" || a.kind === "AVAILABILITY"));
    if (counts) {
      current.push(a);
      if (a.ferry_train) ferry = true;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

/**
 * EU 561 Art. 4(g) "split daily rest": a regular daily rest may be taken in
 * two periods, the first at least 3 hours uninterrupted and the second at
 * least 9 hours uninterrupted, totalling at least 12 hours.
 *
 * Returns the equivalent total minutes of a valid 3+9 split inside the
 * given window, or 0 if no valid split exists. Order matters — the 3h block
 * must come before the 9h block, because EU 561 explicitly says so.
 */
export function splitDailyRestMinutes(
  rests: readonly RestRun[],
  window: TimeInterval,
  first_min_minutes = 180,
  second_min_minutes = 540,
): number {
  const inside = rests
    .filter((r) => r.start >= window.start && r.end <= window.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (inside.length < 2) return 0;

  for (let i = 0; i < inside.length - 1; i++) {
    const first = inside[i] as RestRun;
    if (first.minutes < first_min_minutes) continue;
    for (let j = i + 1; j < inside.length; j++) {
      const second = inside[j] as RestRun;
      if (second.minutes >= second_min_minutes) {
        return first.minutes + second.minutes;
      }
    }
  }
  return 0;
}

/**
 * Slide a 24h "operational day" window over the timeline starting from each
 * end-of-rest moment, and return the longest rest window that fits within
 * the next 24h.
 *
 * For Art. 8(2) we need to verify that within each 24h window starting at
 * shift start there is at least one REST run of `regular`/`reduced` length.
 */
export function longestRestWithin(
  rests: readonly RestRun[],
  window: TimeInterval,
): number {
  let best = 0;
  for (const r of rests) {
    if (r.end <= window.start || r.start >= window.end) continue;
    const start = r.start < window.start ? window.start : r.start;
    const end = r.end > window.end ? window.end : r.end;
    const minutes = Math.round((end.getTime() - start.getTime()) / MS_PER_MINUTE);
    if (minutes > best) best = minutes;
  }
  return best;
}

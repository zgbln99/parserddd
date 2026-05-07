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

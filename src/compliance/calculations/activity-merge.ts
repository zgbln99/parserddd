import type {
  Activity,
  ActivityCandidate,
  ActivityKind,
} from "../types/activity.js";
import { asActivityId } from "../types/common.js";
import { sortIntervals } from "./time.js";

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
export function mergeActivities(
  candidates: readonly ActivityCandidate[],
): Activity[] {
  if (candidates.length === 0) return [];

  // Build sweep events for boundary points.
  const points = new Set<number>();
  for (const c of candidates) {
    points.add(c.start.getTime());
    points.add(c.end.getTime());
  }
  const sorted = [...points].sort((a, b) => a - b);

  const out: Activity[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = new Date(sorted[i] as number);
    const end = new Date(sorted[i + 1] as number);
    const overlapping = candidates.filter(
      (c) => c.start.getTime() <= start.getTime() && c.end.getTime() >= end.getTime(),
    );
    if (overlapping.length === 0) continue;
    const winner = pickWinner(overlapping);

    // Coalesce with the previous emitted activity if everything matches.
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.end.getTime() === start.getTime() &&
      sameSemantics(prev, winner)
    ) {
      out[out.length - 1] = { ...prev, end };
      continue;
    }
    out.push(materialize(winner, start, end, out.length));
  }

  return out;
}

function pickWinner(xs: readonly ActivityCandidate[]): ActivityCandidate {
  const sorted = [...xs].sort((a, b) => {
    const confA = a.confidence ?? 1;
    const confB = b.confidence ?? 1;
    if (confA !== confB) return confB - confA;
    const sA = sourceWeight(a.source);
    const sB = sourceWeight(b.source);
    if (sA !== sB) return sB - sA;
    return kindWeight(b.kind) - kindWeight(a.kind);
  });
  return sorted[0] as ActivityCandidate;
}

function sourceWeight(s: ActivityCandidate["source"]): number {
  switch (s) {
    case "CARD":
      return 4;
    case "VEHICLE_UNIT":
      return 3;
    case "MANUAL_ENTRY":
      return 2;
    case "INFERRED":
      return 1;
  }
}

function kindWeight(k: ActivityKind): number {
  switch (k) {
    case "DRIVING":
      return 5;
    case "WORK":
      return 4;
    case "AVAILABILITY":
      return 3;
    case "REST":
      return 2;
    case "UNKNOWN":
      return 1;
  }
}

function sameSemantics(a: Activity, b: ActivityCandidate): boolean {
  return (
    a.kind === b.kind &&
    a.source === b.source &&
    a.slot === b.slot &&
    a.driver_id === b.driver_id &&
    a.vehicle_id === b.vehicle_id &&
    a.card_inserted === b.card_inserted &&
    a.out_of_scope === b.out_of_scope &&
    a.ferry_train === b.ferry_train &&
    a.start_country === b.start_country &&
    a.end_country === b.end_country
  );
}

function materialize(
  c: ActivityCandidate,
  start: Date,
  end: Date,
  ordinal: number,
): Activity {
  return {
    id: c.id ?? asActivityId(`a_${ordinal.toString(36)}_${start.getTime().toString(36)}`),
    driver_id: c.driver_id,
    vehicle_id: c.vehicle_id,
    kind: c.kind,
    source: c.source,
    slot: c.slot,
    card_inserted: c.card_inserted,
    out_of_scope: c.out_of_scope,
    ferry_train: c.ferry_train,
    start_country: c.start_country,
    end_country: c.end_country,
    confidence: c.confidence ?? 1,
    notes: c.notes,
    start,
    end,
  };
}

/**
 * Detect uncovered windows inside `[range_start, range_end)` and emit them
 * as UNKNOWN activities. The normalizer uses this to ensure the timeline is
 * dense — evaluators can then trust there are no implicit gaps.
 */
export function fillGapsAsUnknown(
  activities: readonly Activity[],
  range_start: Date,
  range_end: Date,
  template: Pick<Activity, "driver_id" | "vehicle_id" | "slot">,
): Activity[] {
  const sorted = sortIntervals(activities);
  const out: Activity[] = [];
  let cursor = range_start;
  for (const a of sorted) {
    if (a.start > cursor) {
      out.push(makeUnknown(cursor, a.start, template, out.length));
    }
    out.push(a);
    if (a.end > cursor) cursor = a.end;
  }
  if (cursor < range_end) {
    out.push(makeUnknown(cursor, range_end, template, out.length));
  }
  return out;
}

function makeUnknown(
  start: Date,
  end: Date,
  t: Pick<Activity, "driver_id" | "vehicle_id" | "slot">,
  ordinal: number,
): Activity {
  return {
    id: asActivityId(`u_${ordinal.toString(36)}_${start.getTime().toString(36)}`),
    driver_id: t.driver_id,
    vehicle_id: t.vehicle_id,
    kind: "UNKNOWN",
    source: "INFERRED",
    slot: t.slot,
    card_inserted: false,
    out_of_scope: false,
    ferry_train: false,
    start_country: null,
    end_country: null,
    confidence: 0,
    notes: ["gap filled by normalizer"],
    start,
    end,
  };
}

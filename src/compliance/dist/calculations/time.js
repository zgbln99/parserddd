export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
/** Duration of a half-open interval, in whole milliseconds (>= 0). */
export function durationMs(interval) {
    return Math.max(0, interval.end.getTime() - interval.start.getTime());
}
/** Duration in minutes, rounded to integer. */
export function durationMinutes(interval) {
    return Math.round(durationMs(interval) / MS_PER_MINUTE);
}
/** Sum of durations in minutes for a list of intervals. */
export function sumMinutes(intervals) {
    let ms = 0;
    for (const i of intervals)
        ms += durationMs(i);
    return Math.round(ms / MS_PER_MINUTE);
}
/** True iff [a.start,a.end) and [b.start,b.end) overlap. */
export function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
}
/** Returns the overlap interval, or null if disjoint. */
export function intersect(a, b) {
    const start = a.start.getTime() > b.start.getTime() ? a.start : b.start;
    const end = a.end.getTime() < b.end.getTime() ? a.end : b.end;
    if (start >= end)
        return null;
    return { start, end };
}
/** True iff `outer` fully contains `inner` (closed-open semantics). */
export function contains(outer, inner) {
    return outer.start <= inner.start && outer.end >= inner.end;
}
/** Sort intervals ascending by start; stable-sorts by end as tiebreaker. */
export function sortIntervals(xs) {
    return [...xs].sort((x, y) => {
        const ds = x.start.getTime() - y.start.getTime();
        return ds !== 0 ? ds : x.end.getTime() - y.end.getTime();
    });
}
/**
 * Build the (sorted, non-overlapping) gap intervals inside `bounds` that are
 * not covered by any of the input intervals. Useful for finding manual-entry
 * gaps and "no card" windows.
 */
export function findGaps(bounds, covered) {
    const sorted = sortIntervals(covered)
        .map((i) => intersect(i, bounds))
        .filter((i) => i !== null);
    const gaps = [];
    let cursor = bounds.start;
    for (const i of sorted) {
        if (i.start > cursor) {
            gaps.push({ start: cursor, end: i.start });
        }
        if (i.end > cursor)
            cursor = i.end;
    }
    if (cursor < bounds.end) {
        gaps.push({ start: cursor, end: bounds.end });
    }
    return gaps;
}
/**
 * Local date key (YYYY-MM-DD) for a timestamp under a fixed timezone offset.
 *
 * `tz_offset_minutes` is the offset added to UTC to obtain local time
 * (Europe/Berlin = +60 in winter, +120 in summer). We expect a DST-aware
 * caller to supply the right offset for the moment in question — see
 * `localDateKey` in time-zones.ts for the higher-level helper.
 */
export function utcDateKey(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
export function shiftedDateKey(date, tz_offset_minutes) {
    return utcDateKey(new Date(date.getTime() + tz_offset_minutes * MS_PER_MINUTE));
}
//# sourceMappingURL=time.js.map
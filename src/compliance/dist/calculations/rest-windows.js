import { MS_PER_MINUTE } from "./time.js";
export function findRestRuns(activities) {
    const out = [];
    let current = [];
    let ferry = false;
    const flush = () => {
        if (current.length === 0)
            return;
        const start = current[0].start;
        const end = current[current.length - 1].end;
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
        const counts = a.kind === "REST" ||
            (a.ferry_train && (a.kind === "WORK" || a.kind === "AVAILABILITY"));
        if (counts) {
            current.push(a);
            if (a.ferry_train)
                ferry = true;
        }
        else {
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
export function splitDailyRestMinutes(rests, window, first_min_minutes = 180, second_min_minutes = 540) {
    const inside = rests
        .filter((r) => r.start >= window.start && r.end <= window.end)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (inside.length < 2)
        return 0;
    for (let i = 0; i < inside.length - 1; i++) {
        const first = inside[i];
        if (first.minutes < first_min_minutes)
            continue;
        for (let j = i + 1; j < inside.length; j++) {
            const second = inside[j];
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
export function longestRestWithin(rests, window) {
    let best = 0;
    for (const r of rests) {
        if (r.end <= window.start || r.start >= window.end)
            continue;
        const start = r.start < window.start ? window.start : r.start;
        const end = r.end > window.end ? window.end : r.end;
        const minutes = Math.round((end.getTime() - start.getTime()) / MS_PER_MINUTE);
        if (minutes > best)
            best = minutes;
    }
    return best;
}
//# sourceMappingURL=rest-windows.js.map
import { MS_PER_MINUTE } from "./time.js";
import { localDateKey, localMidnight } from "./time-zones.js";
/**
 * Group a flat activity list into DriverDay records keyed by local calendar
 * date. We use calendar grouping for reporting purposes only — the
 * "operational day" used by EU 561 (24h after end of last daily rest) is
 * computed elsewhere when we evaluate daily-driving / daily-rest.
 *
 * Activities that span midnight are split at the local midnight boundary so
 * each fragment lands in the right day. The split is informational; it does
 * not change driving-time totals across days.
 */
export function buildDriverDays(activities, time_zone) {
    if (activities.length === 0)
        return [];
    const driver_id = activities[0].driver_id;
    const buckets = new Map();
    for (const a of activities) {
        let cursor = a.start;
        while (cursor < a.end) {
            const key = localDateKey(cursor, time_zone);
            const dayStart = localMidnight(cursor, time_zone);
            const nextDayStart = new Date(dayStart.getTime() + 24 * 3600 * 1000);
            const segEnd = a.end < nextDayStart ? a.end : nextDayStart;
            const list = buckets.get(key) ?? [];
            list.push({ ...a, start: cursor, end: segEnd });
            buckets.set(key, list);
            cursor = segEnd;
        }
    }
    const out = [];
    for (const [key, list] of [...buckets.entries()].sort()) {
        const sample = list[0];
        const dayStart = localMidnight(sample.start, time_zone);
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
        out.push({
            driver_id,
            local_date: key,
            driver_day_window: { start: dayStart, end: dayEnd },
            activities: list,
            driving_minutes: sumByKind(list, "DRIVING"),
            working_minutes: sumByKind(list, "WORK"),
            availability_minutes: sumByKind(list, "AVAILABILITY"),
            rest_minutes: sumByKind(list, "REST"),
            start_country: list[0]?.start_country ?? null,
            end_country: list[list.length - 1]?.end_country ?? null,
        });
    }
    return out;
}
function sumByKind(xs, kind) {
    let ms = 0;
    for (const a of xs) {
        if (a.kind === kind)
            ms += a.end.getTime() - a.start.getTime();
    }
    return Math.round(ms / MS_PER_MINUTE);
}
/**
 * Build ISO-week buckets (Mon 00:00 → Sun 24:00 local) from a list of
 * driver days. Used by the weekly / two-week driving evaluators.
 */
export function buildDriverWeeks(days, time_zone) {
    if (days.length === 0)
        return [];
    const driver_id = days[0].driver_id;
    const buckets = new Map();
    for (const day of days) {
        const [y, m, d] = day.local_date.split("-").map((s) => Number(s));
        if (y === undefined || m === undefined || d === undefined)
            continue;
        const probe = new Date(Date.UTC(y, m - 1, d));
        const { iso_year, iso_week } = isoWeekParts(probe);
        const key = `${iso_year}-W${String(iso_week).padStart(2, "0")}`;
        const list = buckets.get(key) ?? [];
        list.push(day);
        buckets.set(key, list);
    }
    const out = [];
    for (const [key, list] of [...buckets.entries()].sort()) {
        const [yearStr, weekStr] = key.split("-W");
        const iso_year = Number(yearStr);
        const iso_week = Number(weekStr);
        const first = list[0];
        const last = list[list.length - 1];
        const monday = mondayOfIsoWeek(iso_year, iso_week, time_zone);
        const sundayEnd = new Date(monday.getTime() + 7 * 24 * 3600 * 1000);
        out.push({
            driver_id,
            iso_year,
            iso_week,
            window: {
                start: first.driver_day_window.start < monday ? first.driver_day_window.start : monday,
                end: last.driver_day_window.end > sundayEnd ? last.driver_day_window.end : sundayEnd,
            },
            days: list,
            total_driving_minutes: list.reduce((s, d) => s + d.driving_minutes, 0),
            total_working_minutes: list.reduce((s, d) => s + d.working_minutes + d.driving_minutes, 0),
        });
    }
    return out;
}
function isoWeekParts(date) {
    // Standard ISO-8601 week algorithm.
    const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return { iso_year: tmp.getUTCFullYear(), iso_week: week };
}
function mondayOfIsoWeek(iso_year, iso_week, time_zone) {
    // Jan 4th is always in week 1; back-step to Monday.
    const jan4 = new Date(Date.UTC(iso_year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const week1Mon = new Date(jan4.getTime() - (jan4Day - 1) * 86400000);
    const targetMon = new Date(week1Mon.getTime() + (iso_week - 1) * 7 * 86400000);
    // Convert to local midnight under tz.
    return localMidnight(targetMon, time_zone);
}
/**
 * Rolling 2-week driving total (EU 561 Art. 6(3)). For each ISO week we
 * return the sum of `total_driving_minutes` for that week and the previous
 * one. Caller compares the value against the rule limit.
 */
export function rollingTwoWeekDriving(weeks) {
    return weeks.map((w, i) => {
        const prev = i > 0 ? weeks[i - 1].total_driving_minutes : 0;
        return {
            iso_year: w.iso_year,
            iso_week: w.iso_week,
            minutes: w.total_driving_minutes + prev,
        };
    });
}
//# sourceMappingURL=weekly.js.map
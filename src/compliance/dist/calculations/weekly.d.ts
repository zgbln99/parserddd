import type { Activity } from "../types/activity.js";
import type { DriverDay, DriverWeek } from "../types/driver.js";
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
export declare function buildDriverDays(activities: readonly Activity[], time_zone: string): DriverDay[];
/**
 * Build ISO-week buckets (Mon 00:00 → Sun 24:00 local) from a list of
 * driver days. Used by the weekly / two-week driving evaluators.
 */
export declare function buildDriverWeeks(days: readonly DriverDay[], time_zone: string): DriverWeek[];
/**
 * Rolling 2-week driving total (EU 561 Art. 6(3)). For each ISO week we
 * return the sum of `total_driving_minutes` for that week and the previous
 * one. Caller compares the value against the rule limit.
 */
export declare function rollingTwoWeekDriving(weeks: readonly DriverWeek[]): {
    iso_year: number;
    iso_week: number;
    minutes: number;
}[];
//# sourceMappingURL=weekly.d.ts.map
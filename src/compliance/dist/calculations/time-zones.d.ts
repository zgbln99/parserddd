import { utcDateKey } from "./time.js";
/**
 * DST-aware local-date helper for European timezones.
 *
 * We deliberately avoid pulling in a tz database for now. Instead we rely on
 * the JavaScript Intl API which is correct on every supported Node version.
 * `localDateKey` is the only function callers should use to bucket activities
 * into a calendar day; do NOT do (date.getUTCHours() + 1) hacks elsewhere.
 */
export declare function localDateKey(date: Date, time_zone: string): string;
/**
 * Resolve the UTC offset (in minutes) at the given instant in `time_zone`.
 *
 * Useful when constructing local "midnight to midnight" intervals around a
 * DST boundary — the day length is 23h or 25h on those two dates per year.
 */
export declare function tzOffsetMinutes(date: Date, time_zone: string): number;
/**
 * Local midnight (UTC instant) for the local date the given moment falls on.
 */
export declare function localMidnight(date: Date, time_zone: string): Date;
/** Convenience: also export utcDateKey for symmetry. */
export { utcDateKey };
//# sourceMappingURL=time-zones.d.ts.map
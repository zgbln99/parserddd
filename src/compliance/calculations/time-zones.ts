import { MS_PER_MINUTE, utcDateKey } from "./time.js";

/**
 * DST-aware local-date helper for European timezones.
 *
 * We deliberately avoid pulling in a tz database for now. Instead we rely on
 * the JavaScript Intl API which is correct on every supported Node version.
 * `localDateKey` is the only function callers should use to bucket activities
 * into a calendar day; do NOT do (date.getUTCHours() + 1) hacks elsewhere.
 */
export function localDateKey(date: Date, time_zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: time_zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date); // en-CA renders YYYY-MM-DD natively
}

/**
 * Resolve the UTC offset (in minutes) at the given instant in `time_zone`.
 *
 * Useful when constructing local "midnight to midnight" intervals around a
 * DST boundary — the day length is 23h or 25h on those two dates per year.
 */
export function tzOffsetMinutes(date: Date, time_zone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: time_zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  const localUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );
  return Math.round((localUtc - date.getTime()) / MS_PER_MINUTE);
}

/**
 * Local midnight (UTC instant) for the local date the given moment falls on.
 */
export function localMidnight(date: Date, time_zone: string): Date {
  const key = localDateKey(date, time_zone);
  // Find midnight by binary searching offset. Simpler: subtract local offset.
  // Construct the UTC moment that corresponds to local 00:00:00 on `key`.
  const [y, m, d] = key.split("-").map((s) => Number(s));
  // Probe with a noon UTC of that local day to read the offset reliably.
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`invalid local date key: ${key}`);
  }
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offset = tzOffsetMinutes(probe, time_zone);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offset * MS_PER_MINUTE);
}

/** Convenience: also export utcDateKey for symmetry. */
export { utcDateKey };

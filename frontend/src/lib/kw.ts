// ISO-8601 calendar-week (Kalenderwoche / KW) helpers, shared by the pages
// that roll daily figures up into per-week averages.

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO-8601 week number + week-year for a date (handles year boundaries). */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;            // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);    // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** Sortable week key, e.g. "2026-W23". */
export function weekKey(date: Date): string {
  const { year, week } = isoWeek(date);
  return `${year}-W${pad2(week)}`;
}

/** Monday of the (ISO) week containing `date`, in local time. */
export function mondayOf(date: Date): Date {
  const d = new Date(date);
  const dayNum = (d.getDay() + 6) % 7;          // Mon=0 … Sun=6
  d.setDate(d.getDate() - dayNum);
  return d;
}

/** "DD.MM." for a date. */
export function ddmm(d: Date): string {
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`;
}

/** "DD.MM.–DD.MM." Mon–Sun range of the ISO week containing `date`. */
export function weekRange(date: Date): string {
  const mon = mondayOf(date);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  return `${ddmm(mon)}–${ddmm(sun)}`;
}

/**
 * Convert total minutes to "Xh Ym" format.
 */
export function minutesToHm(totalMinutes: number): string {
  if (!totalMinutes && totalMinutes !== 0) return '-';
  const h = Math.floor(Math.abs(totalMinutes) / 60);
  const m = Math.abs(totalMinutes) % 60;
  const sign = totalMinutes < 0 ? '-' : '';
  return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * Get localized month label for a period string "YYYY-MM".
 */
export function monthLabel(period: string, locale: string = 'pl'): string {
  const MONTHS_PL = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const [year, month] = period.split('-');
  const months = locale === 'de' ? MONTHS_DE : MONTHS_PL;
  const idx = parseInt(month, 10) - 1;
  return `${months[idx] || month} ${year}`;
}

/**
 * First and last calendar day (YYYY-MM-DD) of a "YYYY-MM" period.
 */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = (period || '').split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return { from: '', to: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(y, m, 0).getDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/**
 * If [from, to] spans exactly one calendar month, return it as "YYYY-MM";
 * otherwise return '' (a custom range).
 */
export function dateRangeToMonth(from: string, to: string): string {
  if (!from || !to) return '';
  const m = /^(\d{4})-(\d{2})-01$/.exec(from);
  if (!m) return '';
  const period = `${m[1]}-${m[2]}`;
  return to === monthRange(period).to ? period : '';
}

/**
 * Get localized short weekday name.
 */
export function weekdayShort(dayIndex: number, locale: string = 'pl'): string {
  const PL = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
  const DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return locale === 'de' ? DE[dayIndex] : PL[dayIndex];
}

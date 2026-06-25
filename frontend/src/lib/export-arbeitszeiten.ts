// German work-time CSV ("Arbeitszeiten") for a single driver — a clean,
// focused sheet of the daily working hours, with the start and end of work
// front and centre, for payroll / time tracking. Built client-side from the
// shifts already loaded in the analysis. Semicolon-delimited + UTF-8 BOM so
// it opens correctly (umlauts, columns) in German Excel.
import type { ShiftDetail } from '../types';

// The shift data carries Polish weekday codes (see ShiftTable); map to German.
const WEEKDAY_DE: Record<string, string> = {
  Pn: 'Mo', Wt: 'Di', 'Śr': 'Mi', Cz: 'Do', Pt: 'Fr', So: 'Sa', Nd: 'So',
};

/** "YYYY-MM-DD HH:MM" or "HH:MM" -> "HH:MM" (empty-safe). */
function hhmm(v: string): string {
  if (!v) return '';
  const part = v.includes(' ') ? v.split(' ')[1] : v;
  return (part || '').slice(0, 5);
}

/** ISO "YYYY-MM-DD" -> German "DD.MM.YYYY". */
function germanDate(iso: string): string {
  if (!iso) return '';
  const p = iso.slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : iso;
}

/** Minutes -> German decimal hours, e.g. 450 -> "7,50". */
function decimalH(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2).replace('.', ',');
}

/** Minutes -> "HH:MM". */
function minToHm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Escape one value for a ';'-delimited CSV cell. */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(';');
}

/** Filesystem-safe slug for the driver name. */
function slug(s: string): string {
  return (s || 'Fahrer').trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Fahrer';
}

const HEADERS = [
  'Datum', 'Wochentag', 'Arbeitsbeginn', 'Arbeitsende',
  'Pause', 'Arbeitszeit', 'Arbeitszeit (Std.)', 'Lenkzeit', 'Fahrzeug',
];

/**
 * Build and download the Arbeitszeiten CSV for one driver.
 * Columns: date, weekday, start, end, break, working time (HH:MM + decimal),
 * driving time, vehicle — plus a "Summe" totals row.
 */
export function exportArbeitszeitenCsv(driverName: string, shifts: ShiftDetail[]): void {
  const sorted = [...(shifts || [])].sort((a, b) =>
    (a.shift_start || a.shift_date || '').localeCompare(b.shift_start || b.shift_date || ''),
  );

  let sumWork = 0;
  let sumBreak = 0;
  let sumDrive = 0;
  const body = sorted.map((sh) => {
    sumWork += sh.work_minutes || 0;
    sumBreak += sh.break_minutes || 0;
    sumDrive += sh.driving_minutes || 0;
    return csvRow([
      germanDate(sh.shift_date),
      WEEKDAY_DE[sh.weekday] ?? sh.weekday ?? '',
      hhmm(sh.shift_start),
      hhmm(sh.shift_end),
      sh.break_hm || minToHm(sh.break_minutes),
      sh.work_hm || minToHm(sh.work_minutes),
      decimalH(sh.work_minutes || 0),
      sh.driving_hm || minToHm(sh.driving_minutes),
      (sh.vehicles || []).join(', '),
    ]);
  });

  const totals = csvRow([
    'Summe', '', '', '',
    minToHm(sumBreak), minToHm(sumWork), decimalH(sumWork), minToHm(sumDrive), '',
  ]);

  const dates = sorted.map((s) => s.shift_date).filter(Boolean).sort();
  let zeitraum = '';
  if (dates.length) {
    const first = dates[0];
    const last = dates[dates.length - 1];
    zeitraum = first.slice(0, 7) === last.slice(0, 7)
      ? germanDate(first).slice(3)            // MM.YYYY
      : `${germanDate(first)} – ${germanDate(last)}`;
  }

  const lines = [
    csvRow([`Arbeitszeiten — ${driverName || 'Fahrer'}`]),
    zeitraum ? csvRow([`Zeitraum: ${zeitraum}`]) : '',
    '',
    csvRow(HEADERS),
    ...body,
    '',
    totals,
  ].filter((l) => l !== '');

  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const periodForFile = dates.length ? dates[0].slice(0, 7) : '';
  a.href = url;
  a.download = `Arbeitszeiten_${slug(driverName)}${periodForFile ? '_' + periodForFile : ''}.csv`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

// Dachser Schönefeld export — two .xlsx files in the format their system
// expects, built from the toll data currently loaded on the MAUT page:
//   1. "<period> maut"  — raw Toll Collect rows for the selected vehicles,
//      in Dachser's fixed 19-column layout, one vehicle after another.
//   2. "LKWs <period>"  — a date × tour matrix: column A = each day of the
//      period, the other columns = tour names, each cell holds the
//      vehicle's plate on days it had toll activity.
import * as XLSX from 'xlsx-js-style';

export interface DachserTollRow {
  plate: string;
  date: string;            // ISO YYYY-MM-DD
  time: string;
  raw: Record<string, string>;
}

// Dachser's expected column order for the toll file (clean German headers).
const MAUT_COLUMNS = [
  'Kfz-Kennz.', 'Datum', 'Start', 'Buchungsnummer', 'Art',
  'Auffahrt', 'Über', 'Abfahrt', 'Kostenstelle', 'Tarifmodell',
  'Achsklasse', 'Gewichtsklasse', 'Schadstoffklasse', 'K/E',
  'CO2 Emissionsklasse', 'Verfahren', 'km', 'EUR', 'Stornierungsgebühr in EUR',
];

/** ASCII-only normalised header key — tolerates umlauts and mojibake
 *  (the source export sometimes has corrupted ü/ö in headers). */
function normKey(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Normalise a plate to a single "with dash" form: TF LS 1149 -> TF-LS-1149. */
export function normalizePlate(p: string): string {
  return (p || '').trim().toUpperCase().replace(/[\s.\-_]+/g, '-').replace(/^-|-$/g, '');
}

/** Map each Dachser column to the matching key in a row's raw record. */
function buildHeaderMap(rawKeys: string[]): Record<string, string> {
  const normRaw = rawKeys.map((k) => [normKey(k), k] as const);
  const map: Record<string, string> = {};
  for (const col of MAUT_COLUMNS) {
    const nc = normKey(col);
    const hit = normRaw.find(([n]) => n === nc);
    if (hit) map[col] = hit[1];
  }
  return map;
}

function periodLabel(rows: DachserTollRow[]): string {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return new Date().toISOString().slice(0, 7).split('-').reverse().join('.');
  return `${dates[0].slice(5, 7)}.${dates[0].slice(0, 4)}`; // MM.YYYY
}

/** File 1 — raw toll rows for the selected vehicles in Dachser's layout. */
export function exportDachserMaut(rows: DachserTollRow[]): void {
  const sorted = [...rows].sort(
    (a, b) =>
      normalizePlate(a.plate).localeCompare(normalizePlate(b.plate)) ||
      a.date.localeCompare(b.date) ||
      a.time.localeCompare(b.time),
  );
  const rawKeys = sorted.length ? Object.keys(sorted[0].raw || {}) : [];
  const hmap = buildHeaderMap(rawKeys);

  const aoa: (string | number)[][] = [MAUT_COLUMNS];
  for (const r of sorted) {
    aoa.push(
      MAUT_COLUMNS.map((col) => {
        if (col === 'Kfz-Kennz.') return normalizePlate(r.plate);
        const rk = hmap[col];
        return rk ? (r.raw[rk] ?? '') : '';
      }),
    );
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Arkusz1');
  XLSX.writeFile(wb, `Schönefeld ${periodLabel(rows)} maut.xlsx`);
}

/** File 2 — the date × tour matrix of which vehicle drove on which day. */
export function exportDachserLkw(
  rows: DachserTollRow[],
  tourByPlate: Record<string, string>,
): void {
  const daysByPlate: Record<string, Set<string>> = {};
  let minD = '';
  let maxD = '';
  for (const r of rows) {
    if (!r.date) continue;
    (daysByPlate[r.plate] ??= new Set()).add(r.date);
    if (!minD || r.date < minD) minD = r.date;
    if (!maxD || r.date > maxD) maxD = r.date;
  }
  if (!minD) return;

  const cols = Object.keys(daysByPlate)
    .map((plate) => ({ plate, tour: (tourByPlate[plate] || plate).trim() }))
    .sort((a, b) => {
      const an = parseInt(a.tour, 10);
      const bn = parseInt(b.tour, 10);
      const aNum = !isNaN(an) && String(an) === a.tour;
      const bNum = !isNaN(bn) && String(bn) === b.tour;
      if (aNum && bNum) return an - bn;
      if (aNum) return -1;
      if (bNum) return 1;
      return a.tour.localeCompare(b.tour);
    });

  const aoa: (string | Date)[][] = [['', ...cols.map((c) => c.tour)]];
  const start = new Date(minD + 'T00:00:00Z');
  const end = new Date(maxD + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    aoa.push([
      new Date(d),
      ...cols.map((c) => (daysByPlate[c.plate].has(iso) ? normalizePlate(c.plate) : '')),
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  // Format the date column as DD.MM.YYYY
  for (let r = 1; r < aoa.length; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    if (ws[addr]) ws[addr].z = 'dd.mm.yyyy';
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Arkusz1');
  XLSX.writeFile(wb, `Schönefeld LKWs ${periodLabel(rows)}.xlsx`);
}

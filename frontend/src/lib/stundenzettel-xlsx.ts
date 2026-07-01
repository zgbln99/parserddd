// Fill the ORIGINAL DATEV Excel template ("Vorlage zur Dokumentation der
// täglichen Arbeitszeit") with the Stundenzettel data. Only cell VALUES are
// written — the workbook (logo, styles, formulas, print layout) is otherwise
// untouched, so the result is 1:1 with the source file, just filled in.
//
// Template cell map (sheet "Arbeitszeitdokumentation"):
//   E5  = employee name           H7 = month (date, 1st) → drives "Monat/Jahr"
//   Day N → row 10+N (day 1 = row 11 … day 31 = row 41)
//   B = Kalendertag (text, e.g. "śr, 01")   C = Beginn   D = Ende  (HHMM ints,
//   format ##":"##)   E = Dauer   K = net  (time fractions, format h:mm)
//   G = * (K/U/UU/F/…)   J = Pause (HHMM int)   F43 = SUM(K11:K41)

const TEMPLATE_URL = '/templates/arbeitszeit-vorlage.xlsx';
const WD_PL = ['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
const WD_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export interface StzXlsxDay {
  day: number;
  start: string;   // "HH:MM"
  end: string;     // "HH:MM"
  pause: number;   // minutes
  code: string;    // '', K, U, UU, F, SA, SU
}

export interface StzXlsxInput {
  name: string;
  year: number;
  month: number;         // 1-12
  days: StzXlsxDay[];
  locale: 'de' | 'pl';
}

function toMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  return m ? +m[1] * 60 + +m[2] : null;
}

/** minutes → HHMM integer for the template's ##":"## columns (30 → ":30", 400 → "4:00"). */
function hhmmInt(min: number): number {
  return Math.floor(min / 60) * 100 + (min % 60);
}

/** Excel serial (days since 1899-12-30) for the 1st of the given month. */
function monthSerial(year: number, month: number): number {
  return Math.round((Date.UTC(year, month - 1, 1) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Fill the DATEV template and return the .xlsx blob + a suggested filename. */
export async function buildStundenzettelXlsx(input: StzXlsxInput): Promise<{ blob: Blob; filename: string }> {
  const mod = await import('exceljs');
  // exceljs ships as UMD/CJS; the Vite interop may expose it as the namespace
  // itself or under `.default`. Pick whichever actually has Workbook.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any;
  const ExcelJS = m.Workbook ? m : (m.default ?? m);

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`Vorlage nicht gefunden (${res.status})`);
  const buf = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];

  const { name, year, month, locale } = input;
  const wd = locale === 'pl' ? WD_PL : WD_DE;
  const count = new Date(year, month, 0).getDate();
  const byDay = new Map(input.days.map((d) => [d.day, d]));

  ws.getCell('E5').value = name || '';
  ws.getCell('H7').value = monthSerial(year, month);

  let sumNet = 0;
  for (let r = 11; r <= 42; r++) {
    const day = r - 10;
    if (day > count) { ws.getCell(`B${r}`).value = ''; continue; } // clear overflow rows
    const dow = new Date(year, month - 1, day).getDay();
    ws.getCell(`B${r}`).value = `${wd[dow]}, ${String(day).padStart(2, '0')}`;

    const rec = byDay.get(day);
    const code = (rec?.code || '').toUpperCase();
    if (code) {
      ws.getCell(`G${r}`).value = code;
      ws.getCell(`E${r}`).value = 0;
      ws.getCell(`K${r}`).value = 0;
      continue;
    }

    const s = rec ? toMin(rec.start) : null;
    const e0 = rec ? toMin(rec.end) : null;
    if (s !== null && e0 !== null) {
      let e = e0;
      if (e <= s) e += 1440;                 // overnight shift
      const gross = e - s;
      const pause = Math.max(0, rec!.pause || 0);
      const net = Math.max(0, gross - pause);
      ws.getCell(`C${r}`).value = hhmmInt(s);
      ws.getCell(`D${r}`).value = hhmmInt(e % 1440);
      ws.getCell(`E${r}`).value = gross / 1440;
      if (pause > 0) ws.getCell(`J${r}`).value = hhmmInt(pause);
      ws.getCell(`K${r}`).value = net / 1440;
      sumNet += net / 1440;
    } else {
      ws.getCell(`E${r}`).value = 0;
      ws.getCell(`K${r}`).value = 0;
    }
  }

  // Keep the template's SUM formula but seed the cached result too.
  ws.getCell('F43').value = { formula: 'SUM(K11:K41)', result: sumNet };
  if (!wb.calcProperties) wb.calcProperties = {};
  wb.calcProperties.fullCalcOnLoad = true;

  const out = await wb.xlsx.writeBuffer();
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const slug = (name || 'Mitarbeiter').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Mitarbeiter';
  return { blob, filename: `Arbeitszeit_${slug}_${year}-${String(month).padStart(2, '0')}.xlsx` };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

/** Fill the template and download the .xlsx (1:1 with the source file). */
export async function downloadStundenzettelXlsx(input: StzXlsxInput): Promise<void> {
  const { blob, filename } = await buildStundenzettelXlsx(input);
  triggerDownload(blob, filename);
}

/** Fill the template, convert to PDF server-side (LibreOffice), download the PDF. */
export async function downloadStundenzettelPdf(input: StzXlsxInput): Promise<void> {
  const { blob, filename } = await buildStundenzettelXlsx(input);
  const form = new FormData();
  form.append('file', blob, filename);
  const res = await fetch('/api/stundenzettel/pdf', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    let msg = `PDF-Konvertierung fehlgeschlagen (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const pdf = await res.blob();
  triggerDownload(pdf, filename.replace(/\.xlsx$/i, '.pdf'));
}

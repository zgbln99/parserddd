/**
 * Exports of the year-end odometer audit: a clean Excel workbook and a
 * signed PDF. Both carry the "Erstellt mit LTS Tachoanalyzer" mark so the
 * sheet handed to the auditor says where the numbers came from.
 */

import type { AuditReport, AuditRow } from './api';

type Locale = 'pl' | 'de';

const TOOL = 'LTS Tachoanalyzer';
const COMPANY = 'LTS Logistik GmbH';

function L(locale: Locale) {
  return locale === 'de'
    ? {
        title: (y: number) => `Kilometerstand zum Jahresende ${y}`,
        cutoff: (y: number) => `Stichtag 31.12.${y}, 23:59 Uhr (Europe/Berlin)`,
        source: 'Quelle: Fahrerkarten (Tachostand bei Kartenentnahme/-einstecken) und Fahrzeugeinheiten (Tachostand um Mitternacht)',
        vehicles: (n: number) => `${n} Fahrzeuge`,
        cols: ['Nr.', 'Kennzeichen', 'Datum', 'Uhrzeit', 'Kilometerstand (km)', 'Hinweis', 'Fahrer (Karte)'],
        qual: { exact: 'genau', ok: 'nah', gap: 'Lücke' } as Record<AuditRow['quality'], string>,
        days: 'Tage',
        after: 'Eintrag nach dem Stichtag',
        midnight: 'Tachograph (VU), Stand um Mitternacht',
        legend: [
          'genau: Messwert vom 31.12. oder VU zum Jahreswechsel · nah: bis 14 Tage · Lücke: mehr als 14 Tage',
          'Nur LTS-Kennzeichen TF LS / TF KX. VU-Stand zum Jahreswechsel hat Vorrang. Sonst gilt der zeitlich nächste verfügbare Messwert vor oder nach dem Stichtag. Das Messdatum und der Abstand sind angegeben.',
        ],
        generated: (d: string) => `Erstellt am ${d} mit ${TOOL} (FleetView)`,
        sign: 'Datum, Unterschrift',
        confidential: 'Vertraulich',
        details: 'Details',
        detailCols: ['Kennzeichen', 'Km-Stand', 'Datum des Eintrags', 'Quelle', 'Fahrer', 'Kartennummer', 'Abstand (Tage)', 'Qualität',
          'Letzter Eintrag davor (km)', 'Datum', 'Erster Eintrag danach (km)', 'Datum', 'Km zwischen', 'Km-Stand Vorjahr', 'Km im Jahr', 'Einträge im Jahr', 'Fahrer im Jahr', 'VIN'],
        srcBefore: 'Entnahme', srcAfter: 'Einstecken',
        sheet: (y: number) => `Km-Stand ${y}`,
        file: (y: number) => `Kilometerstand_31-12-${y}`,
        page: (i: number, n: number) => `Seite ${i} von ${n}`,
      }
    : {
        title: (y: number) => `Stan licznika na koniec roku ${y}`,
        cutoff: (y: number) => `Stan na 31.12.${y}, 23:59 (Europe/Berlin)`,
        source: 'Źródło: karty kierowców (licznik przy wyjęciu/włożeniu karty) i tachografy pojazdów (licznik o północy)',
        vehicles: (n: number) => `${n} pojazdów`,
        cols: ['Nr', 'Rejestracja', 'Data', 'Godzina', 'Stan licznika (km)', 'Uwaga', 'Kierowca (karta)'],
        qual: { exact: 'dokładny', ok: 'bliski', gap: 'luka' } as Record<AuditRow['quality'], string>,
        days: 'dni',
        after: 'wpis po dacie granicznej',
        midnight: 'tachograf (VU), stan o północy',
        legend: [
          'dokładny: odczyt z 31.12 lub VU na przełomie roku · bliski: do 14 dni · luka: ponad 14 dni',
          'Tylko rejestracje LTS TF LS / TF KX. Odczyt VU z przełomu roku ma pierwszeństwo. W pozostałych przypadkach wybierany jest odczyt najbliższy końcowi roku, przed albo po dacie granicznej. Sprawdź faktyczną datę i odstęp.',
        ],
        generated: (d: string) => `Wygenerowano ${d} w ${TOOL} (FleetView)`,
        sign: 'Data, podpis',
        confidential: 'Poufne',
        details: 'Szczegóły',
        detailCols: ['Rejestracja', 'Stan km', 'Data wpisu', 'Źródło', 'Kierowca', 'Nr karty', 'Odstęp (dni)', 'Jakość',
          'Ostatni wpis przed (km)', 'Data', 'Pierwszy wpis po (km)', 'Data', 'Km między', 'Stan km rok wcześniej', 'Km w roku', 'Wpisy w roku', 'Kierowcy w roku', 'VIN'],
        srcBefore: 'wyjęcie', srcAfter: 'włożenie',
        sheet: (y: number) => `Stan km ${y}`,
        file: (y: number) => `Stan-licznika_31-12-${y}`,
        page: (i: number, n: number) => `Strona ${i} z ${n}`,
      };
}

function dateParts(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: iso, time: '' };
  return {
    date: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
  };
}

function nowText(): string {
  return new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function hint(r: AuditRow, t: ReturnType<typeof L>): string {
  const parts = [t.qual[r.quality]];
  if (r.kind === 'midnight') parts.push(t.midnight);
  if (r.gap_days != null && r.quality !== 'exact') parts.push(`${r.gap_days} ${t.days}`);
  if (r.source === 'after') parts.push(t.after);
  return parts.join(' · ');
}

// ───────────────────────────── Excel ─────────────────────────────

export async function exportOdometerAuditXlsx(report: AuditReport, rows: AuditRow[], locale: Locale) {
  // FleetView already ships ExcelJS; avoid importing an uninstalled xlsx-js-style package.
  const { default: ExcelJS } = await import('exceljs');
  const t = L(locale);
  const year = report.year;
  const wb = new ExcelJS.Workbook();
  wb.creator = TOOL;
  wb.lastModifiedBy = TOOL;
  wb.title = t.title(year);
  wb.company = COMPANY;
  wb.created = new Date();

  const ws = wb.addWorksheet(t.sheet(year), { views: [{ state: 'frozen', ySplit: 5 }] });
  ws.columns = [5, 16, 12, 9, 18, 34, 28].map(width => ({ width }));
  ws.mergeCells('A1:G1');
  ws.mergeCells('A2:G2');
  ws.mergeCells('A3:G3');
  ws.getCell('A1').value = t.title(year);
  ws.getCell('A1').font = { name: 'Arial', size: 15, bold: true, color: { argb: 'FF0F172A' } };
  ws.getRow(1).height = 24;
  ws.getCell('A2').value = COMPANY + ' · ' + t.cutoff(year) + ' · ' + t.vehicles(rows.length);
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF64748B' } };
  ws.getCell('A3').value = t.source;
  ws.getCell('A3').font = { size: 9, color: { argb: 'FF64748B' } };
  ws.getRow(4).height = 7;
  const header = ws.getRow(5);
  header.values = t.cols;
  header.height = 26;
  header.eachCell(c => {
    c.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFD0D7E2' } } };
  });

  rows.forEach((r, i) => {
    const { date, time } = dateParts(r.at);
    const row = ws.addRow([i + 1, r.plate, date, time, r.km, hint(r, t), r.driver || r.card_number]);
    row.height = 20;
    row.eachCell(c => {
      c.font = { name: 'Arial', size: 10, color: { argb: 'FF334155' } };
      c.alignment = { vertical: 'middle' };
      c.border = { bottom: { style: 'hair', color: { argb: 'FFD0D7E2' } } };
      if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F8FB' } };
    });
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(2).font = { bold: true, size: 10 };
    row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(5).numFmt = '#,##0';
    row.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(5).font = { bold: true, size: 10 };
    row.getCell(6).font = { size: 9, color: { argb: r.quality === 'gap' ? 'FFB45309' : r.quality === 'ok' ? 'FF1D4ED8' : 'FF15803D' } };
    row.getCell(7).font = { size: 9, color: { argb: 'FF475569' } };
  });

  ws.addRow([]);
  for (const line of t.legend) {
    const row = ws.addRow([line]);
    row.getCell(1).font = { size: 8, italic: true, color: { argb: 'FF64748B' } };
    ws.mergeCells(row.number, 1, row.number, 7);
  }
  ws.addRow([]);
  const generated = ws.addRow([t.generated(nowText()) + ' · ' + COMPANY + ' · ' + t.confidential]);
  generated.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF1E40AF' } };
  ws.mergeCells(generated.number, 1, generated.number, 7);

  // Keep all source readings in a separate worksheet for checking the numbers.
  const details = wb.addWorksheet(t.details, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  details.columns = [16, 12, 18, 12, 24, 18, 10, 10, 14, 18, 14, 18, 10, 14, 10, 10, 10, 20].map(width => ({ width }));
  const dh = details.addRow(t.detailCols);
  dh.height = 24;
  dh.eachCell(c => {
    c.font = { bold: true, size: 9 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } };
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFD0D7E2' } } };
  });
  rows.forEach(r => {
    const d = details.addRow([
      r.plate, r.km, [dateParts(r.at).date, dateParts(r.at).time].join(' ').trim(), r.source === 'before' ? t.srcBefore : t.srcAfter,
      r.driver, r.card_number, r.gap_days, t.qual[r.quality], r.before_km,
      r.before_at ? [dateParts(r.before_at).date, dateParts(r.before_at).time].join(' ') : '',
      r.after_km, r.after_at ? [dateParts(r.after_at).date, dateParts(r.after_at).time].join(' ') : '',
      r.bracket_km, r.km_prev_year, r.km_in_year, r.records_in_year, r.drivers_in_year, r.vin,
    ]);
    [2,9,11,13,14,15].forEach(col => { d.getCell(col).numFmt = '#,##0'; });
  });

  const buf = await wb.xlsx.writeBuffer();
  const bytes = new Uint8Array(buf);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = t.file(year) + '.xlsx';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
}

// ───────────────────────────── PDF ─────────────────────────────

export async function exportOdometerAuditPdf(report: AuditReport, rows: AuditRow[], locale: Locale) {
  const [{ default: jsPDF }, { default: autoTable }, pdf] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), import('./pdf-generator'),
  ]);
  const t = L(locale);
  const year = report.year;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;

  // Inter covers Polish and German letters; fall back to Helvetica.
  let font = 'helvetica';
  try {
    const fonts = await pdf.loadInterFonts();
    if (fonts) { pdf.registerInterFont(doc, fonts); font = 'Inter'; }
  } catch { /* helvetica */ }

  const ink: [number, number, number] = [17, 24, 39];
  const mut: [number, number, number] = [107, 114, 128];
  const line: [number, number, number] = [229, 231, 235];
  const brand: [number, number, number] = [30, 64, 175];

  // Header
  doc.setFillColor(...brand);
  doc.rect(0, 0, W, 2, 'F');
  doc.setFont(font, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...mut);
  doc.text(COMPANY.toUpperCase(), M, 12);
  doc.setFont(font, 'normal'); doc.setFontSize(7.5);
  doc.text(nowText(), W - M, 12, { align: 'right' });
  doc.setFont(font, 'bold'); doc.setFontSize(17); doc.setTextColor(...ink);
  doc.text(t.title(year), M, 21);
  doc.setFont(font, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...mut);
  doc.text(`${t.cutoff(year)} · ${t.vehicles(rows.length)}`, M, 27);
  doc.setFontSize(7.5);
  doc.text(t.source, M, 31.5);
  doc.setDrawColor(...ink); doc.setLineWidth(0.3);
  doc.line(M, 35, W - M, 35);

  const body = rows.map((r, i) => {
    const { date, time } = dateParts(r.at);
    return [String(i + 1), r.plate, date, time, r.km.toLocaleString('de-DE'), hint(r, t)];
  });
  autoTable(doc, {
    startY: 39,
    head: [t.cols.slice(0, 6)],
    body,
    theme: 'plain',
    styles: { font, fontSize: 8.5, cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 }, textColor: ink },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: mut, cellPadding: { top: 1, bottom: 2.5, left: 2, right: 2 } },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center', textColor: mut },
      1: { cellWidth: 32, fontStyle: 'bold' },
      2: { cellWidth: 24, halign: 'center' },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
      5: { textColor: mut, fontSize: 7.5 },
    },
    margin: { left: M, right: M, bottom: 22 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawCell: (d: any) => {
      const { cell, section } = d;
      if (section === 'head') {
        doc.setDrawColor(...ink); doc.setLineWidth(0.4);
        doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
      } else if (section === 'body') {
        doc.setDrawColor(...line); doc.setLineWidth(0.1);
        doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // Legend + signature block (new page if it does not fit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = ((doc as any).lastAutoTable?.finalY ?? 39) + 8;
  if (y > H - 50) { doc.addPage(); y = 20; }
  doc.setFont(font, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...mut);
  for (const l of t.legend) {
    const lines = doc.splitTextToSize(l, W - 2 * M) as string[];
    doc.text(lines, M, y);
    y += lines.length * 3.6 + 1;
  }
  y += 8;
  doc.setDrawColor(...ink); doc.setLineWidth(0.2);
  doc.line(M, y, M + 70, y);
  doc.line(W - M - 70, y, W - M, y);
  doc.setFontSize(7);
  doc.text(t.sign, M, y + 4);
  doc.text(t.sign, W - M - 70, y + 4);
  y += 12;
  doc.setFont(font, 'bold'); doc.setFontSize(8); doc.setTextColor(...brand);
  doc.text(t.generated(nowText()), M, y);

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...line); doc.setLineWidth(0.2);
    doc.line(M, H - 11, W - M, H - 11);
    doc.setFont(font, 'normal'); doc.setFontSize(6.5); doc.setTextColor(...mut);
    doc.text(`${COMPANY} · ${t.confidential} · ${t.generated(nowText())}`, M, H - 7);
    doc.text(t.page(i, pages), W - M, H - 7, { align: 'right' });
    doc.setFillColor(...brand);
    doc.rect(0, H - 2, W, 2, 'F');
  }

  doc.setProperties({ title: t.title(year), author: TOOL, creator: `${TOOL} (FleetView)`, subject: COMPANY });
  doc.save(`${t.file(year)}.pdf`);
}

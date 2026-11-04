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
          'genau: Eintrag vom 31.12. oder bis 3 Tage davon entfernt · nah: bis 14 Tage · Lücke: mehr als 14 Tage',
          'Liegt ein Tachographen-Download vor, ist der Kilometerstand der vom Fahrzeug gespeicherte Stand um Mitternacht zum Jahreswechsel. Sonst der Stand beim Entnehmen der Fahrerkarte am letzten Eintrag vor dem Stichtag; fehlt ein solcher, der Stand beim Einstecken am ersten Eintrag danach.',
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
          'dokładny: wpis z 31.12 lub do 3 dni od niego · bliski: do 14 dni · luka: ponad 14 dni',
          'Gdy jest odczyt z tachografu pojazdu, stan licznika to wartość zapisana przez pojazd o północy na przełomie roku. W przeciwnym razie odczyt przy wyjęciu karty z ostatniego wpisu przed 31.12; gdy go brak, odczyt przy włożeniu z pierwszego wpisu po.',
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
  const XLSX = await import('xlsx-js-style');
  const t = L(locale);
  const year = report.year;

  const thin = { style: 'thin', color: { rgb: 'D0D7E2' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const headStyle = { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E40AF' } }, alignment: { vertical: 'center', horizontal: 'center', wrapText: true }, border };
  const cell = (v: string | number | null, extra: Record<string, unknown> = {}) => ({ v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s: { font: { sz: 10 }, border, ...extra } });

  // Sheet 1: the clean list
  const aoa: unknown[][] = [
    [{ v: t.title(year), t: 's', s: { font: { bold: true, sz: 15, color: { rgb: '0F172A' } } } }],
    [{ v: `${COMPANY} · ${t.cutoff(year)} · ${t.vehicles(rows.length)}`, t: 's', s: { font: { sz: 10, color: { rgb: '64748B' } } } }],
    [{ v: t.source, t: 's', s: { font: { sz: 9, color: { rgb: '64748B' } } } }],
    [],
    t.cols.map((c) => ({ v: c, t: 's', s: headStyle })),
  ];
  rows.forEach((r, i) => {
    const { date, time } = dateParts(r.at);
    const zebra = i % 2 ? { fill: { fgColor: { rgb: 'F6F8FB' } } } : {};
    aoa.push([
      cell(i + 1, { alignment: { horizontal: 'center' }, ...zebra }),
      cell(r.plate, { font: { bold: true, sz: 10 }, ...zebra }),
      cell(date, { alignment: { horizontal: 'center' }, ...zebra }),
      cell(time, { alignment: { horizontal: 'center' }, ...zebra }),
      { v: r.km, t: 'n', z: '#,##0', s: { font: { bold: true, sz: 10 }, border, alignment: { horizontal: 'right' }, ...zebra } },
      cell(hint(r, t), { font: { sz: 9, color: { rgb: r.quality === 'gap' ? 'B45309' : r.quality === 'ok' ? '1D4ED8' : '15803D' } }, ...zebra }),
      cell(r.driver || r.card_number, { font: { sz: 9, color: { rgb: '475569' } }, ...zebra }),
    ]);
  });
  aoa.push([]);
  aoa.push([{ v: t.legend[0], t: 's', s: { font: { sz: 8, italic: true, color: { rgb: '64748B' } } } }]);
  aoa.push([{ v: t.legend[1], t: 's', s: { font: { sz: 8, italic: true, color: { rgb: '64748B' } } } }]);
  aoa.push([]);
  aoa.push([{ v: `${t.generated(nowText())} · ${COMPANY} · ${t.confidential}`, t: 's', s: { font: { bold: true, sz: 9, color: { rgb: '1E40AF' } } } }]);

  const ws = XLSX.utils.aoa_to_sheet(aoa as (string | number)[][]);
  ws['!cols'] = [{ wch: 5 }, { wch: 16 }, { wch: 12 }, { wch: 9 }, { wch: 18 }, { wch: 34 }, { wch: 28 }];
  ws['!rows'] = [{ hpt: 24 }, { hpt: 16 }, { hpt: 14 }, { hpt: 6 }, { hpt: 22 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 5 };
  ws['!merges'] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: 6 } }));

  // Sheet 2: everything the page shows
  const detailRows = rows.map((r) => [
    r.plate, r.km, `${dateParts(r.at).date} ${dateParts(r.at).time}`.trim(), r.kind === 'midnight' ? 'VU' : r.source === 'before' ? t.srcBefore : t.srcAfter, r.driver, r.card_number,
    r.gap_days, t.qual[r.quality], r.before_km, r.before_at ? `${dateParts(r.before_at).date} ${dateParts(r.before_at).time}` : '',
    r.after_km, r.after_at ? `${dateParts(r.after_at).date} ${dateParts(r.after_at).time}` : '', r.bracket_km, r.km_prev_year, r.km_in_year,
    r.records_in_year, r.drivers_in_year, r.vin,
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([t.detailCols, ...detailRows]);
  t.detailCols.forEach((_, c) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws2[addr]) ws2[addr].s = { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: 'E8EEF4' } }, border };
  });
  ws2['!cols'] = [16, 12, 18, 12, 24, 18, 10, 10, 14, 18, 14, 18, 10, 14, 10, 10, 10, 20].map((wch) => ({ wch }));
  ws2['!freeze'] = { xSplit: 1, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t.sheet(year));
  XLSX.utils.book_append_sheet(wb, ws2, t.details);
  wb.Props = { Title: t.title(year), Author: TOOL, Company: COMPANY, CreatedDate: new Date() };
  XLSX.writeFile(wb, `${t.file(year)}.xlsx`);
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

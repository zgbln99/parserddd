import * as XLSX from 'xlsx';

interface ShiftRow {
  shift_date: string;
  weekday: string;
  shift_start: string;
  shift_end: string;
  duration_hm: string;
  vehicles: string[];
  driving_hm: string;
  work_only_hm: string;
  break_hm: string;
  night_25_minutes: number;
  night_25_hm: string;
  night_40_minutes: number;
  night_40_hm: string;
  has_diet: boolean;
  manual_minutes: number;
  manual_hm: string;
  work_minutes: number;
  driving_minutes: number;
  break_minutes: number;
}

interface Summary {
  total_work_hm: string;
  total_driving_hm: string;
  total_break_hm: string;
  night_25_minutes: number;
  night_25_hm: string;
  night_40_minutes: number;
  night_40_hm: string;
  diet_count: number;
  total_shifts: number;
}

export function exportToXlsx(driverName: string, cardNumber: string, summary: Summary, shifts: ShiftRow[]) {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ['Fahrer / Kierowca', driverName],
    ['Kartennummer', cardNumber],
    [''],
    ['Zusammenfassung / Podsumowanie'],
    ['Arbeitszeit / Czas pracy', summary.total_work_hm],
    ['Fahrzeit / Jazda', summary.total_driving_hm],
    ['Pausen / Przerwy', summary.total_break_hm],
    ['Nacht 25% / Nocne 25%', (summary.night_25_minutes / 60).toFixed(2), summary.night_25_hm],
    ['Nacht 40% / Nocne 40%', (summary.night_40_minutes / 60).toFixed(2), summary.night_40_hm],
    ['VMA / Diety', summary.diet_count],
    ['Schichten / Zmiany', summary.total_shifts],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Zusammenfassung');

  // Shifts sheet
  const headers = [
    'Datum', 'Tag', 'Start', 'Ende', 'Dauer',
    'Fahrzeug', 'Fahrzeit', 'Arbeit', 'Pause',
    'Nacht 25%', 'Nacht 40%', 'VMA', 'Manual',
  ];
  const rows = shifts.map((sh) => [
    sh.shift_date,
    sh.weekday,
    sh.shift_start,
    sh.shift_end,
    sh.duration_hm,
    sh.vehicles.join(', '),
    sh.driving_hm,
    sh.work_only_hm,
    sh.break_hm,
    (sh.night_25_minutes / 60).toFixed(2),
    (sh.night_40_minutes / 60).toFixed(2),
    sh.has_diet ? 'JA' : '',
    sh.manual_minutes > 0 ? sh.manual_hm : '',
  ]);

  const wsShifts = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  wsShifts['!cols'] = headers.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, wsShifts, 'Schichten');

  // Download
  const safeName = driverName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'export';
  XLSX.writeFile(wb, `${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportSettlementToXlsx(
  period: string,
  drivers: Array<{
    driver_name: string;
    card_number: string;
    personal_nr: string;
    summary: Summary & { total_work_minutes: number; effective_diet_count?: number; vma_amount?: number };
  }>,
) {
  const wb = XLSX.utils.book_new();

  const headers = [
    'Personalnr.', 'Name', 'Arbeitszeit', 'Nacht 25%', 'Nacht 40%',
    'VMA Tage', 'VMA (EUR)', 'Schichten',
  ];
  const rows = drivers.map((d) => [
    d.personal_nr || d.card_number,
    d.driver_name,
    d.summary.total_work_hm,
    (d.summary.night_25_minutes / 60).toFixed(2),
    (d.summary.night_40_minutes / 60).toFixed(2),
    d.summary.diet_count,
    d.summary.vma_amount?.toFixed(2) || '',
    d.summary.total_shifts,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 14 }, { wch: 25 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, `Abrechnung ${period}`);

  XLSX.writeFile(wb, `Abrechnung_${period}.xlsx`);
}

export interface TollExportRow {
  plate: string;
  date: string;
  time: string;
  route: string;
  bookingNr: string;
  bookingType: string;
  type: string;
  axleClass: string;
  weightClass: string;
  emissionClass: string;
  co2Class: string;
  km: number;
  amount: number;
  statementNr: string;
  raw: Record<string, string>;
}

export interface TollVehicleGroup {
  plate: string;
  rows: TollExportRow[];
  totalKm: number;
  totalAmount: number;
}

function applyNumberFormat(ws: XLSX.WorkSheet, row: number, col: number, fmt: string) {
  const cell = XLSX.utils.encode_cell({ r: row, c: col });
  if (ws[cell]) ws[cell].z = fmt;
}

export function exportTollToXlsx(
  vehicles: TollVehicleGroup[],
  period: string,
  companyName: string,
) {
  const wb = XLSX.utils.book_new();

  const grandTotalKm = vehicles.reduce((s, v) => s + v.totalKm, 0);
  const grandTotalAmount = vehicles.reduce((s, v) => s + v.totalAmount, 0);
  const grandTotalTrips = vehicles.reduce((s, v) => s + v.rows.length, 0);

  // ── Sheet 1: Übersicht (Summary) ──
  const ovHeaders = ['Kennzeichen', 'Fahrten', 'Kilometer', 'Mautbetrag (EUR)'];
  const ovRows: (string | number)[][] = vehicles.map(v => [v.plate, v.rows.length, v.totalKm, v.totalAmount]);
  const ovFooter = ['GESAMT / RAZEM', grandTotalTrips, grandTotalKm, grandTotalAmount];

  const overviewData: (string | number)[][] = [
    [companyName],
    ['Mautaufstellung / Zestawienie opłat drogowych'],
    [`Zeitraum / Okres: ${period}`],
    [],
    ovHeaders,
    ...ovRows,
    [],
    ovFooter,
  ];

  const wsOverview = XLSX.utils.aoa_to_sheet(overviewData);
  wsOverview['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 18 }];
  wsOverview['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
  ];
  // AutoFilter on header row (row 4)
  wsOverview['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + vehicles.length, c: 3 } }) };
  // Number formats
  for (let r = 5; r < 5 + vehicles.length; r++) {
    applyNumberFormat(wsOverview, r, 2, '#,##0.0');
    applyNumberFormat(wsOverview, r, 3, '#,##0.00 €');
  }
  const totalRow = 5 + vehicles.length + 1;
  applyNumberFormat(wsOverview, totalRow, 2, '#,##0.0');
  applyNumberFormat(wsOverview, totalRow, 3, '#,##0.00 €');

  XLSX.utils.book_append_sheet(wb, wsOverview, 'Übersicht');

  // ── Sheet per vehicle ──
  const vehHeaders = [
    'Nr.', 'Datum', 'Uhrzeit', 'Strecke', 'Buchungsnr.', 'Art',
    'Buchungsart', 'Achsklasse', 'Gewichtsklasse', 'Schadstoffklasse',
    'CO₂-Klasse', 'Mautaufstellungsnr.', 'Kilometer', 'Mautbetrag (EUR)',
  ];
  const vehColWidths = [
    { wch: 5 },   // Nr.
    { wch: 12 },  // Datum
    { wch: 8 },   // Uhrzeit
    { wch: 40 },  // Strecke
    { wch: 18 },  // Buchungsnr
    { wch: 10 },  // Art
    { wch: 16 },  // Buchungsart
    { wch: 12 },  // Achsklasse
    { wch: 14 },  // Gewichtsklasse
    { wch: 16 },  // Schadstoffklasse
    { wch: 12 },  // CO2-Klasse
    { wch: 20 },  // Mautaufstellungsnr.
    { wch: 12 },  // Kilometer
    { wch: 16 },  // Mautbetrag
  ];
  const colCount = vehHeaders.length; // 14

  for (const v of vehicles) {
    const sheetName = v.plate.replace(/[\\/*?[\]:]/g, '').slice(0, 28);
    const sorted = [...v.rows].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    const data: (string | number)[][] = [
      [companyName],
      [`Fahrzeug / Pojazd: ${v.plate}`],
      [`Zeitraum / Okres: ${period}`],
      [],
      vehHeaders,
    ];

    sorted.forEach((r, i) => {
      data.push([
        i + 1, r.date, r.time, r.route, r.bookingNr, r.type,
        r.bookingType, r.axleClass, r.weightClass, r.emissionClass,
        r.co2Class, r.statementNr, r.km, r.amount,
      ]);
    });

    // Totals with SUM formulas
    const firstDataRow = 6; // 1-indexed row 6 (0-indexed row 5)
    const lastDataRow = firstDataRow + sorted.length - 1;
    const kmCol = XLSX.utils.encode_col(12);  // M
    const amtCol = XLSX.utils.encode_col(13); // N
    data.push([]);
    const footerIdx = data.length;
    data.push([
      '', '', '', '', '', '', '', '', '', '', '',
      'GESAMT / RAZEM:',
      { f: `SUM(${kmCol}${firstDataRow}:${kmCol}${lastDataRow})` } as unknown as number,
      { f: `SUM(${amtCol}${firstDataRow}:${amtCol}${lastDataRow})` } as unknown as number,
    ]);

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = vehColWidths;
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: colCount - 1 } },
    ];
    // AutoFilter on data
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + sorted.length, c: colCount - 1 } }) };

    // Number formats for data rows
    for (let r = 5; r < 5 + sorted.length; r++) {
      applyNumberFormat(ws, r, 12, '#,##0.0');
      applyNumberFormat(ws, r, 13, '#,##0.00 €');
    }
    // Format totals
    applyNumberFormat(ws, footerIdx, 12, '#,##0.0');
    applyNumberFormat(ws, footerIdx, 13, '#,##0.00 €');

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // ── Last sheet: Rohdaten / Dane surowe (all raw CSV columns) ──
  // Collect all unique raw column headers
  const rawHeaderSet = new Set<string>();
  for (const v of vehicles) {
    for (const r of v.rows) {
      for (const key of Object.keys(r.raw)) rawHeaderSet.add(key);
    }
  }
  const rawHeaders = Array.from(rawHeaderSet);
  const allRawRows: string[][] = [];
  for (const v of vehicles) {
    const sorted = [...v.rows].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    for (const r of sorted) {
      allRawRows.push(rawHeaders.map(h => r.raw[h] || ''));
    }
  }

  const wsRaw = XLSX.utils.aoa_to_sheet([rawHeaders, ...allRawRows]);
  wsRaw['!cols'] = rawHeaders.map(h => ({ wch: Math.max(h.length + 2, 12) }));
  wsRaw['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: allRawRows.length, c: rawHeaders.length - 1 } }) };

  XLSX.utils.book_append_sheet(wb, wsRaw, 'Rohdaten');

  const safePeriod = period.replace(/[^a-zA-Z0-9_-]/g, '') || 'Maut';
  XLSX.writeFile(wb, `Maut_${safePeriod}_${vehicles.length}Fzg.xlsx`);
}

export function generateGoogleSheetsUrl(driverName: string, summary: Summary, shifts: ShiftRow[]): void {
  // Build TSV content for clipboard (Google Sheets pasting)
  const headers = ['Datum', 'Tag', 'Start', 'Ende', 'Dauer', 'Fahrzeit', 'Arbeit', 'Pause', 'Nacht 25%', 'Nacht 40%', 'VMA'].join('\t');
  const rows = shifts.map((sh) => [
    sh.shift_date,
    sh.weekday,
    sh.shift_start,
    sh.shift_end,
    sh.duration_hm,
    sh.driving_hm,
    sh.work_only_hm,
    sh.break_hm,
    (sh.night_25_minutes / 60).toFixed(2).replace('.', ','),
    (sh.night_40_minutes / 60).toFixed(2).replace('.', ','),
    sh.has_diet ? 'JA' : '',
  ].join('\t'));

  const summaryLine = [
    'RAZEM', '', '', '', summary.total_work_hm, summary.total_driving_hm,
    '', summary.total_break_hm,
    (summary.night_25_minutes / 60).toFixed(2).replace('.', ','),
    (summary.night_40_minutes / 60).toFixed(2).replace('.', ','),
    String(summary.diet_count),
  ].join('\t');

  const tsv = [headers, ...rows, '', summaryLine].join('\n');
  navigator.clipboard.writeText(tsv);
}

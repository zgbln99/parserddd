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
  tour?: string;
  rows: TollExportRow[];
  totalKm: number;
  totalAmount: number;
}

export interface MonthData {
  period: string;
  rows: TollExportRow[];
}

function applyNumberFormat(ws: XLSX.WorkSheet, row: number, col: number, fmt: string) {
  const cell = XLSX.utils.encode_cell({ r: row, c: col });
  if (ws[cell]) ws[cell].z = fmt;
}

export function exportTollToXlsx(
  vehicles: TollVehicleGroup[],
  period: string,
  companyName: string,
  monthsData?: MonthData[],
) {
  const wb = XLSX.utils.book_new();

  const grandTotalKm = vehicles.reduce((s, v) => s + v.totalKm, 0);
  const grandTotalAmount = vehicles.reduce((s, v) => s + v.totalAmount, 0);
  const grandTotalTrips = vehicles.reduce((s, v) => s + v.rows.length, 0);

  // ── Sheet 1: Übersicht (Summary) ──
  // Sorted month periods for columns
  const monthPeriods = monthsData && monthsData.length > 1
    ? [...monthsData].sort((a, b) => a.period.localeCompare(b.period)).map(m => m.period)
    : [];
  const hasMultiMonths = monthPeriods.length > 1;

  // Pre-compute per-vehicle per-month Maut amounts
  const vehicleMonthAmounts = new Map<string, Map<string, number>>();
  if (hasMultiMonths) {
    for (const v of vehicles) {
      const byMonth = new Map<string, number>();
      for (const r of v.rows) {
        const m = r.date.slice(0, 7);
        byMonth.set(m, (byMonth.get(m) || 0) + r.amount);
      }
      vehicleMonthAmounts.set(v.plate, byMonth);
    }
  }

  // Build headers: Kennzeichen | Tour | Fahrten | Kilometer | [Maut per month...] | Maut Gesamt
  const ovHeaders: string[] = ['Kennzeichen', 'Tour', 'Fahrten', 'Kilometer'];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) ovHeaders.push(`Maut ${mp}`);
  }
  ovHeaders.push('Mautbetrag (EUR)');
  const colCount_ov = ovHeaders.length;

  // Build rows
  const ovRows: (string | number)[][] = vehicles.map(v => {
    const row: (string | number)[] = [v.plate, v.tour || '', v.rows.length, v.totalKm];
    if (hasMultiMonths) {
      const byMonth = vehicleMonthAmounts.get(v.plate)!;
      for (const mp of monthPeriods) row.push(byMonth.get(mp) || 0);
    }
    row.push(v.totalAmount);
    return row;
  });

  // Footer
  const ovFooter: (string | number)[] = ['GESAMT / RAZEM', '', grandTotalTrips, grandTotalKm];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) {
      const monthTotal = vehicles.reduce((s, v) => {
        const byMonth = vehicleMonthAmounts.get(v.plate)!;
        return s + (byMonth.get(mp) || 0);
      }, 0);
      ovFooter.push(monthTotal);
    }
  }
  ovFooter.push(grandTotalAmount);

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
  const ovColWidths: { wch: number }[] = [{ wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 14 }];
  if (hasMultiMonths) {
    for (const _mp of monthPeriods) ovColWidths.push({ wch: 18 });
  }
  ovColWidths.push({ wch: 18 });
  wsOverview['!cols'] = ovColWidths;
  wsOverview['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount_ov - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount_ov - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: colCount_ov - 1 } },
  ];
  wsOverview['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + vehicles.length, c: colCount_ov - 1 } }) };
  // Number formats: km col (3), per-month Maut cols, and Gesamt Maut col
  for (let r = 5; r < 5 + vehicles.length; r++) {
    applyNumberFormat(wsOverview, r, 3, '#,##0.0');
    for (let c = 4; c < colCount_ov; c++) {
      applyNumberFormat(wsOverview, r, c, '#,##0.00 €');
    }
  }
  const totalRow = 5 + vehicles.length + 1;
  applyNumberFormat(wsOverview, totalRow, 3, '#,##0.0');
  for (let c = 4; c < colCount_ov; c++) {
    applyNumberFormat(wsOverview, totalRow, c, '#,##0.00 €');
  }

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
      [`Fahrzeug / Pojazd: ${v.plate}${v.tour ? `  |  Tour: ${v.tour}` : ''}`],
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

  // ── Rohdaten sheets: one per month, filtered to selected vehicles only ──
  const selectedPlates = new Set(vehicles.map(v => v.plate));
  const monthSources = monthsData && monthsData.length > 0
    ? monthsData
    : [{ period: 'all', rows: vehicles.flatMap(v => v.rows) }];

  for (const md of monthSources) {
    // Only include rows for selected vehicles
    const filteredRows = md.rows.filter(r => selectedPlates.has(r.plate));
    if (filteredRows.length === 0) continue;

    // Collect all unique raw column headers
    const rawHeaderSet = new Set<string>();
    for (const r of filteredRows) {
      for (const key of Object.keys(r.raw)) rawHeaderSet.add(key);
    }
    const rawHeaders = Array.from(rawHeaderSet);
    const rawRows: string[][] = [];
    const sorted = [...filteredRows].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    for (const r of sorted) {
      rawRows.push(rawHeaders.map(h => r.raw[h] || ''));
    }

    const wsRaw = XLSX.utils.aoa_to_sheet([rawHeaders, ...rawRows]);
    wsRaw['!cols'] = rawHeaders.map(h => ({ wch: Math.max(h.length + 2, 12) }));
    if (rawHeaders.length > 0) {
      wsRaw['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rawRows.length, c: rawHeaders.length - 1 } }) };
    }

    const sheetName = monthSources.length === 1
      ? 'Rohdaten'
      : `Rohdaten ${md.period}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, wsRaw, sheetName);
  }

  const safePeriod = period.replace(/[^a-zA-Z0-9_-]/g, '') || 'Maut';
  XLSX.writeFile(wb, `Maut_${safePeriod}_${vehicles.length}Fzg.xlsx`);
}

// ─── Samsara KM Day/Night Export ───

export interface SamsaraVehicleDaySummary {
  date: string;
  dayKm: number;
  nightKm: number;
  totalKm: number;
  odoStart: number;
  odoEnd: number;
  firstTime: string;
  lastTime: string;
}

export interface SamsaraVehicleSummary {
  vehicle: string;
  days: SamsaraVehicleDaySummary[];
  totalDayKm: number;
  totalNightKm: number;
  totalKm: number;
}

function pad2x(n: number) { return String(n).padStart(2, '0'); }

export function exportSamsaraKmToXlsx(
  vehicles: SamsaraVehicleSummary[],
  dayStart: number,
  dayEnd: number,
  companyName: string,
) {
  const wb = XLSX.utils.book_new();

  const dayLabel = `${pad2x(dayStart)}:00–${pad2x(dayEnd)}:00`;
  const nightLabel = `${pad2x(dayEnd)}:00–${pad2x(dayStart)}:00`;

  const grandDayKm = vehicles.reduce((s, v) => s + v.totalDayKm, 0);
  const grandNightKm = vehicles.reduce((s, v) => s + v.totalNightKm, 0);
  const grandTotalKm = vehicles.reduce((s, v) => s + v.totalKm, 0);

  // Detect period
  const allDates = vehicles.flatMap(v => v.days.map(d => d.date)).sort();
  const period = allDates.length > 0
    ? (allDates[0].slice(0, 7) === allDates[allDates.length - 1].slice(0, 7)
      ? allDates[0].slice(0, 7)
      : `${allDates[0].slice(0, 7)} – ${allDates[allDates.length - 1].slice(0, 7)}`)
    : '';

  // ── Sheet 1: Übersicht ──
  const ovHeaders = ['Kennzeichen', 'Tage', `km Tag (${dayLabel})`, `km Nacht (${nightLabel})`, 'km Gesamt'];
  const ovData: (string | number)[][] = [
    [companyName],
    ['Kilometerauswertung Tag / Nacht'],
    [`Zeitraum: ${period}`],
    [`Tagschicht: ${dayLabel}  |  Nachtschicht: ${nightLabel}`],
    [],
    ovHeaders,
  ];

  for (const v of vehicles) {
    ovData.push([v.vehicle, v.days.length, v.totalDayKm, v.totalNightKm, v.totalKm]);
  }
  ovData.push([]);
  ovData.push(['GESAMT / RAZEM', '', grandDayKm, grandNightKm, grandTotalKm]);

  const wsOv = XLSX.utils.aoa_to_sheet(ovData);
  wsOv['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 14 }];
  wsOv['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 4 } },
  ];
  wsOv['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: 5 + vehicles.length, c: 4 } }) };

  for (let r = 6; r < 6 + vehicles.length; r++) {
    applyNumberFormat(wsOv, r, 2, '#,##0.0');
    applyNumberFormat(wsOv, r, 3, '#,##0.0');
    applyNumberFormat(wsOv, r, 4, '#,##0.0');
  }
  const tRow = 6 + vehicles.length + 1;
  applyNumberFormat(wsOv, tRow, 2, '#,##0.0');
  applyNumberFormat(wsOv, tRow, 3, '#,##0.0');
  applyNumberFormat(wsOv, tRow, 4, '#,##0.0');

  XLSX.utils.book_append_sheet(wb, wsOv, 'Übersicht');

  // ── Sheet per vehicle ──
  const vHeaders = [
    'Datum', 'Erste Fahrt', 'Letzte Fahrt',
    'Odometer Start', 'Odometer Ende',
    `km Tag (${dayLabel})`, `km Nacht (${nightLabel})`, 'km Gesamt',
  ];

  for (const v of vehicles) {
    const sheetName = v.vehicle.replace(/[\\/*?[\]:]/g, '').slice(0, 28);
    const data: (string | number)[][] = [
      [companyName],
      [`Fahrzeug / Pojazd: ${v.vehicle}`],
      [`Zeitraum: ${period}`],
      [`Tagschicht: ${dayLabel}  |  Nachtschicht: ${nightLabel}`],
      [],
      vHeaders,
    ];

    for (const d of v.days) {
      data.push([d.date, d.firstTime, d.lastTime, d.odoStart, d.odoEnd, d.dayKm, d.nightKm, d.totalKm]);
    }

    const firstDataRow = 7; // 1-indexed
    const lastDataRow = firstDataRow + v.days.length - 1;
    const dayCol = XLSX.utils.encode_col(5);   // F
    const nightCol = XLSX.utils.encode_col(6);  // G
    const totalCol = XLSX.utils.encode_col(7);  // H

    data.push([]);
    const footerIdx = data.length;
    data.push([
      'GESAMT / RAZEM:', '', '', '', '',
      { f: `SUM(${dayCol}${firstDataRow}:${dayCol}${lastDataRow})` } as unknown as number,
      { f: `SUM(${nightCol}${firstDataRow}:${nightCol}${lastDataRow})` } as unknown as number,
      { f: `SUM(${totalCol}${firstDataRow}:${totalCol}${lastDataRow})` } as unknown as number,
    ]);

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 16 }, { wch: 16 },
      { wch: 20 }, { wch: 20 }, { wch: 14 },
    ];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } },
    ];
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: 5 + v.days.length, c: 7 } }) };

    for (let r = 6; r < 6 + v.days.length; r++) {
      applyNumberFormat(ws, r, 3, '#,##0');
      applyNumberFormat(ws, r, 4, '#,##0');
      applyNumberFormat(ws, r, 5, '#,##0.0');
      applyNumberFormat(ws, r, 6, '#,##0.0');
      applyNumberFormat(ws, r, 7, '#,##0.0');
    }
    applyNumberFormat(ws, footerIdx, 5, '#,##0.0');
    applyNumberFormat(ws, footerIdx, 6, '#,##0.0');
    applyNumberFormat(ws, footerIdx, 7, '#,##0.0');

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const safePeriod = period.replace(/[^a-zA-Z0-9_-]/g, '') || 'KM';
  XLSX.writeFile(wb, `KM_Tag_Nacht_${safePeriod}.xlsx`);
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

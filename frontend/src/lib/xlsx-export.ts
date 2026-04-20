import * as XLSX from 'xlsx-js-style';

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
  dateRange?: string;
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

// ── Style helpers ──
const FONT_DEFAULT = { name: 'Calibri', sz: 10 };
const FONT_BOLD = { name: 'Calibri', sz: 10, bold: true };
const FONT_TITLE = { name: 'Calibri', sz: 14, bold: true };
const FONT_SUBTITLE = { name: 'Calibri', sz: 11, bold: true, color: { rgb: '555555' } };
const FONT_META = { name: 'Calibri', sz: 10, color: { rgb: '777777' } };

const BORDER_THIN = { style: 'thin', color: { rgb: 'CCCCCC' } } as const;
const BORDERS_ALL = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
const BORDER_BOTTOM_THICK = { ...BORDERS_ALL, bottom: { style: 'medium', color: { rgb: '333333' } } as const };

const FILL_HEADER = { fgColor: { rgb: '2B4C7E' } }; // dark blue
const FILL_ALT = { fgColor: { rgb: 'F5F7FA' } };    // light gray zebra
const FILL_TOTAL = { fgColor: { rgb: 'E8EDF3' } };   // light blue-gray

function styleCell(ws: XLSX.WorkSheet, r: number, c: number, s: Record<string, any>) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { v: '', t: 's' };
  ws[addr].s = { ...ws[addr].s, ...s };
}

function styleRange(ws: XLSX.WorkSheet, r1: number, c1: number, r2: number, c2: number, s: Record<string, any>) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      styleCell(ws, r, c, s);
    }
  }
}

export function exportTollToXlsx(
  vehicles: TollVehicleGroup[],
  period: string,
  companyName: string,
  showMonthDiff = false,
) {
  const wb = XLSX.utils.book_new();

  const grandTotalKm = vehicles.reduce((s, v) => s + v.totalKm, 0);
  const grandTotalAmount = vehicles.reduce((s, v) => s + v.totalAmount, 0);
  const grandTotalTrips = vehicles.reduce((s, v) => s + v.rows.length, 0);

  // ── Sheet 1: Übersicht (Summary) ──
  // Detect months from actual vehicle data
  const allMonthSet = new Set<string>();
  for (const v of vehicles) {
    for (const r of v.rows) {
      if (r.date.length >= 7) allMonthSet.add(r.date.slice(0, 7));
    }
  }
  const monthPeriods = Array.from(allMonthSet).sort();
  const hasMultiMonths = monthPeriods.length > 1;
  // Show diff column only when requested AND we have at least 2 months
  const showDiff = showMonthDiff && monthPeriods.length >= 2;

  // Pre-compute per-vehicle per-month Maut amounts and km
  const vehicleMonthAmounts = new Map<string, Map<string, number>>();
  const vehicleMonthKm = new Map<string, Map<string, number>>();
  if (hasMultiMonths) {
    for (const v of vehicles) {
      const byMonthAmt = new Map<string, number>();
      const byMonthKm = new Map<string, number>();
      for (const r of v.rows) {
        const m = r.date.slice(0, 7);
        byMonthAmt.set(m, (byMonthAmt.get(m) || 0) + r.amount);
        byMonthKm.set(m, (byMonthKm.get(m) || 0) + r.km);
      }
      vehicleMonthAmounts.set(v.plate, byMonthAmt);
      vehicleMonthKm.set(v.plate, byMonthKm);
    }
  }

  // Build 2-row headers
  // Row 1: Nr. | Kennzeichen | Tour | Fahrten | Maut [months...] | Maut Gesamt
  // Row 2: (merged)|(merged)  |(merged)|(merged)| km [months...]  | km Gesamt
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const fmtMonth = (mp: string) => {
    const [y, m] = mp.split('-');
    return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
  };

  // Value columns = months + gesamt (no diff inline — diff goes to separate sheet)
  const valCols = hasMultiMonths ? monthPeriods.length + 1 : 1;
  const colCount_ov = 4 + valCols; // 4 fixed + value columns
  const valStart = 4; // first value column index

  // Header row 1: Maut labels
  const hdrRow1: string[] = ['Nr.', 'Kennzeichen', 'Tour', 'Fahrten'];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) hdrRow1.push(`Maut ${fmtMonth(mp)}`);
  }
  hdrRow1.push('Maut Gesamt (€)');

  // Header row 2: km labels
  const hdrRow2: string[] = ['', '', '', ''];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) hdrRow2.push(`km ${fmtMonth(mp)}`);
  }
  hdrRow2.push('km Gesamt');

  // Build data: each vehicle = 2 rows (maut row + km row)
  const dataRows: (string | number)[][] = [];
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    // Row 1: maut values
    const mautRow: (string | number)[] = [i + 1, v.plate, v.tour || '', v.rows.length];
    if (hasMultiMonths) {
      const byMonthA = vehicleMonthAmounts.get(v.plate)!;
      for (const mp of monthPeriods) mautRow.push(byMonthA.get(mp) || 0);
    }
    mautRow.push(v.totalAmount);
    dataRows.push(mautRow);

    // Row 2: km values
    const kmRow: (string | number)[] = ['', '', '', ''];
    if (hasMultiMonths) {
      const byMonthK = vehicleMonthKm.get(v.plate)!;
      for (const mp of monthPeriods) kmRow.push(byMonthK.get(mp) || 0);
    }
    kmRow.push(v.totalKm);
    dataRows.push(kmRow);
  }

  // Footer: 2 rows (maut + km)
  const footerMaut: (string | number)[] = ['', 'GESAMT', '', grandTotalTrips];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) {
      footerMaut.push(vehicles.reduce((s, v) => s + (vehicleMonthAmounts.get(v.plate)!.get(mp) || 0), 0));
    }
  }
  footerMaut.push(grandTotalAmount);

  const footerKm: (string | number)[] = ['', '', '', ''];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) {
      footerKm.push(vehicles.reduce((s, v) => s + (vehicleMonthKm.get(v.plate)!.get(mp) || 0), 0));
    }
  }
  footerKm.push(grandTotalKm);

  const overviewData: (string | number)[][] = [
    [companyName],
    ['Mautaufstellung'],
    [`Zeitraum: ${period}`],
    [`Anzahl Fahrzeuge: ${vehicles.length}  |  Anzahl Fahrten: ${grandTotalTrips}`],
    [],
    hdrRow1,
    hdrRow2,
    ...dataRows,
    [],
    footerMaut,
    footerKm,
  ];

  const wsOverview = XLSX.utils.aoa_to_sheet(overviewData);
  const ovColWidths: { wch: number }[] = [{ wch: 6 }, { wch: 18 }, { wch: 22 }, { wch: 10 }];
  for (let i = 0; i < valCols; i++) ovColWidths.push({ wch: 18 });
  wsOverview['!cols'] = ovColWidths;

  // Merges: title rows + header fixed cols merged 2 rows + each vehicle fixed cols merged 2 rows
  const merges: XLSX.Range[] = [
    // Title merges
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount_ov - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount_ov - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: colCount_ov - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: colCount_ov - 1 } },
    // Header: merge first 4 cols across 2 rows (rows 5-6)
    { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } }, // Nr.
    { s: { r: 5, c: 1 }, e: { r: 6, c: 1 } }, // Kennzeichen
    { s: { r: 5, c: 2 }, e: { r: 6, c: 2 } }, // Tour
    { s: { r: 5, c: 3 }, e: { r: 6, c: 3 } }, // Fahrten
  ];
  // Vehicle data: merge first 4 cols for each vehicle's 2 rows
  const dataStart = 7; // first data row (after 2 header rows)
  for (let i = 0; i < vehicles.length; i++) {
    const r = dataStart + i * 2;
    for (let c = 0; c < 4; c++) {
      merges.push({ s: { r, c }, e: { r: r + 1, c } });
    }
  }
  // Footer: merge first 4 cols across 2 rows
  const footerStart = dataStart + vehicles.length * 2 + 1; // +1 for empty row
  for (let c = 0; c < 4; c++) {
    merges.push({ s: { r: footerStart, c }, e: { r: footerStart + 1, c } });
  }
  wsOverview['!merges'] = merges;

  // Row heights
  const rowHeights: { hpt: number }[] = [
    { hpt: 26 }, // 0: company
    { hpt: 22 }, // 1: title
    { hpt: 18 }, // 2: period
    { hpt: 18 }, // 3: stats
    { hpt: 8 },  // 4: spacer
    { hpt: 20 }, // 5: header row 1
    { hpt: 20 }, // 6: header row 2
  ];
  wsOverview['!rows'] = rowHeights;

  // ── Styles ──
  // Title rows
  styleRange(wsOverview, 0, 0, 0, colCount_ov - 1, { font: FONT_TITLE });
  styleRange(wsOverview, 1, 0, 1, colCount_ov - 1, { font: FONT_SUBTITLE });
  styleRange(wsOverview, 2, 0, 2, colCount_ov - 1, { font: FONT_META });
  styleRange(wsOverview, 3, 0, 3, colCount_ov - 1, { font: FONT_META });

  // Header rows (5 and 6) — white on dark blue
  const FILL_HEADER_MAUT = { fgColor: { rgb: '2B4C7E' } }; // dark blue for Maut
  const FILL_HEADER_KM = { fgColor: { rgb: '3A6B4F' } };   // dark green for km
  for (let c = 0; c < colCount_ov; c++) {
    const isFixed = c < 4;
    // Row 5: Maut header (+ fixed cols)
    styleCell(wsOverview, 5, c, {
      font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } },
      fill: isFixed ? FILL_HEADER : FILL_HEADER_MAUT,
      border: BORDERS_ALL,
      alignment: { horizontal: c >= 4 ? 'right' : (c === 0 ? 'center' : 'left'), vertical: 'center', wrapText: true },
    });
    // Row 6: km header
    styleCell(wsOverview, 6, c, {
      font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } },
      fill: isFixed ? FILL_HEADER : FILL_HEADER_KM,
      border: BORDERS_ALL,
      alignment: { horizontal: c >= 4 ? 'right' : (c === 0 ? 'center' : 'left'), vertical: 'center', wrapText: true },
    });
  }

  // Data rows: style and number format
  const FILL_MAUT_LIGHT = { fgColor: { rgb: 'EEF2F9' } }; // light blue for maut rows
  const FILL_KM_LIGHT = { fgColor: { rgb: 'EDF5F0' } };   // light green for km rows
  for (let i = 0; i < vehicles.length; i++) {
    const mautR = dataStart + i * 2;
    const kmR = mautR + 1;
    const isAlt = i % 2 === 1;

    for (let c = 0; c < colCount_ov; c++) {
      // Maut row
      styleCell(wsOverview, mautR, c, {
        font: c === 1 ? FONT_BOLD : FONT_DEFAULT,
        border: BORDERS_ALL,
        fill: isAlt ? FILL_MAUT_LIGHT : undefined,
        alignment: {
          horizontal: c === 0 ? 'center' : c >= 4 ? 'right' : 'left',
          vertical: 'center',
        },
      });
      // km row
      styleCell(wsOverview, kmR, c, {
        font: FONT_DEFAULT,
        border: BORDERS_ALL,
        fill: isAlt ? FILL_KM_LIGHT : { fgColor: { rgb: 'F8FAF8' } },
        alignment: {
          horizontal: c >= 4 ? 'right' : 'left',
          vertical: 'center',
        },
      });

      // Number formats
      if (c >= valStart) {
        applyNumberFormat(wsOverview, mautR, c, '#,##0.00 €');
        applyNumberFormat(wsOverview, kmR, c, '#,##0.0');
      }
    }
  }

  // Footer styling
  for (let c = 0; c < colCount_ov; c++) {
    styleCell(wsOverview, footerStart, c, {
      font: { ...FONT_BOLD, sz: 11 },
      fill: FILL_TOTAL,
      border: BORDER_BOTTOM_THICK,
      alignment: { horizontal: c >= 4 ? 'right' : (c === 0 ? 'center' : 'left'), vertical: 'center' },
    });
    styleCell(wsOverview, footerStart + 1, c, {
      font: { ...FONT_BOLD, sz: 11 },
      fill: FILL_TOTAL,
      border: BORDER_BOTTOM_THICK,
      alignment: { horizontal: c >= 4 ? 'right' : 'left', vertical: 'center' },
    });
    if (c >= valStart) {
      applyNumberFormat(wsOverview, footerStart, c, '#,##0.00 €');
      applyNumberFormat(wsOverview, footerStart + 1, c, '#,##0.0');
    }
  }

  // Freeze panes: freeze after header rows
  wsOverview['!freeze'] = { xSplit: 0, ySplit: 7 };

  // ── Append Monatsvergleich blocks BELOW the Übersicht (one block per consecutive month pair) ──
  if (showDiff && monthPeriods.length >= 2) {
    // Group by Tour across all vehicles (shared between all comparison blocks)
    const tourMaut = new Map<string, Map<string, number>>();
    const tourKm = new Map<string, Map<string, number>>();
    const tourVehicles = new Map<string, Set<string>>();
    for (const v of vehicles) {
      const tour = v.tour || v.plate;
      if (!tourMaut.has(tour)) {
        tourMaut.set(tour, new Map());
        tourKm.set(tour, new Map());
        tourVehicles.set(tour, new Set());
      }
      tourVehicles.get(tour)!.add(v.plate);
      for (const r of v.rows) {
        const m = r.date.slice(0, 7);
        tourMaut.get(tour)!.set(m, (tourMaut.get(tour)!.get(m) || 0) + r.amount);
        tourKm.get(tour)!.set(m, (tourKm.get(tour)!.get(m) || 0) + r.km);
      }
    }

    const tours = Array.from(tourMaut.keys()).sort();

    // Style palette
    const FILL_DIFF_POS = { fgColor: { rgb: 'E6F4EA' } };
    const FILL_DIFF_NEG = { fgColor: { rgb: 'FCE8E6' } };
    const FONT_GREEN = { ...FONT_BOLD, color: { rgb: '1E7E34' } };
    const FONT_RED = { ...FONT_BOLD, color: { rgb: 'C62828' } };
    const FILL_SECTION_TITLE = { fgColor: { rgb: 'E8EDF3' } };
    const FILL_HDR_DIFF = { fgColor: { rgb: '1A365D' } };

    const DIFF_COLS = 11;

    // Extend column widths (once)
    if (ovColWidths.length < DIFF_COLS) {
      const pad = DIFF_COLS - ovColWidths.length;
      for (let i = 0; i < pad; i++) ovColWidths.push({ wch: 14 });
    }
    ovColWidths[0] = { wch: 6 };
    ovColWidths[1] = { wch: 16 };
    ovColWidths[2] = { wch: 26 };
    ovColWidths[3] = { wch: 15 };
    ovColWidths[4] = { wch: 15 };
    ovColWidths[5] = { wch: 15 };
    ovColWidths[6] = { wch: 11 };
    ovColWidths[7] = { wch: 13 };
    ovColWidths[8] = { wch: 13 };
    ovColWidths[9] = { wch: 13 };
    ovColWidths[10] = { wch: 11 };
    wsOverview['!cols'] = ovColWidths;

    // Helper to write into the sheet
    const writeCell = (r: number, c: number, value: string | number) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      wsOverview[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
      const currRef = wsOverview['!ref'];
      if (currRef) {
        const range = XLSX.utils.decode_range(currRef);
        if (r > range.e.r) range.e.r = r;
        if (c > range.e.c) range.e.c = c;
        wsOverview['!ref'] = XLSX.utils.encode_range(range);
      }
    };

    if (!wsOverview['!merges']) wsOverview['!merges'] = [];

    // Iterate over consecutive month pairs (N-1 comparison blocks)
    let currentRow = overviewData.length + 1; // start with 1 empty row after Übersicht

    for (let pairIdx = 0; pairIdx < monthPeriods.length - 1; pairIdx++) {
      const prevMp = monthPeriods[pairIdx];
      const currMp = monthPeriods[pairIdx + 1];

      // Add separator (1 extra row between consecutive blocks)
      if (pairIdx > 0) currentRow += 1;

      const titleRow = currentRow;
      const hdrRow = titleRow + 1;
      const dataStartRow = hdrRow + 1;

      // Section title
      writeCell(titleRow, 0, `Monatsvergleich — ${fmtMonth(currMp)} vs. ${fmtMonth(prevMp)}`);
      for (let c = 0; c < DIFF_COLS; c++) {
        styleCell(wsOverview, titleRow, c, {
          font: { ...FONT_BOLD, sz: 12 },
          fill: FILL_SECTION_TITLE,
          alignment: { horizontal: 'left', vertical: 'center' },
        });
      }
      wsOverview['!merges']!.push({ s: { r: titleRow, c: 0 }, e: { r: titleRow, c: DIFF_COLS - 1 } });

      // Header
      const hdrLabels = ['Nr.', 'Tour', 'Fahrzeuge', `Maut ${fmtMonth(prevMp)}`, `Maut ${fmtMonth(currMp)}`, 'Δ Maut €', 'Δ Maut %', `km ${fmtMonth(prevMp)}`, `km ${fmtMonth(currMp)}`, 'Δ km', 'Δ km %'];
      for (let c = 0; c < DIFF_COLS; c++) {
        writeCell(hdrRow, c, hdrLabels[c]);
        styleCell(wsOverview, hdrRow, c, {
          font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } },
          fill: FILL_HDR_DIFF,
          border: BORDERS_ALL,
          alignment: { horizontal: c >= 3 ? 'right' : (c === 0 ? 'center' : 'left'), vertical: 'center', wrapText: true },
        });
      }

      // Data rows — one per tour
      let totalPrevMaut = 0, totalCurrMaut = 0, totalPrevKm = 0, totalCurrKm = 0;
      for (let i = 0; i < tours.length; i++) {
        const r = dataStartRow + i;
        const tour = tours[i];
        const prevAmt = tourMaut.get(tour)!.get(prevMp) || 0;
        const currAmt = tourMaut.get(tour)!.get(currMp) || 0;
        const diffAmt = currAmt - prevAmt;
        const diffAmtPct = prevAmt === 0 ? (currAmt === 0 ? 0 : 1) : diffAmt / prevAmt;
        const prevK = tourKm.get(tour)!.get(prevMp) || 0;
        const currK = tourKm.get(tour)!.get(currMp) || 0;
        const diffK = currK - prevK;
        const diffKPct = prevK === 0 ? (currK === 0 ? 0 : 1) : diffK / prevK;
        const plates = Array.from(tourVehicles.get(tour)!).join(', ');

        totalPrevMaut += prevAmt;
        totalCurrMaut += currAmt;
        totalPrevKm += prevK;
        totalCurrKm += currK;

        const rowVals: (string | number)[] = [i + 1, tour, plates, prevAmt, currAmt, diffAmt, diffAmtPct, prevK, currK, diffK, diffKPct];
        for (let c = 0; c < DIFF_COLS; c++) {
          writeCell(r, c, rowVals[c]);

          const isDiffEurCol = c === 5 || c === 9;
          const isDiffPctCol = c === 6 || c === 10;
          const val = rowVals[c];
          const isNeg = typeof val === 'number' && val < 0;
          const isPos = typeof val === 'number' && val > 0;

          styleCell(wsOverview, r, c, {
            font: (isDiffEurCol || isDiffPctCol)
              ? (isNeg ? FONT_RED : isPos ? FONT_GREEN : FONT_DEFAULT)
              : (c === 1 ? FONT_BOLD : FONT_DEFAULT),
            fill: (isDiffEurCol || isDiffPctCol)
              ? (isNeg ? FILL_DIFF_NEG : isPos ? FILL_DIFF_POS : undefined)
              : (i % 2 === 1 ? FILL_ALT : undefined),
            border: BORDERS_ALL,
            alignment: { horizontal: c >= 3 ? 'right' : (c === 0 ? 'center' : 'left'), vertical: 'center' },
          });

          if (c === 3 || c === 4 || c === 5) applyNumberFormat(wsOverview, r, c, '#,##0.00 €');
          if (c === 7 || c === 8 || c === 9) applyNumberFormat(wsOverview, r, c, '#,##0.0');
          if (c === 6 || c === 10) applyNumberFormat(wsOverview, r, c, '+0.0%;-0.0%;0.0%');
        }
      }

      // Footer for this block
      const footerRowIdx = dataStartRow + tours.length;
      const totalDiffMaut = totalCurrMaut - totalPrevMaut;
      const totalDiffMautPct = totalPrevMaut === 0 ? 0 : totalDiffMaut / totalPrevMaut;
      const totalDiffKm = totalCurrKm - totalPrevKm;
      const totalDiffKmPct = totalPrevKm === 0 ? 0 : totalDiffKm / totalPrevKm;

      const footerVals: (string | number)[] = ['', 'GESAMT', '', totalPrevMaut, totalCurrMaut, totalDiffMaut, totalDiffMautPct, totalPrevKm, totalCurrKm, totalDiffKm, totalDiffKmPct];
      for (let c = 0; c < DIFF_COLS; c++) {
        writeCell(footerRowIdx, c, footerVals[c]);

        const isDiffEurCol = c === 5 || c === 9;
        const isDiffPctCol = c === 6 || c === 10;
        const val = footerVals[c];
        const isNeg = typeof val === 'number' && val < 0;
        const isPos = typeof val === 'number' && val > 0;

        styleCell(wsOverview, footerRowIdx, c, {
          font: (isDiffEurCol || isDiffPctCol)
            ? { ...(isNeg ? FONT_RED : isPos ? FONT_GREEN : FONT_BOLD), sz: 11 }
            : { ...FONT_BOLD, sz: 11 },
          fill: FILL_TOTAL,
          border: BORDER_BOTTOM_THICK,
          alignment: { horizontal: c >= 3 ? 'right' : (c === 0 ? 'center' : 'left'), vertical: 'center' },
        });
        if (c === 3 || c === 4 || c === 5) applyNumberFormat(wsOverview, footerRowIdx, c, '#,##0.00 €');
        if (c === 7 || c === 8 || c === 9) applyNumberFormat(wsOverview, footerRowIdx, c, '#,##0.0');
        if (c === 6 || c === 10) applyNumberFormat(wsOverview, footerRowIdx, c, '+0.0%;-0.0%;0.0%');
      }

      // Advance row pointer to after this block's footer
      currentRow = footerRowIdx + 1;
    }
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
      [`Fahrzeug: ${v.plate}${v.tour ? `  |  Tour: ${v.tour}` : ''}`],
      [`Zeitraum: ${v.dateRange || period}`],
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
      'GESAMT:',
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
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + sorted.length, c: colCount - 1 } }) };

    // Style: title rows
    styleRange(ws, 0, 0, 0, colCount - 1, { font: FONT_TITLE });
    styleRange(ws, 1, 0, 1, colCount - 1, { font: FONT_SUBTITLE });
    styleRange(ws, 2, 0, 2, colCount - 1, { font: FONT_META });

    // Style: header row (row 4)
    for (let c = 0; c < colCount; c++) {
      styleCell(ws, 4, c, {
        font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } },
        fill: FILL_HEADER,
        border: BORDERS_ALL,
        alignment: { horizontal: c >= 12 ? 'right' : 'left', vertical: 'center', wrapText: true },
      });
    }

    // Style: data rows with zebra
    for (let r = 5; r < 5 + sorted.length; r++) {
      const isAlt = (r - 5) % 2 === 1;
      for (let c = 0; c < colCount; c++) {
        const s: Record<string, any> = {
          font: FONT_DEFAULT,
          border: BORDERS_ALL,
          alignment: { horizontal: c >= 12 ? 'right' : 'left', vertical: 'center' },
        };
        if (isAlt) s.fill = FILL_ALT;
        if (c === 0) s.alignment = { horizontal: 'center', vertical: 'center' };
        styleCell(ws, r, c, s);
      }
      applyNumberFormat(ws, r, 12, '#,##0.0');
      applyNumberFormat(ws, r, 13, '#,##0.00 €');
    }

    // Style: totals row
    for (let c = 0; c < colCount; c++) {
      styleCell(ws, footerIdx, c, {
        font: { ...FONT_BOLD, sz: 11 },
        fill: FILL_TOTAL,
        border: BORDER_BOTTOM_THICK,
        alignment: { horizontal: c >= 12 ? 'right' : 'left', vertical: 'center' },
      });
    }
    applyNumberFormat(ws, footerIdx, 12, '#,##0.0');
    applyNumberFormat(ws, footerIdx, 13, '#,##0.00 €');

    // Freeze header
    ws['!freeze'] = { xSplit: 0, ySplit: 5 };

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // ── Rohdaten sheets: one per vehicle (uses each vehicle's already-filtered rows) ──
  for (const v of vehicles) {
    if (v.rows.length === 0) continue;

    // Collect all unique raw column headers for this vehicle
    const rawHeaderSet = new Set<string>();
    for (const r of v.rows) {
      for (const key of Object.keys(r.raw)) rawHeaderSet.add(key);
    }
    const rawHeaders = Array.from(rawHeaderSet);
    const sorted = [...v.rows].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const rawRows: string[][] = sorted.map(r => rawHeaders.map(h => r.raw[h] || ''));

    const wsRaw = XLSX.utils.aoa_to_sheet([rawHeaders, ...rawRows]);
    wsRaw['!cols'] = rawHeaders.map(h => ({ wch: Math.max(h.length + 2, 12) }));
    if (rawHeaders.length > 0) {
      wsRaw['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rawRows.length, c: rawHeaders.length - 1 } }) };
    }

    // Style header row
    for (let c = 0; c < rawHeaders.length; c++) {
      styleCell(wsRaw, 0, c, {
        font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } },
        fill: FILL_HEADER,
        border: BORDERS_ALL,
      });
    }

    const rawSheetName = `Roh ${v.plate}`.replace(/[\\/*?[\]:]/g, '').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, wsRaw, rawSheetName);
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
      'GESAMT:', '', '', '', '',
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

// ─── Vehicle Activity (Samsara) Export ───

export interface VehicleActivityDay {
  date: string;
  begin_driving: string;
  last_driving: string;
  duration_hm: string;
  duration_minutes: number;
  distance_km: number;
  last_location?: string;
}

export interface VehicleActivityGroup {
  name: string;
  plate: string;
  tour?: string;
  period?: string;
  days: VehicleActivityDay[];
  totalKm: number;
  totalMinutes: number;
}

export function exportVehicleActivityToXlsx(
  vehicles: VehicleActivityGroup[],
  period: string,
  companyName: string,
) {
  const wb = XLSX.utils.book_new();

  const fmtDur = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const wd = (d: string) => {
    try { return ['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(d + 'T00:00:00').getDay()]; }
    catch { return ''; }
  };
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const fmtMonth = (mp: string) => {
    const [y, m] = mp.split('-');
    return `${monthNames[parseInt(m, 10) - 1]} ${y}`;
  };

  // ── Detect months from data ──
  const allMonthSet = new Set<string>();
  for (const v of vehicles) {
    if (v.period) allMonthSet.add(v.period);
    for (const d of v.days) {
      if (d.date.length >= 7) allMonthSet.add(d.date.slice(0, 7));
    }
  }
  const monthPeriods = Array.from(allMonthSet).sort();
  const hasMultiMonths = monthPeriods.length > 1;

  // ── Pre-compute per-vehicle per-month km and minutes ──
  // Group by unique vehicle name (may have multiple entries for same vehicle = different months)
  const uniqueVehicles: { name: string; plate: string; tour: string }[] = [];
  const seen = new Set<string>();
  for (const v of vehicles) {
    if (!seen.has(v.name)) {
      seen.add(v.name);
      uniqueVehicles.push({ name: v.name, plate: v.plate, tour: v.tour || '' });
    }
  }

  const vehicleMonthKm = new Map<string, Map<string, number>>();
  const vehicleMonthMin = new Map<string, Map<string, number>>();
  const vehicleTotalKm = new Map<string, number>();
  const vehicleTotalMin = new Map<string, number>();
  const vehicleTotalDays = new Map<string, number>();

  for (const uv of uniqueVehicles) {
    const byMonthKm = new Map<string, number>();
    const byMonthMin = new Map<string, number>();
    let tk = 0, tm = 0, td = 0;
    for (const v of vehicles) {
      if (v.name !== uv.name) continue;
      for (const d of v.days) {
        const m = d.date.slice(0, 7);
        byMonthKm.set(m, (byMonthKm.get(m) || 0) + d.distance_km);
        byMonthMin.set(m, (byMonthMin.get(m) || 0) + d.duration_minutes);
        tk += d.distance_km;
        tm += d.duration_minutes;
        td++;
      }
    }
    vehicleMonthKm.set(uv.name, byMonthKm);
    vehicleMonthMin.set(uv.name, byMonthMin);
    vehicleTotalKm.set(uv.name, tk);
    vehicleTotalMin.set(uv.name, tm);
    vehicleTotalDays.set(uv.name, td);
  }

  const grandTotalKm = uniqueVehicles.reduce((s, v) => s + (vehicleTotalKm.get(v.name) || 0), 0);
  const grandTotalMin = uniqueVehicles.reduce((s, v) => s + (vehicleTotalMin.get(v.name) || 0), 0);
  const grandTotalDays = uniqueVehicles.reduce((s, v) => s + (vehicleTotalDays.get(v.name) || 0), 0);

  // ── Sheet 1: Übersicht ──
  // 2-row headers like Maut: km row + Fahrzeit row per vehicle
  const valCols = hasMultiMonths ? monthPeriods.length + 1 : 1;
  const fixedCols = 4; // Nr, Fahrzeug, Kennzeichen, Tour
  const colCount = fixedCols + valCols;
  const valStart = fixedCols;

  // Header row 1: km labels
  const hdrRow1: string[] = ['Nr.', 'Fahrzeug', 'Kennzeichen', 'Tour'];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) hdrRow1.push(`km ${fmtMonth(mp)}`);
  }
  hdrRow1.push('km Gesamt');

  // Header row 2: Fahrzeit labels
  const hdrRow2: string[] = ['', '', '', ''];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) hdrRow2.push(`Fahrzeit ${fmtMonth(mp)}`);
  }
  hdrRow2.push('Fahrzeit Gesamt');

  // Data: 2 rows per vehicle (km + Fahrzeit)
  const dataRows: (string | number)[][] = [];
  for (let i = 0; i < uniqueVehicles.length; i++) {
    const uv = uniqueVehicles[i];
    const byKm = vehicleMonthKm.get(uv.name)!;
    const byMin = vehicleMonthMin.get(uv.name)!;

    // Row 1: km
    const kmRow: (string | number)[] = [i + 1, uv.name, uv.plate, uv.tour];
    if (hasMultiMonths) {
      for (const mp of monthPeriods) kmRow.push(Math.round((byKm.get(mp) || 0) * 10) / 10);
    }
    kmRow.push(Math.round((vehicleTotalKm.get(uv.name) || 0) * 10) / 10);
    dataRows.push(kmRow);

    // Row 2: Fahrzeit
    const fzRow: (string | number)[] = ['', '', '', ''];
    if (hasMultiMonths) {
      for (const mp of monthPeriods) fzRow.push(fmtDur(byMin.get(mp) || 0));
    }
    fzRow.push(fmtDur(vehicleTotalMin.get(uv.name) || 0));
    dataRows.push(fzRow);
  }

  // Footer: 2 rows
  const footerKm: (string | number)[] = ['', 'GESAMT', '', grandTotalDays];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) {
      footerKm.push(Math.round(uniqueVehicles.reduce((s, v) => s + (vehicleMonthKm.get(v.name)!.get(mp) || 0), 0) * 10) / 10);
    }
  }
  footerKm.push(Math.round(grandTotalKm * 10) / 10);

  const footerFz: (string | number)[] = ['', '', '', ''];
  if (hasMultiMonths) {
    for (const mp of monthPeriods) {
      footerFz.push(fmtDur(uniqueVehicles.reduce((s, v) => s + (vehicleMonthMin.get(v.name)!.get(mp) || 0), 0)));
    }
  }
  footerFz.push(fmtDur(grandTotalMin));

  const ovData: (string | number)[][] = [
    [companyName],
    ['Fahrzeug-Controlling'],
    [`Zeitraum: ${period}`],
    [`Anzahl Fahrzeuge: ${uniqueVehicles.length}  |  Tage: ${grandTotalDays}`],
    [],
    hdrRow1,
    hdrRow2,
    ...dataRows,
    [],
    footerKm,
    footerFz,
  ];

  const wsOv = XLSX.utils.aoa_to_sheet(ovData);

  // Column widths
  const ovColWidths: { wch: number }[] = [{ wch: 6 }, { wch: 22 }, { wch: 15 }, { wch: 12 }];
  for (let i = 0; i < valCols; i++) ovColWidths.push({ wch: 18 });
  wsOv['!cols'] = ovColWidths;

  // Merges: title rows + header fixed cols + vehicle fixed cols + footer
  const merges: XLSX.Range[] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: colCount - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: colCount - 1 } },
    // Header fixed cols merge 2 rows (rows 5-6)
    { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } },
    { s: { r: 5, c: 1 }, e: { r: 6, c: 1 } },
    { s: { r: 5, c: 2 }, e: { r: 6, c: 2 } },
    { s: { r: 5, c: 3 }, e: { r: 6, c: 3 } },
  ];
  const dataStart = 7;
  for (let i = 0; i < uniqueVehicles.length; i++) {
    const r = dataStart + i * 2;
    for (let c = 0; c < fixedCols; c++) {
      merges.push({ s: { r, c }, e: { r: r + 1, c } });
    }
  }
  const footerStart = dataStart + uniqueVehicles.length * 2 + 1;
  for (let c = 0; c < fixedCols; c++) {
    merges.push({ s: { r: footerStart, c }, e: { r: footerStart + 1, c } });
  }
  wsOv['!merges'] = merges;

  // Styles
  styleRange(wsOv, 0, 0, 0, colCount - 1, { font: FONT_TITLE });
  styleRange(wsOv, 1, 0, 1, colCount - 1, { font: FONT_SUBTITLE });
  styleRange(wsOv, 2, 0, 2, colCount - 1, { font: FONT_META });
  styleRange(wsOv, 3, 0, 3, colCount - 1, { font: FONT_META });

  const FILL_HDR_KM = { fgColor: { rgb: '2B4C7E' } };
  const FILL_HDR_FZ = { fgColor: { rgb: '3A6B4F' } };
  for (let c = 0; c < colCount; c++) {
    const isFixed = c < fixedCols;
    styleCell(wsOv, 5, c, {
      font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } },
      fill: isFixed ? FILL_HEADER : FILL_HDR_KM,
      border: BORDERS_ALL,
      alignment: { horizontal: c >= fixedCols ? 'right' : (c === 0 ? 'center' : 'left'), vertical: 'center', wrapText: true },
    });
    styleCell(wsOv, 6, c, {
      font: { ...FONT_BOLD, color: { rgb: 'FFFFFF' } },
      fill: isFixed ? FILL_HEADER : FILL_HDR_FZ,
      border: BORDERS_ALL,
      alignment: { horizontal: c >= fixedCols ? 'right' : (c === 0 ? 'center' : 'left'), vertical: 'center', wrapText: true },
    });
  }

  const FILL_KM_LIGHT = { fgColor: { rgb: 'EEF2F9' } };
  const FILL_FZ_LIGHT = { fgColor: { rgb: 'EDF5F0' } };
  for (let i = 0; i < uniqueVehicles.length; i++) {
    const kmR = dataStart + i * 2;
    const fzR = kmR + 1;
    const isAlt = i % 2 === 1;
    for (let c = 0; c < colCount; c++) {
      styleCell(wsOv, kmR, c, {
        font: c === 1 ? FONT_BOLD : FONT_DEFAULT,
        border: BORDERS_ALL,
        fill: isAlt ? FILL_KM_LIGHT : undefined,
        alignment: { horizontal: c === 0 ? 'center' : c >= fixedCols ? 'right' : 'left', vertical: 'center' },
      });
      styleCell(wsOv, fzR, c, {
        font: FONT_DEFAULT,
        border: BORDERS_ALL,
        fill: isAlt ? FILL_FZ_LIGHT : { fgColor: { rgb: 'F8FAF8' } },
        alignment: { horizontal: c >= fixedCols ? 'right' : 'left', vertical: 'center' },
      });
      if (c >= valStart) {
        applyNumberFormat(wsOv, kmR, c, '#,##0.0');
      }
    }
  }

  // Footer
  for (let c = 0; c < colCount; c++) {
    styleCell(wsOv, footerStart, c, {
      font: { ...FONT_BOLD, sz: 11 },
      fill: FILL_TOTAL,
      border: BORDER_BOTTOM_THICK,
      alignment: { horizontal: c >= fixedCols ? 'right' : (c === 0 ? 'center' : 'left'), vertical: 'center' },
    });
    styleCell(wsOv, footerStart + 1, c, {
      font: { ...FONT_BOLD, sz: 11 },
      fill: FILL_TOTAL,
      border: BORDER_BOTTOM_THICK,
      alignment: { horizontal: c >= fixedCols ? 'right' : 'left', vertical: 'center' },
    });
    if (c >= valStart) {
      applyNumberFormat(wsOv, footerStart, c, '#,##0.0');
    }
  }

  XLSX.utils.book_append_sheet(wb, wsOv, 'Übersicht');

  // ── Sheet per vehicle ──
  const headerStyle = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: 'E8EEF4' } }, border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } } };

  for (const uv of uniqueVehicles) {
    const sheetName = uv.name.replace(/[\\/*?[\]:]/g, '').slice(0, 28);
    const groups = vehicles.filter(v => v.name === uv.name);
    const data: (string | number)[][] = [
      [`${uv.name}${uv.plate ? ` (${uv.plate})` : ''}${uv.tour ? ` — Tour: ${uv.tour}` : ''}`],
      [],
    ];

    let totalKmAll = 0, totalMinAll = 0;

    for (const g of groups) {
      data.push([`── ${g.period || period} ──`]);
      data.push(['Datum', 'Tag', 'Beginn', 'Ende', 'Fahrzeit', 'km', 'Letzte Position']);

      for (const d of g.days) {
        data.push([
          d.date,
          wd(d.date),
          d.begin_driving?.split(' ')[1] || '',
          d.last_driving?.split(' ')[1] || '',
          d.duration_hm,
          Math.round(d.distance_km * 10) / 10,
          d.last_location || '',
        ]);
      }

      data.push(['Summe', '', '', '', fmtDur(g.totalMinutes), Math.round(g.totalKm * 10) / 10, '']);
      data.push([]);
      totalKmAll += g.totalKm;
      totalMinAll += g.totalMinutes;
    }

    if (groups.length > 1) {
      data.push(['GESAMT', '', '', '', fmtDur(totalMinAll), Math.round(totalKmAll * 10) / 10, '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 12 }, { wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 35 }];

    if (ws['A1']) ws['A1'].s = { font: { bold: true, sz: 12 } };

    for (let r = 0; r < data.length; r++) {
      const val = data[r][0];
      if (typeof val === 'string' && val.startsWith('──')) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
        if (cell) cell.s = { font: { bold: true, sz: 11, color: { rgb: '1E3A5F' } } };
      }
      if (data[r][0] === 'Datum') {
        for (let c = 0; c < 7; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell) cell.s = headerStyle;
        }
      }
      if (typeof val === 'string' && (val === 'Summe' || val === 'GESAMT')) {
        for (let c = 0; c < 7; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'F0F4F8' } } };
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const safePeriod = period.replace(/[^a-zA-Z0-9_-]/g, '') || 'Fahrzeuge';
  XLSX.writeFile(wb, `Fahrzeuge_${safePeriod}_${uniqueVehicles.length}Fzg.xlsx`);
}

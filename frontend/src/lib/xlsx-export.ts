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

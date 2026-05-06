import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useI18n } from '../i18n';
import { formatDate } from '../lib/format';
import { getHolidayMap } from '../lib/holidays';
import { exportCsv, exportDatev, fetchDriverConfig, fetchMonthlyDays, saveMonthlyDays } from '../lib/api';
import type { DriverConfig, MonthlyDays } from '../lib/api';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { BarChart } from '../components/BarChart';
import { ClipboardCopy, Check, Printer, BarChart3, UtensilsCrossed, FileText, Settings, CalendarDays, HardDrive, Pencil, RotateCcw, Scissors, Trash2, Plus } from 'lucide-react';
import type { AnalysisResult, ShiftDetail } from '../types';
import { DriverConfigEditor } from './DriverConfigEditor';
import { ArbeitszeitReport } from './ArbeitszeitReport';
import { useAuth } from '../hooks/useAuth';
import { minutesToHm } from '../lib/utils';
import { exportToXlsx, generateGoogleSheetsUrl } from '../lib/xlsx-export';
import { useToast } from '../components/Toast';
import { generateAnalysisPdf, generateArbeitszeitnachweisePdf } from '../lib/pdf-generator';
import { MetricCards } from './analysis/MetricCards';
import { VehicleUsageTable } from './analysis/VehicleUsageTable';
import { ExportDropdown } from './analysis/ExportDropdown';

function fmtNight(minutes: number, hm: string) {
  const decimal = (minutes / 60).toFixed(2);
  return `${decimal} (${hm})`;
}

function minutesToDecimal(minutes: number) {
  return (minutes / 60).toFixed(2);
}

/** ISO country code → flag emoji */
function countryFlag(code: string): string {
  if (!code || code.length < 2) return '';
  const c = code.slice(0, 2).toUpperCase();
  return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

const weekdayMap: Record<string, Record<string, string>> = {
  de: { Pn: 'Mo', Wt: 'Di', Śr: 'Mi', Cz: 'Do', Pt: 'Fr', So: 'Sa', Nd: 'So' },
};

function localizeWeekday(wd: string, locale: string): string {
  return weekdayMap[locale]?.[wd] ?? wd;
}

interface VacationRange {
  von: string;
  bis: string;
  tage: number;
}

interface AnalysisViewProps {
  data: AnalysisResult;
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (v: string) => void;
  onDateToChange?: (v: string) => void;
  vacationRanges?: VacationRange[];
  onReanalyze?: () => void;
  filePath?: string;
}

export function AnalysisView({ data, dateFrom, dateTo, onDateFromChange, onDateToChange, vacationRanges, onReanalyze, filePath }: AnalysisViewProps) {
  const { t, locale } = useI18n();
  const { isAdmin, isFeatureVisible } = useAuth();
  const fv = isFeatureVisible;
  const di = data.driver_info;
  const nightH = data.night_start_hour ?? 22;
  const allShifts = data.shift_details;
  const [showConfig, setShowConfig] = useState(false);
  const [driverConfig, setDriverConfig] = useState<DriverConfig | null>(null);

  // Load driver config for VMA calculation
  useEffect(() => {
    if (di.card_number) {
      fetchDriverConfig(di.card_number)
        .then(setDriverConfig)
        .catch(() => setDriverConfig(null));
    }
  }, [di.card_number]);

  // Filter shifts by date range
  const shifts = useMemo(() => {
    if (!dateFrom && !dateTo) return allShifts;
    return allShifts.filter((sh) => {
      const shiftDate = sh.shift_date; // YYYY-MM-DD
      if (dateFrom && shiftDate < dateFrom) return false;
      if (dateTo && shiftDate > dateTo) return false;
      return true;
    });
  }, [allShifts, dateFrom, dateTo]);

  // Manual shift overrides (local edits — e.g. driver made tachograph error)
  const [editingShift, setEditingShift] = useState<number | null>(null);
  const [shiftOverrides, setShiftOverrides] = useState<Record<number, Partial<ShiftDetail>>>({});
  // Manually added shifts (e.g. missing day) and deleted shift indices
  const [addedShifts, setAddedShifts] = useState<ShiftDetail[]>([]);
  const [deletedShifts, setDeletedShifts] = useState<Set<number>>(new Set());
  const [showAddShift, setShowAddShift] = useState(false);

  // Build working shifts: original (minus deleted) + added, sorted by date
  const workingShifts = useMemo(() => {
    const kept = shifts.filter((_, i) => !deletedShifts.has(i));
    const all = [...kept, ...addedShifts];
    all.sort((a, b) => (a.shift_start || '').localeCompare(b.shift_start || ''));
    return all;
  }, [shifts, deletedShifts, addedShifts]);

  // Helper: create empty ShiftDetail for manual entry
  function makeEmptyShift(date: string): ShiftDetail {
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    const wdPl = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
    return {
      shift_start: `${date} 06:00`,
      shift_end: `${date} 14:00`,
      shift_date: date,
      grid_date: date,
      weekday: wdPl[dayOfWeek],
      duration_minutes: 480,
      duration_hm: '8h 00m',
      work_minutes: 480,
      work_hm: '8h 00m',
      work_decimal: 8.0,
      driving_minutes: 0,
      driving_hm: '0h 00m',
      work_only_minutes: 480,
      work_only_hm: '8h 00m',
      avail_minutes: 0,
      avail_hm: '0h 00m',
      break_minutes: 0,
      break_hm: '0h 00m',
      night_25_minutes: 0,
      night_25_hm: '0h 00m',
      night_40_minutes: 0,
      night_40_hm: '0h 00m',
      has_diet: false,
      vehicles: [],
      manual_minutes: 0,
      manual_hm: '0h 00m',
    };
  }

  // Helper: get shift with override applied
  function applyOverride(sh: ShiftDetail, i: number): ShiftDetail {
    const ov = shiftOverrides[i];
    if (!ov) return sh;
    const m = { ...sh, ...ov };
    if (ov.work_minutes !== undefined) m.work_hm = minutesToHm(ov.work_minutes);
    if (ov.driving_minutes !== undefined) m.driving_hm = minutesToHm(ov.driving_minutes);
    if (ov.break_minutes !== undefined) m.break_hm = minutesToHm(ov.break_minutes);
    if (ov.avail_minutes !== undefined) m.avail_hm = minutesToHm(ov.avail_minutes);
    if (ov.duration_minutes !== undefined) m.duration_hm = minutesToHm(ov.duration_minutes);
    if (ov.work_only_minutes !== undefined) m.work_only_hm = minutesToHm(ov.work_only_minutes);
    if (ov.night_25_minutes !== undefined) m.night_25_hm = minutesToHm(ov.night_25_minutes);
    if (ov.night_40_minutes !== undefined) m.night_40_hm = minutesToHm(ov.night_40_minutes);
    return m;
  }

  // Recalculate summary — always recalculate when manual changes exist
  const hasManualChanges = addedShifts.length > 0 || deletedShifts.size > 0 || Object.keys(shiftOverrides).length > 0;
  const s = useMemo(() => {
    if (!dateFrom && !dateTo && !hasManualChanges) {
      const totalDur = (data.shift_details || []).reduce((sum, sh) => sum + (sh.duration_minutes || 0), 0);
      return { ...data.summary, total_duration_minutes: totalDur, total_duration_hm: minutesToHm(totalDur) };
    }

    let totalWork = 0, totalDriving = 0, totalBreak = 0, totalAvail = 0;
    let night25 = 0, night40 = 0, dietCount = 0, totalManual = 0, totalDuration = 0;

    for (let _i = 0; _i < workingShifts.length; _i++) {
      const sh = applyOverride(workingShifts[_i], _i);
      totalWork += sh.work_minutes;
      totalDriving += sh.driving_minutes;
      totalBreak += sh.break_minutes;
      totalAvail += sh.avail_minutes;
      night25 += sh.night_25_minutes;
      night40 += sh.night_40_minutes;
      totalManual += sh.manual_minutes || 0;
      totalDuration += sh.duration_minutes || 0;
      if (sh.has_diet) dietCount++;
    }

    const totalNight = night25 + night40;

    return {
      total_work_hm: minutesToHm(totalWork),
      total_work_decimal: parseFloat(minutesToDecimal(totalWork)),
      total_work_minutes: totalWork,
      total_driving_hm: minutesToHm(totalDriving),
      total_driving_minutes: totalDriving,
      total_break_hm: minutesToHm(totalBreak),
      total_break_minutes: totalBreak,
      total_avail_hm: minutesToHm(totalAvail),
      total_avail_minutes: totalAvail,
      night_25_hm: minutesToHm(night25),
      night_25_decimal: parseFloat(minutesToDecimal(night25)),
      night_25_minutes: night25,
      night_40_hm: minutesToHm(night40),
      night_40_decimal: parseFloat(minutesToDecimal(night40)),
      night_40_minutes: night40,
      total_night_hm: minutesToHm(totalNight),
      total_night_decimal: parseFloat(minutesToDecimal(totalNight)),
      total_night_minutes: totalNight,
      diet_count: dietCount,
      total_shifts: workingShifts.length,
      total_manual_hm: minutesToHm(totalManual),
      total_manual_minutes: totalManual,
      total_duration_minutes: totalDuration,
      total_duration_hm: minutesToHm(totalDuration),
    };
  }, [data.summary, workingShifts, shiftOverrides, hasManualChanges, dateFrom, dateTo]);

  // Total km: sum distance_km from all vehicle records whose usage period
  // overlaps with the selected date range (GloboFleet-style per-record sum).
  const totalKm = useMemo(() => {
    return (data.vehicles || []).reduce((sum, v) => {
      if (dateFrom || dateTo) {
        const fromIso = (v.first_use || '').slice(0, 10);
        const toIso = (v.last_use || '').slice(0, 10);
        if (dateTo && fromIso && fromIso > dateTo) return sum;
        if (dateFrom && toIso && toIso < dateFrom) return sum;
      }
      const dist = v.distance_km ?? Math.max(0, (v.odometer_end_km || 0) - (v.odometer_begin_km || 0));
      return sum + dist;
    }, 0);
  }, [data.vehicles, dateFrom, dateTo]);

  // VMA calculation
  const vma = useMemo(() => {
    const dietRate = driverConfig?.diet_rate ?? 14.0;
    const doubleDiet = driverConfig?.double_diet === 1;
    const ratePerDay = doubleDiet ? dietRate * 2 : dietRate;
    return {
      amount: s.diet_count * ratePerDay,
      ratePerDay,
      doubleDiet,
    };
  }, [s.diet_count, driverConfig]);

  // Monthly days (vacation/sick) - determine period from dateFrom or first shift
  const period = useMemo(() => {
    if (dateFrom && dateFrom.length >= 7) return dateFrom.slice(0, 7);
    if (shifts.length > 0 && shifts[0].shift_date) return shifts[0].shift_date.slice(0, 7);
    return '';
  }, [dateFrom, shifts]);

  const [monthlyDays, setMonthlyDays] = useState<MonthlyDays | null>(null);
  const [savingMonthly, setSavingMonthly] = useState(false);

  useEffect(() => {
    if (di.card_number && period) {
      fetchMonthlyDays(di.card_number, period)
        .then(setMonthlyDays)
        .catch(() => setMonthlyDays(null));
    }
  }, [di.card_number, period]);

  const handleMonthlyChange = useCallback((field: 'vacation_days' | 'sick_days' | 'overtime_hm', value: string) => {
    setMonthlyDays((prev) => {
      if (!prev) return prev;
      const numVal = field === 'overtime_hm' ? value : parseFloat(value) || 0;
      return { ...prev, [field]: numVal };
    });
  }, []);

  const handleAbsenceChange = useCallback((absenceDays: Record<string, 'Ur' | 'Kr'>) => {
    setMonthlyDays((prev) => {
      const vacCount = Object.values(absenceDays).filter((v) => v === 'Ur').length;
      const sickCount = Object.values(absenceDays).filter((v) => v === 'Kr').length;
      if (!prev) {
        return { card_number: '', period: '', vacation_days: vacCount, sick_days: sickCount, overtime_hm: '', notes: '', absence_days: absenceDays };
      }
      return { ...prev, absence_days: absenceDays, vacation_days: vacCount, sick_days: sickCount };
    });
  }, []);

  const handleMonthlySave = useCallback(async () => {
    if (!di.card_number || !period || !monthlyDays) return;
    setSavingMonthly(true);
    try {
      await saveMonthlyDays(di.card_number, period, {
        vacation_days: monthlyDays.vacation_days,
        sick_days: monthlyDays.sick_days,
        overtime_hm: monthlyDays.overtime_hm,
        absence_days: monthlyDays.absence_days,
        override_n25: monthlyDays.override_n25,
        override_n40: monthlyDays.override_n40,
        override_work_hm: monthlyDays.override_work_hm,
      });
    } catch {
      // ignore
    } finally {
      setSavingMonthly(false);
    }
  }, [di.card_number, period, monthlyDays]);

  const handleExport = () => {
    exportCsv(di.driver_name || 'driver', shifts);
  };

  const handlePdfExport = () => {
    generateAnalysisPdf(di.driver_name || 'Fahrer', di.card_number || '', s as any, shifts as any);
  };

  const handleArbeitszeitPdf = () => {
    generateArbeitszeitnachweisePdf(di.driver_name || 'Fahrer', di.card_number || '', s as any, shifts as any);
  };

  const handleDatevExport = () => {
    // Determine period from dateFrom or first shift
    let period = '';
    if (dateFrom && dateFrom.length >= 7) {
      period = dateFrom.slice(0, 7);
    } else if (shifts.length > 0 && shifts[0].shift_date) {
      period = shifts[0].shift_date.slice(0, 7);
    }
    exportDatev(di.driver_name || 'Fahrer', di.card_number || '', s, shifts, period);
  };

  const { toast } = useToast();

  const handleXlsxExport = () => {
    exportToXlsx(di.driver_name || 'driver', di.card_number || '', s as any, shifts as any);
  };

  const handleGoogleSheetsExport = () => {
    generateGoogleSheetsUrl(di.driver_name || 'driver', s as any, shifts as any);
    toast(locale === 'de' ? 'In Zwischenablage kopiert — in Google Sheets einfügen' : 'Skopiowano do schowka — wklej w Google Sheets', 'success');
  };

  const handleStundenzettel = () => {
    // Determine period from shifts
    let period = '';
    if (dateFrom && dateFrom.length >= 7) {
      period = dateFrom.slice(0, 7);
    } else if (shifts.length > 0 && shifts[0].shift_date) {
      period = shifts[0].shift_date.slice(0, 7);
    }
    const year = parseInt(period.slice(0, 4)) || new Date().getFullYear();
    const month = parseInt(period.slice(5, 7)) || (new Date().getMonth() + 1);
    const numDays = new Date(year, month, 0).getDate();

    // Build per-day data from calendar_days (CET-based, one entry per day)
    const calDays = data.calendar_days || {};
    const days: { day: number; start: string; end: string; pause: number; code: string }[] = [];
    for (let d = 1; d <= numDays; d++) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cd = calDays[key];
      if (cd && cd.shift_start && cd.shift_end) {
        // shift_start/shift_end are "YYYY-MM-DD HH:MM"
        const startTime = cd.shift_start.slice(11, 16); // "HH:MM"
        const endTime = cd.shift_end.slice(11, 16);
        const breakMin = cd.break_minutes || 0;
        days.push({ day: d, start: startTime, end: endTime, pause: breakMin, code: '' });
      } else {
        days.push({ day: d, start: '', end: '', pause: 0, code: '' });
      }
    }

    // Store in localStorage and navigate to Stundenzettel page
    localStorage.setItem('stz_prefill', JSON.stringify({
      name: di.driver_name || '',
      period,
      days,
    }));
    window.location.href = '/stundenzettel';
  };

  const [showChart, setShowChart] = useState(false);
  const [showDietReport, setShowDietReport] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [selectedShiftReport, setSelectedShiftReport] = useState<number | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const handleDownloadDdd = useCallback(() => {
    if (!filePath) return;
    window.open(`/api/download/dropbox?path=${encodeURIComponent(filePath)}`, '_blank');
    setExportOpen(false);
  }, [filePath]);

  // Chart data: per-shift stacked bars
  const chartBars = useMemo(() => {
    return shifts.map((sh) => ({
      label: sh.shift_date.slice(8), // DD
      sublabel: localizeWeekday(sh.weekday, locale),
      segments: [
        { value: sh.driving_minutes / 60, color: '#5B6F4B', name: t('analysisDriving') },
        { value: sh.work_only_minutes / 60, color: '#86A35E', name: t('analysisWork') },
        { value: sh.break_minutes / 60, color: '#9A9A92', name: t('analysisBreaks') },
        { value: sh.night_25_minutes / 60, color: '#C5A352', name: t('analysisNight25') },
        { value: sh.night_40_minutes / 60, color: '#B85450', name: t('analysisNight40') },
      ],
    }));
  }, [shifts, t, locale]);

  const handlePrint = useCallback(() => {
    if (!printRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const rows = shifts.map((sh) => `
      <tr>
        <td>${localizeWeekday(sh.weekday, locale)}</td>
        <td>${sh.shift_start}</td>
        <td>${sh.shift_end}</td>
        <td><b>${sh.duration_hm}</b></td>
        <td>${sh.vehicles.join(', ')}</td>
        <td><b>${sh.work_hm}</b></td>
        <td>${sh.driving_hm}</td>
        <td>${sh.work_only_hm}</td>
        <td>${sh.avail_hm}</td>
        <td>${sh.break_hm}</td>
        <td>${fmtNight(sh.night_25_minutes, sh.night_25_hm)}</td>
        <td>${fmtNight(sh.night_40_minutes, sh.night_40_hm)}</td>
        <td>${sh.has_diet ? t('yes') : t('no')}</td>
      </tr>`).join('');

    printWindow.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${di.driver_name} — ${t('analysisTitle')}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; color: #111; font-size: 11px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { color: #666; margin-bottom: 16px; }
  .summary { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
  .summary .box { border: 1px solid #ccc; border-radius: 6px; padding: 8px 14px; text-align: center; }
  .summary .box .label { font-size: 9px; text-transform: uppercase; color: #888; font-weight: bold; letter-spacing: 0.5px; }
  .summary .box .val { font-size: 18px; font-weight: bold; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; white-space: nowrap; }
  th { background: #f5f5f5; font-size: 10px; text-transform: uppercase; }
  @media print { body { margin: 10px; } }
</style></head><body>
  <h1>${di.driver_name}</h1>
  <div class="meta">${di.card_number} &mdash; ${t('analysisIssued')}: ${formatDate(di.card_issue_date, locale)} &mdash; ${t('analysisValidUntil')}: ${formatDate(di.card_expiry_date, locale)}</div>
  <div class="summary">
    <div class="box"><div class="label">${t('analysisWorkTime')}</div><div class="val">${s.total_work_hm}</div></div>
    <div class="box"><div class="label">${t('analysisNight25')}</div><div class="val">${(s.night_25_minutes / 60).toFixed(2)}</div></div>
    <div class="box"><div class="label">${t('analysisNight40')}</div><div class="val">${(s.night_40_minutes / 60).toFixed(2)}</div></div>
    <div class="box"><div class="label">${t('analysisDietCount')}</div><div class="val">${s.diet_count}</div></div>
    <div class="box"><div class="label">${t('analysisDriving')}</div><div class="val">${s.total_driving_hm}</div></div>
    <div class="box"><div class="label">${t('analysisBreaks')}</div><div class="val">${s.total_break_hm}</div></div>
    <div class="box"><div class="label">${t('analysisTotalShifts')}</div><div class="val">${s.total_shifts}</div></div>
  </div>
  <table>
    <thead><tr>
      <th>${t('analysisWeekday')}</th><th>${t('analysisStart')}</th><th>${t('analysisEnd')}</th>
      <th>${t('analysisTime')}</th><th>${t('analysisVehicle')}</th><th>${t('analysisWorkTime')}</th><th>${t('analysisDriving')}</th>
      <th>${t('analysisWork')}</th><th>${t('analysisAvailability')}</th><th>${t('analysisBreaks')}</th><th>${t('analysisNight25')}</th>
      <th>${t('analysisNight40')}</th><th>${t('analysisDiet')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [shifts, di, s, t, locale]);

  const handlePrintDietReport = useCallback(() => {
    const pw = window.open('', '_blank');
    if (!pw) return;

    const dietRows = shifts.map((sh) => {
      const wd = localizeWeekday(sh.weekday, locale);
      const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
      return `<tr${isWeekend ? ' style="color:#999"' : ''}>
        <td>${sh.shift_date}</td>
        <td>${wd}</td>
        <td>${sh.duration_hm}</td>
        <td style="text-align:center;font-weight:bold;${sh.has_diet ? 'color:#16a34a' : 'color:#ccc'}">${sh.has_diet ? t('yes') : t('no')}</td>
      </tr>`;
    }).join('');

    pw.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${di.driver_name} — ${t('dietReport')}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; color: #111; font-size: 12px; }
  h1 { font-size: 18px; margin-bottom: 2px; }
  .meta { color: #666; margin-bottom: 12px; font-size: 11px; }
  .summary { margin-bottom: 16px; font-size: 14px; }
  .summary b { font-size: 20px; color: #16a34a; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ccc; padding: 5px 10px; text-align: left; }
  th { background: #f5f5f5; font-size: 10px; text-transform: uppercase; }
  @media print { body { margin: 10px; } }
</style></head><body>
  <h1>${t('dietReport')}</h1>
  <div class="meta">${di.driver_name} &mdash; ${di.card_number}</div>
  <div class="summary">${t('analysisDietCount')}: <b>${s.diet_count}</b> / ${s.total_shifts} ${t('analysisShifts').toLowerCase()}</div>
  <table>
    <thead><tr>
      <th>${t('syncDate')}</th>
      <th>${t('analysisWeekday')}</th>
      <th>${t('analysisDuration')}</th>
      <th>${t('analysisDiet')}</th>
    </tr></thead>
    <tbody>${dietRows}</tbody>
  </table>
</body></html>`);
    pw.document.close();
    pw.focus();
    pw.print();
  }, [shifts, di, s, t, locale]);

  const hasDateFilter = onDateFromChange && onDateToChange;

  return (
    <div ref={printRef} className="space-y-5">
      {/* Driver card */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-2xl bg-primary-700 p-4 sm:p-5 text-white">
        <div className="min-w-0">
          <h4 className="text-lg font-bold truncate">{di.driver_name || '—'}</h4>
          <p className="mt-0.5 text-sm opacity-70">{di.card_number}</p>
        </div>
        <div className="text-xs leading-relaxed opacity-70 sm:text-right">
          <div>{t('analysisIssued')}: {formatDate(di.card_issue_date, locale)}</div>
          <div>{t('analysisValidUntil')}: {formatDate(di.card_expiry_date, locale)}</div>
        </div>
      </div>

      {/* Date filter */}
      {(hasDateFilter || filePath) && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card px-4 py-3">
          {hasDateFilter && <>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">{t('analysisDateFilter')}:</span>
          <label className="text-xs text-muted">{t('detailFrom')}:</label>
          <input
            type="date"
            value={dateFrom || ''}
            onChange={(e) => onDateFromChange!(e.target.value)}
            className="input rounded-xl px-2.5 py-1.5 text-xs outline-none dark:[color-scheme:dark]"
          />
          <label className="text-xs text-muted">{t('detailTo')}:</label>
          <input
            type="date"
            value={dateTo || ''}
            onChange={(e) => onDateToChange!(e.target.value)}
            className="input rounded-xl px-2.5 py-1.5 text-xs outline-none dark:[color-scheme:dark]"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { onDateFromChange!(''); onDateToChange!(''); }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-danger transition hover:bg-rose-500/10 dark:hover:bg-rose-500/10"
            >
              {t('clear')}
            </button>
          )}
          </>}
          <div className="flex-1" />
          {filePath && (
            <button
              onClick={handleDownloadDdd}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-surface hover:text-ink"
            >
              <HardDrive size={13} />
              {locale === 'de' ? 'DDD herunterladen' : 'Pobierz DDD'}
            </button>
          )}
          {/* Excel copy – inline (hidden on mobile, too wide) */}
          {shifts.length > 0 && (
            <div className="hidden sm:block ml-auto">
              <ExcelCopyBlock summary={s} monthlyDays={monthlyDays} />
            </div>
          )}
        </div>
      )}

      <MetricCards s={s} nightH={nightH} totalKm={totalKm} vma={vma} monthlyDays={monthlyDays} fv={fv} />


      {/* Monthly grid copy block (hidden on mobile - 31-col table) */}
      {fv('monthly_grid') && shifts.length > 0 && hasDateFilter && dateFrom && (
        <div className="hidden sm:block rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-4 ">
          <MonthlyGridCopy
            shifts={shifts}
            summary={s as unknown as Record<string, unknown>}
            dateFrom={dateFrom}
            locale={locale}
            monthlyDays={monthlyDays}
            onAbsenceChange={handleAbsenceChange}
            onSave={handleMonthlySave}
            savingMonthly={savingMonthly}
            vacationRanges={vacationRanges}
            calendarDays={data.calendar_days}
          />
        </div>
      )}

      {/* Chart toggle + chart */}
      {fv('chart') && shifts.length > 1 && (
        <div className="rounded-xl bg-surface">
          <button
            onClick={() => setShowChart(!showChart)}
            className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted transition hover:text-ink"
          >
            <BarChart3 size={14} />
            {t('analysisChart')}
            <span className="ml-auto text-xs font-normal normal-case text-muted">
              {showChart ? '▲' : '▼'}
            </span>
          </button>
          {showChart && (
            <div className="px-4 pb-4">
              <div className="mb-3 flex flex-wrap gap-3 text-[11px]">
                {[
                  { color: '#5B6F4B', name: t('analysisDriving') },
                  { color: '#86A35E', name: t('analysisWork') },
                  { color: '#9A9A92', name: t('analysisBreaks') },
                  { color: '#C5A352', name: t('analysisNight25') },
                  { color: '#B85450', name: t('analysisNight40') },
                ].map((item) => (
                  <span key={item.name} className="flex items-center gap-1.5 text-muted">
                    <span className="inline-block h-3 w-3 rounded" style={{ background: item.color }} />
                    {item.name}
                  </span>
                ))}
              </div>
              <BarChart
                bars={chartBars}
                formatValue={(v) => v.toFixed(1)}
              />
            </div>
          )}
        </div>
      )}

      {/* Diet report toggle */}
      {fv('diet_report') && shifts.length > 0 && (
        <div className="rounded-xl bg-surface">
          <button
            onClick={() => setShowDietReport(!showDietReport)}
            className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted transition hover:text-ink"
          >
            <UtensilsCrossed size={14} />
            {t('dietReport')}
            <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
              {s.diet_count}/{s.total_shifts}
            </span>
            <span className="ml-auto text-xs font-normal normal-case text-muted">
              {showDietReport ? '▲' : '▼'}
            </span>
          </button>
          {showDietReport && (
            <div className="overflow-hidden px-2 sm:px-4 pb-4">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-2 py-2 text-left text-xs font-semibold text-muted">{t('syncDate')}</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-muted">{t('analysisWeekday')}</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-muted">{t('analysisDuration')}</th>
                    <th className="px-2 py-2 text-center text-xs font-semibold text-muted">{t('analysisDiet')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shifts.map((sh, i) => {
                    const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
                    return (
                      <tr key={i} className={isWeekend ? 'text-muted' : ''}>
                        <td className="whitespace-nowrap px-2 py-1.5 font-medium">{sh.shift_date}</td>
                        <td className={`whitespace-nowrap px-2 py-1.5 font-bold ${isWeekend ? 'text-danger' : ''}`}>{localizeWeekday(sh.weekday, locale)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{sh.duration_hm}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-center">
                          {sh.has_diet
                            ? <Badge variant="green">{t('yes')}</Badge>
                            : <span className="text-muted">{t('no')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handlePrintDietReport}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-surface"
                >
                  <Printer size={13} />
                  {t('analysisPrint')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Monthly days (vacation/sick) */}
      {di.card_number && period && monthlyDays && (
        <div className="rounded-[10px] bg-white shadow-1 dark:bg-[#122031] dark:shadow-card p-4 ">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays size={14} className="text-muted" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('monthlyDays')} — {period}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">{t('monthlyVacation')}</label>
              <div className="flex h-[34px] w-20 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-sm font-bold tabular-nums text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                {monthlyDays.vacation_days || 0}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">{t('monthlySick')}</label>
              <div className="flex h-[34px] w-20 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-sm font-bold tabular-nums text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                {monthlyDays.sick_days || 0}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">{t('monthlyOvertime')}</label>
              <input
                type="text"
                value={monthlyDays.overtime_hm}
                onChange={(e) => handleMonthlyChange('overtime_hm', e.target.value)}
                className="w-20 input rounded-xl px-2.5 py-1.5 text-sm tabular-nums outline-none"
                placeholder="0:00"
              />
            </div>
            <button
              onClick={handleMonthlySave}
              disabled={savingMonthly}
              className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              {savingMonthly ? <Spinner size="sm" /> : <Check size={14} />}
              {savingMonthly ? t('loading') : t('monthlySave')}
            </button>
          </div>
          {isAdmin && (
            <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-border pt-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-red-500">{t('overrideN25')}</label>
                <input
                  type="text"
                  value={monthlyDays.override_n25 || ''}
                  onChange={(e) => setMonthlyDays(prev => prev ? { ...prev, override_n25: e.target.value } : prev)}
                  className="w-20 input rounded-xl px-2.5 py-1.5 text-sm tabular-nums outline-none"
                  placeholder="—"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-red-500">{t('overrideN40')}</label>
                <input
                  type="text"
                  value={monthlyDays.override_n40 || ''}
                  onChange={(e) => setMonthlyDays(prev => prev ? { ...prev, override_n40: e.target.value } : prev)}
                  className="w-20 input rounded-xl px-2.5 py-1.5 text-sm tabular-nums outline-none"
                  placeholder="—"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-red-500">{t('overrideWork')}</label>
                <input
                  type="text"
                  value={monthlyDays.override_work_hm || ''}
                  onChange={(e) => setMonthlyDays(prev => prev ? { ...prev, override_work_hm: e.target.value } : prev)}
                  className="w-24 input rounded-xl px-2.5 py-1.5 text-sm tabular-nums outline-none"
                  placeholder="—"
                />
              </div>
              <span className="text-[10px] text-red-400">{t('overrideHint')}</span>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">{t('absenceCalendarHint')}</p>
        </div>
      )}

      {/* Driver config (admin only) */}
      {isAdmin && di.card_number && (
        <div className="rounded-xl bg-surface">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted transition hover:text-ink"
          >
            <Settings size={14} />
            {t('driverConfig')}
            <span className="ml-auto text-xs font-normal normal-case text-muted">
              {showConfig ? '▲' : '▼'}
            </span>
          </button>
          {showConfig && (
            <div className="px-4 pb-4">
              <DriverConfigEditor
                cardNumber={di.card_number}
                driverName={di.driver_name || ''}
                onSaved={onReanalyze}
              />
            </div>
          )}
        </div>
      )}

      {/* Shifts table */}
      {/* Countries visited */}
      {data.card_places && data.card_places.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from(new Set(data.card_places.map(p => p.country).filter(Boolean))).map(c => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border border-border bg-white/60 px-2.5 py-0.5 text-xs font-medium ">
              {countryFlag(c)} {c}
            </span>
          ))}
        </div>
      )}

      {shifts.length > 0 && (
        <>
        {/* Mobile shifts cards */}
        <div className="block sm:hidden space-y-2">
          {shifts.map((sh, i) => {
            const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
            const wd = localizeWeekday(sh.weekday, locale);
            return (
              <div key={i} className={`rounded-xl border p-3 ${isWeekend ? 'border-border bg-rose-50/30 dark:bg-rose-900/10' : 'border-border bg-white/50 '}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-sm font-bold ${isWeekend ? 'text-danger' : ''}`}>{wd} {sh.shift_date?.slice(5)}</span>
                  <span className="text-sm font-bold">{sh.duration_hm}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted">{t('analysisStart')}</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{sh.shift_start?.split(' ')[1] || sh.shift_start}</span>
                  <span className="text-muted">{t('analysisEnd')}</span>
                  <span className="font-medium text-danger dark:text-rose-400">{sh.shift_end?.split(' ')[1] || sh.shift_end}</span>
                  <span className="text-muted">{t('analysisWorkTime')}</span>
                  <span className="font-bold">{sh.work_hm}</span>
                  <span className="text-muted">{t('analysisDriving')}</span>
                  <span className="font-medium">{sh.driving_hm}</span>
                  <span className="text-muted">{t('analysisWork')}</span>
                  <span>{sh.work_only_hm}</span>
                  <span className="text-muted">{t('analysisAvailability')}</span>
                  <span>{sh.avail_hm}</span>
                  <span className="text-muted">{t('analysisBreaks')}</span>
                  <span>{sh.break_hm}</span>
                  {sh.has_diet && <>
                    <span className="text-muted">{t('analysisDiet')}</span>
                    <Badge variant="green">{t('yes')}</Badge>
                  </>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Export dropdown */}
        <ExportDropdown
          onXlsx={handleXlsxExport}
          onCsv={handleExport}
          onPdf={handlePdfExport}
          onArbeitszeitPdf={handleArbeitszeitPdf}
          onDatev={handleDatevExport}
          onGoogleSheets={handleGoogleSheetsExport}
          onStundenzettel={handleStundenzettel}
          onPrint={handlePrint}
          fv={fv}
        />

        {/* Desktop shifts table */}
        <div className="hidden sm:block -mx-6 overflow-x-auto px-6">
          <div className="rounded-xl border border-border">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-border">
                {[t('analysisWeekday'), t('analysisStart'), t('analysisEnd'), t('analysisTime'), t('analysisVehicle'),
                  t('analysisWorkTime'), t('analysisDriving'), t('analysisWork'), t('analysisAvailability'), t('analysisBreaks'),
                  t('analysisNight25'), t('analysisNight40'), t('analysisDiet'),
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {workingShifts.map((rawSh, i) => {
                const sh = applyOverride(rawSh, i);
                const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
                const wd = localizeWeekday(sh.weekday, locale);
                const hasOverride = !!shiftOverrides[i];
                const isEditing = editingShift === i;
                const isAddedShift = addedShifts.includes(rawSh);
                return (<>
                <tr
                  key={i}
                  onClick={() => { if (!isEditing) setSelectedShiftReport(selectedShiftReport === i ? null : i); }}
                  className={`hover:bg-surface cursor-pointer transition ${
                    isAddedShift
                      ? 'bg-emerald-50/60 dark:bg-emerald-900/10 border-l-2 border-l-[#22ad5c]'
                      : hasOverride
                      ? 'bg-amber-50/60 dark:bg-amber-900/10'
                      : selectedShiftReport === i
                      ? 'bg-primary-50/50 dark:bg-primary-900/10'
                      : isWeekend
                      ? 'bg-rose-50/40 dark:bg-rose-900/10'
                      : ''
                  }`}
                >
                  <td className={`whitespace-nowrap px-3 py-2 font-bold ${isWeekend ? 'text-danger' : ''}`}>
                    <div className="flex items-center gap-1">
                      <span>{wd}</span>
                      {isAddedShift && <span className="text-[10px] font-normal text-[#22ad5c]">{sh.shift_date?.slice(5)}</span>}
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingShift(isEditing ? null : i); }}
                        className={`ml-1 rounded p-0.5 transition ${isEditing ? 'text-[#5750f1]' : 'text-[#d1d5db] hover:text-[#6b7280]'}`}
                        title={locale === 'de' ? 'Bearbeiten' : 'Edytuj'}
                      >
                        <Pencil size={12} />
                      </button>
                      {hasOverride && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShiftOverrides(prev => { const n = { ...prev }; delete n[i]; return n; }); }}
                          className="rounded p-0.5 text-[#D34053] hover:text-[#f23030] transition"
                          title={locale === 'de' ? 'Zurücksetzen' : 'Resetuj'}
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // Split: delete original, create 2 new shifts user can edit
                          const nextDate = (() => {
                            const d = new Date(sh.shift_date + 'T00:00:00');
                            d.setDate(d.getDate() + 1);
                            return d.toISOString().slice(0, 10);
                          })();
                          const half1 = Math.floor(sh.work_minutes / 2);
                          const half2 = sh.work_minutes - half1;
                          const dHalf1 = Math.floor(sh.driving_minutes / 2);
                          const dHalf2 = sh.driving_minutes - dHalf1;
                          const bHalf1 = Math.floor(sh.break_minutes / 2);
                          const bHalf2 = sh.break_minutes - bHalf1;

                          // Remove original
                          const origIdx = shifts.indexOf(rawSh);
                          if (origIdx >= 0) {
                            setDeletedShifts(prev => new Set([...prev, origIdx]));
                          } else {
                            setAddedShifts(prev => prev.filter(s => s !== rawSh));
                          }

                          // Create two new shifts
                          const sh1 = makeEmptyShift(sh.shift_date);
                          sh1.shift_start = sh.shift_start;
                          sh1.work_minutes = half1; sh1.work_hm = minutesToHm(half1);
                          sh1.driving_minutes = dHalf1; sh1.driving_hm = minutesToHm(dHalf1);
                          sh1.work_only_minutes = Math.max(0, half1 - dHalf1); sh1.work_only_hm = minutesToHm(sh1.work_only_minutes);
                          sh1.break_minutes = bHalf1; sh1.break_hm = minutesToHm(bHalf1);
                          sh1.duration_minutes = half1 + bHalf1; sh1.duration_hm = minutesToHm(sh1.duration_minutes);
                          sh1.has_diet = sh.has_diet; sh1.vehicles = [...sh.vehicles];
                          sh1.night_25_minutes = sh.night_25_minutes; sh1.night_25_hm = sh.night_25_hm;
                          sh1.night_40_minutes = sh.night_40_minutes; sh1.night_40_hm = sh.night_40_hm;

                          const sh2 = makeEmptyShift(nextDate);
                          sh2.work_minutes = half2; sh2.work_hm = minutesToHm(half2);
                          sh2.driving_minutes = dHalf2; sh2.driving_hm = minutesToHm(dHalf2);
                          sh2.work_only_minutes = Math.max(0, half2 - dHalf2); sh2.work_only_hm = minutesToHm(sh2.work_only_minutes);
                          sh2.break_minutes = bHalf2; sh2.break_hm = minutesToHm(bHalf2);
                          sh2.duration_minutes = half2 + bHalf2; sh2.duration_hm = minutesToHm(sh2.duration_minutes);
                          sh2.has_diet = sh.has_diet; sh2.vehicles = [...sh.vehicles];

                          setAddedShifts(prev => [...prev, sh1, sh2]);
                          // Auto-open edit on both (next render will show them)
                        }}
                        className="rounded p-0.5 text-[#d1d5db] hover:text-[#5750f1] transition"
                        title={locale === 'de' ? 'In 2 Tage teilen' : 'Rozdziel na 2 dni'}
                      >
                        <Scissors size={11} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // Find index in original shifts array
                          const origIdx = shifts.indexOf(rawSh);
                          if (origIdx >= 0) {
                            setDeletedShifts(prev => new Set([...prev, origIdx]));
                          } else {
                            // It's an added shift — remove from addedShifts
                            setAddedShifts(prev => prev.filter(s => s !== rawSh));
                          }
                        }}
                        className="rounded p-0.5 text-[#d1d5db] hover:text-[#D34053] transition"
                        title={locale === 'de' ? 'Löschen' : 'Usuń'}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{sh.shift_start}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{sh.shift_end}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-bold">{sh.duration_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{sh.vehicles.join(', ')}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-bold">{sh.work_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2">{sh.driving_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2">{sh.work_only_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2">{sh.avail_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2">{sh.break_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtNight(sh.night_25_minutes, sh.night_25_hm)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtNight(sh.night_40_minutes, sh.night_40_hm)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {sh.has_diet
                      ? <Badge variant="green">{t('yes')}</Badge>
                      : <span className="text-muted">{t('no')}</span>}
                  </td>
                </tr>
                {isEditing && (
                  <tr key={`edit-${i}`} onClick={e => e.stopPropagation()}>
                    <td colSpan={13} className="px-4 py-3 bg-[#f7f9fc] dark:bg-[#1f2a37]">
                      <div className="flex flex-wrap items-end gap-3">
                        {([
                          ['work_minutes', locale === 'de' ? 'Arbeitszeit' : 'Czas pracy'],
                          ['driving_minutes', locale === 'de' ? 'Lenkzeit' : 'Jazda'],
                          ['break_minutes', locale === 'de' ? 'Pausen' : 'Przerwy'],
                          ['avail_minutes', locale === 'de' ? 'Bereitschaft' : 'Dysp.'],
                          ['night_25_minutes', 'Nacht 25%'],
                          ['night_40_minutes', 'Nacht 40%'],
                        ] as const).map(([field, label]) => {
                          const mins = shiftOverrides[i]?.[field] ?? (sh as any)[field] as number;
                          const hh = String(Math.floor(mins / 60)).padStart(2, '0');
                          const mm = String(mins % 60).padStart(2, '0');
                          return (
                          <div key={field} className="w-[72px]">
                            <label className="block text-[10px] font-medium text-[#6b7280] mb-0.5">{label}</label>
                            <input
                              type="text"
                              value={`${hh}:${mm}`}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^0-9:]/g, '');
                                const parts = raw.split(':');
                                const h = parseInt(parts[0]) || 0;
                                const m = parseInt(parts[1]) || 0;
                                setShiftOverrides(prev => ({
                                  ...prev,
                                  [i]: { ...prev[i], [field]: h * 60 + m },
                                }));
                              }}
                              className="input w-full px-2 py-1 text-xs text-center font-mono"
                              title={label}
                              placeholder="HH:MM"
                            />
                          </div>
                          );
                        })}
                        <div className="w-16">
                          <label className="block text-[10px] font-medium text-[#6b7280] mb-0.5">{locale === 'de' ? 'Diät' : 'Dieta'}</label>
                          <select
                            value={shiftOverrides[i]?.has_diet !== undefined ? (shiftOverrides[i]!.has_diet ? '1' : '0') : (sh.has_diet ? '1' : '0')}
                            onChange={(e) => setShiftOverrides(prev => ({ ...prev, [i]: { ...prev[i], has_diet: e.target.value === '1' } }))}
                            className="input w-full px-1 py-1 text-xs"
                          >
                            <option value="1">{t('yes')}</option>
                            <option value="0">{t('no')}</option>
                          </select>
                        </div>
                        <button
                          onClick={() => setEditingShift(null)}
                          className="rounded-lg bg-[#5750f1] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4a44d4]"
                        >
                          OK
                        </button>
                      </div>
                      <p className="mt-1.5 text-[10px] text-[#9ca3af]">
                        {locale === 'de' ? 'Format HH:MM — Änderungen wirken sich auf die Zusammenfassung aus.' : 'Format GG:MM — zmiany wpływają na podsumowanie.'}
                      </p>
                    </td>
                  </tr>
                )}
                {selectedShiftReport === i && !isEditing && (
                  <tr key={`report-${i}`}>
                    <td colSpan={13} className="p-4 bg-surface">
                      <ArbeitszeitReport shift={sh} />
                    </td>
                  </tr>
                )}
                </>);
              })}
            </tbody>
          </table>
          </div>

          {/* Add shift button + form */}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => setShowAddShift(!showAddShift)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#d1d5db] px-3 py-2 text-xs font-medium text-[#6b7280] transition hover:border-[#5750f1] hover:text-[#5750f1] dark:border-[#374151]"
            >
              <Plus size={13} />
              {locale === 'de' ? 'Tag hinzufügen' : 'Dodaj dzień'}
            </button>
            {(addedShifts.length > 0 || deletedShifts.size > 0) && (
              <button
                onClick={() => { setAddedShifts([]); setDeletedShifts(new Set()); setShiftOverrides({}); }}
                className="inline-flex items-center gap-1 text-xs text-[#D34053] hover:underline"
              >
                <RotateCcw size={11} />
                {locale === 'de' ? 'Alle Änderungen zurücksetzen' : 'Resetuj wszystkie zmiany'}
              </button>
            )}
          </div>
          {showAddShift && (
            <div className="mt-2 rounded-lg bg-[#f7f9fc] dark:bg-[#1f2a37] p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-36">
                  <label className="block text-[10px] font-medium text-[#6b7280] mb-0.5">{locale === 'de' ? 'Datum' : 'Data'}</label>
                  <input
                    id="add-shift-date"
                    type="date"
                    defaultValue={dateFrom || new Date().toISOString().slice(0, 10)}
                    className="input w-full px-2 py-1 text-xs dark:[color-scheme:dark]"
                  />
                </div>
                {([
                  ['work', locale === 'de' ? 'Arbeitszeit' : 'Czas pracy'],
                  ['driving', locale === 'de' ? 'Lenkzeit' : 'Jazda'],
                  ['break', locale === 'de' ? 'Pausen' : 'Przerwy'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="w-[72px]">
                    <label className="block text-[10px] font-medium text-[#6b7280] mb-0.5">{label}</label>
                    <input
                      id={`add-shift-${key}`}
                      type="text"
                      defaultValue={key === 'work' ? '08:00' : key === 'break' ? '00:45' : '00:00'}
                      placeholder="HH:MM"
                      className="input w-full px-2 py-1 text-xs text-center font-mono"
                    />
                  </div>
                ))}
                <div className="w-16">
                  <label className="block text-[10px] font-medium text-[#6b7280] mb-0.5">{locale === 'de' ? 'Diät' : 'Dieta'}</label>
                  <select id="add-shift-diet" defaultValue="0" className="input w-full px-1 py-1 text-xs">
                    <option value="1">{t('yes')}</option>
                    <option value="0">{t('no')}</option>
                  </select>
                </div>
                <button
                  onClick={() => {
                    const dateEl = document.getElementById('add-shift-date') as HTMLInputElement;
                    const parseHM = (id: string) => {
                      const v = (document.getElementById(id) as HTMLInputElement)?.value || '00:00';
                      const [h, m] = v.split(':').map(Number);
                      return (h || 0) * 60 + (m || 0);
                    };
                    const date = dateEl?.value || new Date().toISOString().slice(0, 10);
                    const work = parseHM('add-shift-work');
                    const driving = parseHM('add-shift-driving');
                    const brk = parseHM('add-shift-break');
                    const diet = (document.getElementById('add-shift-diet') as HTMLSelectElement)?.value === '1';
                    const newSh = makeEmptyShift(date);
                    newSh.work_minutes = work;
                    newSh.work_hm = minutesToHm(work);
                    newSh.driving_minutes = driving;
                    newSh.driving_hm = minutesToHm(driving);
                    newSh.work_only_minutes = Math.max(0, work - driving);
                    newSh.work_only_hm = minutesToHm(newSh.work_only_minutes);
                    newSh.break_minutes = brk;
                    newSh.break_hm = minutesToHm(brk);
                    newSh.duration_minutes = work + brk;
                    newSh.duration_hm = minutesToHm(newSh.duration_minutes);
                    newSh.has_diet = diet;
                    setAddedShifts(prev => [...prev, newSh]);
                    setShowAddShift(false);
                  }}
                  className="rounded-lg bg-[#5750f1] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#4a44d4]"
                >
                  {locale === 'de' ? 'Hinzufügen' : 'Dodaj'}
                </button>
                <button onClick={() => setShowAddShift(false)} className="text-xs text-[#6b7280] hover:text-[#111928]">
                  {t('cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
        </>
      )}

      {/* Vehicle usage (GloboFleet-style) */}
      <VehicleUsageTable vehicles={data.vehicles || []} dateFrom={dateFrom} dateTo={dateTo} />

      {shifts.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">{t('noData')}</p>
      )}

      {/* Manual entries collapsible section */}
      {fv('manual_entries') && (data.manual_entries?.length ?? 0) > 0 && (
        <div className="rounded-xl bg-surface">
          <button
            onClick={() => setShowManual(!showManual)}
            className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted transition hover:text-ink"
          >
            <FileText size={14} />
            {t('analysisManualEntries')} ({data.manual_entries!.length}) — {s.total_manual_hm}
            <span className="ml-auto text-xs font-normal normal-case text-muted">
              {showManual ? '▲' : '▼'}
            </span>
          </button>
          {showManual && (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[t('analysisStart'), t('analysisEnd'), t('analysisTime'), t('analysisManualType')].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2 text-left text-xs font-semibold text-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.manual_entries!.map((me, i) => {
                    const hm = `${Math.floor(me.duration_minutes / 60)}:${String(me.duration_minutes % 60).padStart(2, '0')}`;
                    return (
                      <tr key={i} className="hover:bg-surface">
                        <td className="whitespace-nowrap px-4 py-1.5 font-medium">{me.start}</td>
                        <td className="whitespace-nowrap px-4 py-1.5 text-muted">{me.end}</td>
                        <td className="whitespace-nowrap px-4 py-1.5 font-bold">{hm}</td>
                        <td className="whitespace-nowrap px-4 py-1.5">
                          <Badge variant="yellow">{me.declared_type}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Excel copy-paste helper                                           */
/* ------------------------------------------------------------------ */

function ExcelCopyBlock({ summary, monthlyDays }: { summary: ReturnType<typeof Object> & Record<string, unknown>; monthlyDays?: MonthlyDays | null }) {
  const s = summary as Record<string, unknown>;
  const [copied, setCopied] = useState(false);

  const n25 = monthlyDays?.override_n25 || ((s.night_25_minutes as number) / 60).toFixed(2).replace('.', ',');
  const n40 = monthlyDays?.override_n40 || ((s.night_40_minutes as number) / 60).toFixed(2).replace('.', ',');
  const vma = String(s.diet_count ?? 0);
  const azMin = s.total_work_minutes as number;
  const az = monthlyDays?.override_work_hm || `${Math.floor(azMin / 60)}:${String(azMin % 60).padStart(2, '0')}`;

  const urVal = monthlyDays?.vacation_days ? String(monthlyDays.vacation_days) : '';
  const krVal = monthlyDays?.sick_days ? String(monthlyDays.sick_days) : '';
  const ueVal = monthlyDays?.overtime_hm || '';

  const excelHeaders = ['25%', '40%', 'Ü', 'Ur', 'Kr', 'VMA', 'AZ'];
  const values  = [n25,   n40,   ueVal, urVal, krVal, vma, az];

  const handleCopy = useCallback(() => {
    const tsv = values.join('\t');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [n25, n40, vma, az]);

  const cols = excelHeaders.map((h, i) => ({ header: h, value: values[i] }));

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <table className="border-collapse sm:min-w-[600px] text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.header} className="border border-border bg-black/[0.04] px-2 py-1 text-center font-bold text-muted dark:bg-white/10">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {cols.map((c) => (
              <td key={c.header} className="border border-border bg-white/50 px-2 py-1 text-center font-mono ">
                {c.value || <span className="text-muted">&mdash;</span>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 rounded-lg bg-black/[0.06] px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
      >
        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
        {copied ? 'OK!' : 'Kopiuj'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Monthly grid copy-paste (days 1-31, weekdays, work hours, summary)*/
/* ------------------------------------------------------------------ */

const weekdayDeShort: Record<number, string> = {
  0: 'So', 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa',
};
const weekdayPlShort: Record<number, string> = {
  0: 'Nd', 1: 'Pn', 2: 'Wt', 3: 'Śr', 4: 'Cz', 5: 'Pt', 6: 'So',
};

function MonthlyGridCopy({
  shifts,
  summary,
  dateFrom,
  locale,
  monthlyDays,
  onAbsenceChange,
  onSave,
  savingMonthly,
  vacationRanges,
  calendarDays,
}: {
  shifts: ShiftDetail[];
  summary: Record<string, unknown>;
  dateFrom: string;
  locale: string;
  monthlyDays?: MonthlyDays | null;
  onAbsenceChange?: (absenceDays: Record<string, 'Ur' | 'Kr'>) => void;
  onSave?: () => void;
  savingMonthly?: boolean;
  vacationRanges?: { von: string; bis: string; tage: number }[];
  calendarDays?: Record<string, { work_minutes: number }>;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  // Determine month from dateFrom (YYYY-MM-DD) or first shift
  const refDate = dateFrom || (shifts[0]?.shift_date ?? '');
  const year = parseInt(refDate.slice(0, 4), 10) || new Date().getFullYear();
  const month = parseInt(refDate.slice(5, 7), 10) || (new Date().getMonth() + 1); // 1-indexed
  const daysInMonth = new Date(year, month, 0).getDate();

  // German public holidays for this month
  const holidayMap = useMemo(() => getHolidayMap(year), [year]);

  // Build a map: day number -> total duration minutes for that day (from shifts)
  // Uses grid_date (midpoint-based) so overnight shifts land on the correct day.
  const dayWorkMap = useMemo(() => {
    const map: Record<number, number> = {};
    for (const sh of shifts) {
      const dateStr = sh.grid_date || sh.shift_date;
      const d = parseInt(dateStr.slice(8, 10), 10);
      if (!isNaN(d)) {
        map[d] = (map[d] || 0) + sh.duration_minutes;
      }
    }
    return map;
  }, [shifts]);

  // Build set of vacation days from PDF ranges
  const vacationDaySet = useMemo(() => {
    const set = new Set<number>();
    if (!vacationRanges?.length) return set;
    for (const range of vacationRanges) {
      const vonDate = new Date(range.von);
      const bisDate = new Date(range.bis);
      for (let d = new Date(vonDate); d <= bisDate; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() === year && d.getMonth() + 1 === month) {
          const dayOfWeek = d.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            set.add(d.getDate());
          }
        }
      }
    }
    return set;
  }, [vacationRanges, year, month]);

  // Merge: saved absence days + vacation from PDF (PDF fills gaps, doesn't overwrite)
  const absenceDays = useMemo(() => {
    const saved = monthlyDays?.absence_days || {};
    if (vacationDaySet.size === 0) return saved;
    const merged = { ...saved };
    for (const day of vacationDaySet) {
      const key = String(day);
      if (!merged[key]) {
        merged[key] = 'Ur' as const;
      }
    }
    return merged;
  }, [monthlyDays?.absence_days, vacationDaySet]);

  // Generate weekday names for each day
  const wdNames = locale === 'de' ? weekdayDeShort : weekdayPlShort;

  const dayNumbers = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const weekdays = dayNumbers.map((d) => {
    const dt = new Date(year, month - 1, d);
    return wdNames[dt.getDay()];
  });

  // Summary values from summary prop — use overrides if set by admin
  const s = summary;
  const n25 = monthlyDays?.override_n25 || ((s.night_25_minutes as number) / 60).toFixed(2).replace('.', ',');
  const n40 = monthlyDays?.override_n40 || ((s.night_40_minutes as number) / 60).toFixed(2).replace('.', ',');
  const vma = String(s.diet_count ?? 0);
  const azMin = s.total_work_minutes as number;
  const az = monthlyDays?.override_work_hm || `${Math.floor(azMin / 60)}:${String(azMin % 60).padStart(2, '0')}`;

  // Count Ur/Kr from merged absenceDays (includes vacation from PDF)
  const urCount = Object.values(absenceDays).filter(v => v === 'Ur').length;
  const krCount = Object.values(absenceDays).filter(v => v === 'Kr').length;
  const urVal = urCount > 0 ? String(urCount) : (monthlyDays?.vacation_days ? String(monthlyDays.vacation_days) : '');
  const krVal = krCount > 0 ? String(krCount) : (monthlyDays?.sick_days ? String(monthlyDays.sick_days) : '');
  const ueVal = monthlyDays?.overtime_hm || '';

  const summaryHeaders = ['25%', '40%', 'Ü', 'Ur', 'Kr', 'VMA', 'AZ'];
  const summaryValues = [n25, n40, ueVal, urVal, krVal, vma, az];

  // Format work minutes as H:MM
  const fmtWork = (mins: number) => {
    if (!mins) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  // Cycle: empty → Ur → Kr → empty
  const handleCellClick = useCallback((day: number) => {
    const work = dayWorkMap[day] || 0;
    const current = absenceDays[String(day)];
    if (work > 0 && !current) return;
    if (!onAbsenceChange) return;
    const next = { ...absenceDays };
    const key = String(day);
    if (!current) {
      next[key] = 'Ur';
    } else if (current === 'Ur') {
      next[key] = 'Kr';
    } else {
      delete next[key];
    }
    onAbsenceChange(next);
  }, [dayWorkMap, absenceDays, onAbsenceChange]);

  const handleCopy = useCallback(() => {
    // Copy only content (no headers): work hours per day + summary values
    const row3Values = dayNumbers.map((d) => {
      const absence = absenceDays[String(d)];
      if (absence) return absence;
      return fmtWork(dayWorkMap[d] || 0);
    });
    const tsv = [...row3Values, ...summaryValues].join('\t');

    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [dayNumbers, dayWorkMap, absenceDays, summaryValues]);

  const thCls = 'border border-gray-300 bg-gray-200/60 px-1 py-0.5 text-center text-[10px] font-bold text-muted dark:border-gray-600 dark:bg-gray-700';
  const tdCls = 'border border-gray-300 bg-white px-1 py-0.5 text-center font-mono text-[10px] dark:border-gray-600 dark:bg-gray-900';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('monthlyGrid')} — {String(month).padStart(2, '0')}/{year}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-lg bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700 transition hover:bg-primary-200 dark:bg-primary-900/30 dark:hover:bg-primary-900/50"
        >
          {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
          {copied ? 'OK!' : t('adminCopyGrid')}
        </button>
        {onSave && (
          <button
            onClick={onSave}
            disabled={savingMonthly}
            className="flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {savingMonthly ? <Spinner size="sm" /> : <Check size={13} />}
            {savingMonthly ? t('loading') : t('monthlySave')}
          </button>
        )}
        {onAbsenceChange && (
          <span className="ml-auto flex items-center gap-2 text-[10px] text-muted">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-blue-500" /> Ur</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-orange-500" /> Kr</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-purple-500" /> {locale === 'de' ? 'Feiertag' : 'Święto'}</span>
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead>
            {/* Row 1: Day numbers */}
            <tr>
              {dayNumbers.map((d) => (
                <th key={d} className={thCls}>{d}</th>
              ))}
              {summaryHeaders.map((h) => (
                <th key={h} className={thCls}>{h}</th>
              ))}
            </tr>
            {/* Row 2: Weekday names */}
            <tr>
              {weekdays.map((wd, i) => {
                const isWeekend = wd === 'So' || wd === 'Sa' || wd === 'Nd';
                const dayNum = i + 1;
                const dISO = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const isHoliday = holidayMap.has(dISO);
                return (
                  <th
                    key={i}
                    className={`${thCls} ${isWeekend ? '!text-red-400 !bg-red-50 dark:!bg-red-900/20' : ''} ${isHoliday && !isWeekend ? '!text-purple-600 !bg-purple-50 dark:!bg-purple-900/20 dark:!text-purple-400' : ''}`}
                    title={isHoliday ? (holidayMap.get(dISO)!.name) : undefined}
                  >
                    {wd}{isHoliday && !isWeekend ? '*' : ''}
                  </th>
                );
              })}
              {summaryHeaders.map((h) => (
                <th key={`e-${h}`} className="w-1" />
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Row 3: Work hours / absence (interactive) */}
            <tr>
              {dayNumbers.map((d) => {
                const work = dayWorkMap[d] || 0;
                const absence = absenceDays[String(d)] as 'Ur' | 'Kr' | undefined;
                const isClickable = work === 0 && !!onAbsenceChange;
                const isWeekendDay = (() => {
                  const wd = weekdays[d - 1];
                  return wd === 'So' || wd === 'Sa' || wd === 'Nd';
                })();
                const dateISO = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const holiday = holidayMap.get(dateISO);

                let cellContent: React.ReactNode = '';
                let cellClass = tdCls;
                let cellTitle = '';

                if (absence === 'Ur') {
                  cellContent = 'Ur';
                  cellClass = `${tdCls} !bg-blue-100 !text-blue-700 font-bold cursor-pointer dark:!bg-blue-900/40 dark:!text-blue-300`;
                } else if (absence === 'Kr') {
                  cellContent = 'Kr';
                  cellClass = `${tdCls} !bg-orange-100 !text-orange-700 font-bold cursor-pointer dark:!bg-orange-900/40 dark:!text-orange-300`;
                } else if (holiday && !work) {
                  cellContent = 'F';
                  cellClass = `${tdCls} !bg-purple-100 !text-purple-700 font-bold dark:!bg-purple-900/40 dark:!text-purple-300`;
                  cellTitle = `${holiday.name} / ${holiday.namePl}`;
                } else if (work) {
                  cellContent = fmtWork(work);
                  cellClass = `${tdCls} font-semibold text-gray-800 dark:text-gray-200`;
                  if (holiday) cellTitle = `${holiday.name} / ${holiday.namePl}`;
                } else if (isClickable) {
                  cellClass = `${tdCls} cursor-pointer hover:!bg-gray-100 dark:hover:!bg-gray-800 ${isWeekendDay ? '!bg-red-50/50 dark:!bg-red-900/10' : ''}`;
                }

                // Holiday indicator: thin top border
                if (holiday && work) {
                  cellClass += ' !border-t-2 !border-t-purple-500';
                }

                return (
                  <td
                    key={d}
                    className={`${cellClass} select-none`}
                    onClick={(isClickable || absence) ? () => handleCellClick(d) : undefined}
                    title={cellTitle || undefined}
                  >
                    {cellContent}
                  </td>
                );
              })}
              {summaryValues.map((v, i) => (
                <td key={i} className={`${tdCls} font-semibold`}>
                  {v || <span className="text-muted">&mdash;</span>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

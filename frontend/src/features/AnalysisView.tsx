import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useI18n } from '../i18n';
import { formatDate } from '../lib/format';
import { exportCsv, exportDatev, fetchDriverConfig, fetchMonthlyDays, saveMonthlyDays } from '../lib/api';
import type { DriverConfig, MonthlyDays } from '../lib/api';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { BarChart } from '../components/BarChart';
import { Download, FileText, ClipboardCopy, Check, Printer, BarChart3, UtensilsCrossed, Table2, Settings, CalendarDays, Sheet, Scale, Clock } from 'lucide-react';
import type { AnalysisResult, ShiftDetail } from '../types';
import { DriverConfigEditor } from './DriverConfigEditor';
import { useAuth } from '../hooks/useAuth';
import { minutesToHm } from '../lib/utils';
import { exportToXlsx, generateGoogleSheetsUrl } from '../lib/xlsx-export';
import { useToast } from '../components/Toast';
import { generateAnalysisPdf, generateArbeitszeitnachweisePdf } from '../lib/pdf-generator';

function fmtNight(minutes: number, hm: string) {
  const decimal = (minutes / 60).toFixed(2);
  return `${decimal} (${hm})`;
}

function minutesToDecimal(minutes: number) {
  return (minutes / 60).toFixed(2);
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
}

export function AnalysisView({ data, dateFrom, dateTo, onDateFromChange, onDateToChange, vacationRanges, onReanalyze }: AnalysisViewProps) {
  const { t, locale } = useI18n();
  const { isAdmin } = useAuth();
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

  // Recalculate summary based on filtered shifts
  const s = useMemo(() => {
    if (!dateFrom && !dateTo) return data.summary;

    let totalWork = 0, totalDriving = 0, totalBreak = 0, totalAvail = 0;
    let night25 = 0, night40 = 0, dietCount = 0, totalManual = 0;

    for (const sh of shifts) {
      totalWork += sh.work_minutes;
      totalDriving += sh.driving_minutes;
      totalBreak += sh.break_minutes;
      totalAvail += sh.avail_minutes;
      night25 += sh.night_25_minutes;
      night40 += sh.night_40_minutes;
      totalManual += sh.manual_minutes || 0;
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
      total_shifts: shifts.length,
      total_manual_hm: minutesToHm(totalManual),
      total_manual_minutes: totalManual,
    };
  }, [data.summary, shifts, dateFrom, dateTo]);

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
  const printRef = useRef<HTMLDivElement>(null);

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
      {hasDateFilter && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-black/[0.02] px-4 py-3 dark:bg-white/5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">{t('analysisDateFilter')}:</span>
          <label className="text-xs text-muted">{t('detailFrom')}:</label>
          <input
            type="date"
            value={dateFrom || ''}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="input rounded-xl px-2.5 py-1.5 text-xs outline-none dark:[color-scheme:dark]"
          />
          <label className="text-xs text-muted">{t('detailTo')}:</label>
          <input
            type="date"
            value={dateTo || ''}
            onChange={(e) => onDateToChange(e.target.value)}
            className="input rounded-xl px-2.5 py-1.5 text-xs outline-none dark:[color-scheme:dark]"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { onDateFromChange(''); onDateToChange(''); }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-danger transition hover:bg-rose-500/10 dark:hover:bg-rose-500/10"
            >
              {t('clear')}
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

      {/* Key metrics - highlighted */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-center dark:border-primary-800 dark:bg-primary-900/30">
          <p className="text-xs font-bold uppercase tracking-wider text-primary-500">{t('analysisWorkTime')}</p>
          <p className="mt-1 text-2xl font-extrabold text-primary-700 dark:text-primary-300">{s.total_work_hm}</p>
          <p className="mt-0.5 text-xs text-primary-500/70/70">{s.total_work_decimal}h</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-center dark:border-violet-800 dark:bg-violet-900/30" title={locale === 'de' ? `Nachtarbeit ab ${nightH}:00 (25%)` : `Nocne od ${nightH}:00 (25%)`}>
          <p className="text-xs font-bold uppercase tracking-wider text-violet-500 dark:text-violet-400">{t('analysisNight25')}</p>
          <p className="mt-1 text-2xl font-extrabold text-violet-700 dark:text-violet-300">{(s.night_25_minutes / 60).toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-violet-500/70 dark:text-violet-400/70">{s.night_25_hm}</p>
          <p className="mt-0.5 text-xs text-violet-400/60 dark:text-violet-500/60">{locale === 'de' ? 'ab' : 'od'} {nightH}:00</p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-center dark:border-indigo-800 dark:bg-indigo-900/30" title={locale === 'de' ? `Nachtarbeit ab ${nightH}:00 (40%)` : `Nocne od ${nightH}:00 (40%)`}>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">{t('analysisNight40')}</p>
          <p className="mt-1 text-2xl font-extrabold text-indigo-700 dark:text-indigo-300">{(s.night_40_minutes / 60).toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-indigo-500/70 dark:text-indigo-400/70">{s.night_40_hm}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-800 dark:bg-emerald-900/30" title="Verpflegungsmehraufwand - dieta za podróż służbową">
          <p className="text-xs font-bold uppercase tracking-wider text-success dark:text-emerald-400">{t('analysisDietCount')}</p>
          <p className="mt-1 text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">{s.diet_count}</p>
          <p className="mt-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            {vma.amount.toFixed(2).replace('.', ',')} €
            {vma.doubleDiet && <span className="ml-1 text-xs font-normal opacity-70">(2×{vma.ratePerDay / 2}€)</span>}
          </p>
        </div>
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: t('analysisDriving'), value: s.total_driving_hm },
          { label: t('analysisBreaks'), value: s.total_break_hm },
          { label: t('analysisAvailability'), value: s.total_avail_hm },
          { label: t('analysisTotalShifts'), value: String(s.total_shifts) },
          { label: t('analysisNight25') + ' + ' + t('analysisNight40'), value: fmtNight(s.night_25_minutes + s.night_40_minutes, s.total_night_hm) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-black/[0.02] p-3 text-center dark:bg-white/5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
            <p className="mt-0.5 text-xl font-extrabold">{value}</p>
          </div>
        ))}
      </div>

      {/* Monthly grid copy block (hidden on mobile - 31-col table) */}
      {shifts.length > 0 && hasDateFilter && dateFrom && (
        <div className="hidden sm:block rounded-xl bg-black/[0.02] p-4 dark:bg-white/5">
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
      {shifts.length > 1 && (
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
      {shifts.length > 0 && (
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
        <div className="rounded-xl bg-black/[0.02] p-4 dark:bg-white/5">
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
      {shifts.length > 0 && (
        <>
        {/* Mobile shifts cards */}
        <div className="block sm:hidden space-y-2">
          {shifts.map((sh, i) => {
            const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
            const wd = localizeWeekday(sh.weekday, locale);
            const hasErr = (sh as any).manual_errors?.length > 0;
            return (
              <div key={i} className={`rounded-xl border p-3 ${hasErr ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/15' : isWeekend ? 'border-border bg-rose-50/30 dark:bg-rose-900/10' : 'border-border bg-white/50 dark:bg-white/5'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-sm font-bold ${isWeekend ? 'text-danger' : ''}`}>{wd} {sh.shift_date?.slice(5)}</span>
                  <span className={`text-sm font-bold ${hasErr ? 'text-danger' : ''}`}>{sh.duration_hm}</span>
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
                  {sh.manual_minutes > 0 && <>
                    <span className="text-muted">Manual</span>
                    <Badge variant="yellow">{sh.manual_hm}</Badge>
                  </>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop shifts table */}
        <div className="hidden sm:block -mx-6 overflow-x-auto px-6">
          <div className="rounded-xl border border-border">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-border">
                {[t('analysisWeekday'), t('analysisStart'), t('analysisEnd'), t('analysisTime'), t('analysisVehicle'),
                  t('analysisWorkTime'), t('analysisDriving'), t('analysisWork'), t('analysisAvailability'), t('analysisBreaks'),
                  t('analysisNight25'), t('analysisNight40'), t('analysisDiet'), 'Manual',
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shifts.map((sh, i) => {
                const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
                const wd = localizeWeekday(sh.weekday, locale);
                const hasManualError = (sh as any).manual_errors?.length > 0;
                const manualErrorTitle = hasManualError
                  ? (sh as any).manual_errors.map((e: any) => `${e.declared_type}: ${e.start} → ${e.end} (${e.duration_minutes}min)`).join('\n')
                  : '';
                return (
                <tr
                  key={i}
                  className={`hover:bg-surface ${
                    hasManualError
                      ? 'bg-red-50 dark:bg-red-900/15'
                      : isWeekend
                      ? 'bg-rose-50/40 dark:bg-rose-900/10'
                      : ''
                  }`}
                  title={manualErrorTitle}
                >
                  <td className={`whitespace-nowrap px-3 py-2 font-bold ${isWeekend ? 'text-danger' : ''}`}>{wd}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{sh.shift_start}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{sh.shift_end}</td>
                  <td className={`whitespace-nowrap px-3 py-2 font-bold ${hasManualError ? 'text-danger' : ''}`}>{sh.duration_hm}</td>
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
                  <td className="whitespace-nowrap px-3 py-2">
                    {hasManualError
                      ? <Badge variant="red">{sh.manual_hm || 'ERR'}</Badge>
                      : sh.manual_minutes > 0
                      ? <Badge variant="yellow">{sh.manual_hm}</Badge>
                      : <span className="text-muted">-</span>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        </>
      )}

      {shifts.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">{t('noData')}</p>
      )}

      {/* Export */}
      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <button
          onClick={handleXlsxExport}
          className="flex min-h-[44px] items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 dark:hover:bg-primary-600"
        >
          <Download size={16} />
          {t('analysisExportXlsx')}
        </button>
        <button
          onClick={handleExport}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-primary-200 px-5 py-2.5 text-sm font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-primary-800"
        >
          <Download size={16} />
          {t('analysisExportCsv')}
        </button>
        <button
          onClick={handlePdfExport}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-primary-200 px-5 py-2.5 text-sm font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-primary-800"
        >
          <FileText size={16} />
          {t('analysisExportPdf')}
        </button>
        <button
          onClick={handleArbeitszeitPdf}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
        >
          <Scale size={16} />
          {t('analysisExportArbeitszeitnachweis')}
        </button>
        <button
          onClick={handleDatevExport}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
        >
          <Table2 size={16} />
          {t('analysisExportDatev')}
        </button>
        <button
          onClick={handleGoogleSheetsExport}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-5 py-2.5 text-sm font-semibold text-green-700 transition hover:bg-green-100 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
        >
          <Sheet size={16} />
          {t('analysisExportGSheets')}
        </button>
        <button
          onClick={handleStundenzettel}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-amber-900/30"
        >
          <Clock size={16} />
          Stundenzettel
        </button>
        <button
          onClick={handlePrint}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-muted transition hover:bg-surface"
        >
          <Printer size={16} />
          {t('analysisPrint')}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Excel copy-paste helper                                           */
/* ------------------------------------------------------------------ */

function ExcelCopyBlock({ summary, monthlyDays }: { summary: ReturnType<typeof Object> & Record<string, unknown>; monthlyDays?: MonthlyDays | null }) {
  const s = summary as Record<string, unknown>;
  const [copied, setCopied] = useState(false);

  const n25 = ((s.night_25_minutes as number) / 60).toFixed(2).replace('.', ',');
  const n40 = ((s.night_40_minutes as number) / 60).toFixed(2).replace('.', ',');
  const vma = String(s.diet_count ?? 0);
  const azMin = s.total_work_minutes as number;
  const az = `${Math.floor(azMin / 60)}:${String(azMin % 60).padStart(2, '0')}`;

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
              <td key={c.header} className="border border-border bg-white/50 px-2 py-1 text-center font-mono dark:bg-white/5">
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

  // Summary values from summary prop (recalculated in parent from shifts)
  const s = summary;
  const n25 = ((s.night_25_minutes as number) / 60).toFixed(2).replace('.', ',');
  const n40 = ((s.night_40_minutes as number) / 60).toFixed(2).replace('.', ',');
  const vma = String(s.diet_count ?? 0);
  const azMin = s.total_work_minutes as number;
  const az = `${Math.floor(azMin / 60)}:${String(azMin % 60).padStart(2, '0')}`;

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
                return (
                  <th key={i} className={`${thCls} ${isWeekend ? '!text-red-400 !bg-red-50 dark:!bg-red-900/20' : ''}`}>{wd}</th>
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

                let cellContent: React.ReactNode = '';
                let cellClass = tdCls;

                if (absence === 'Ur') {
                  cellContent = 'Ur';
                  cellClass = `${tdCls} !bg-blue-100 !text-blue-700 font-bold cursor-pointer dark:!bg-blue-900/40 dark:!text-blue-300`;
                } else if (absence === 'Kr') {
                  cellContent = 'Kr';
                  cellClass = `${tdCls} !bg-orange-100 !text-orange-700 font-bold cursor-pointer dark:!bg-orange-900/40 dark:!text-orange-300`;
                } else if (work) {
                  cellContent = fmtWork(work);
                  cellClass = `${tdCls} font-semibold text-gray-800 dark:text-gray-200`;
                } else if (isClickable) {
                  cellClass = `${tdCls} cursor-pointer hover:!bg-gray-100 dark:hover:!bg-gray-800 ${isWeekendDay ? '!bg-red-50/50 dark:!bg-red-900/10' : ''}`;
                }

                return (
                  <td
                    key={d}
                    className={`${cellClass} select-none`}
                    onClick={(isClickable || absence) ? () => handleCellClick(d) : undefined}
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

import { useMemo, useState, useCallback, useRef } from 'react';
import { useI18n } from '../i18n';
import { formatDate } from '../lib/format';
import { exportCsv, exportPdf } from '../lib/api';
import { Badge } from '../components/Badge';
import { BarChart } from '../components/BarChart';
import { Download, FileText, ClipboardCopy, Check, Printer, BarChart3 } from 'lucide-react';
import type { AnalysisResult, ShiftDetail } from '../types';

function fmtNight(minutes: number, hm: string) {
  const decimal = (minutes / 60).toFixed(2);
  return `${decimal} (${hm})`;
}

function minutesToHm(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function minutesToDecimal(minutes: number) {
  return (minutes / 60).toFixed(2);
}

interface AnalysisViewProps {
  data: AnalysisResult;
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (v: string) => void;
  onDateToChange?: (v: string) => void;
}

export function AnalysisView({ data, dateFrom, dateTo, onDateFromChange, onDateToChange }: AnalysisViewProps) {
  const { t, locale } = useI18n();
  const di = data.driver_info;
  const allShifts = data.shift_details;

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
    let night25 = 0, night40 = 0, dietCount = 0;

    for (const sh of shifts) {
      totalWork += sh.work_minutes;
      totalDriving += sh.driving_minutes;
      totalBreak += sh.break_minutes;
      totalAvail += sh.avail_minutes;
      night25 += sh.night_25_minutes;
      night40 += sh.night_40_minutes;
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
    };
  }, [data.summary, shifts, dateFrom, dateTo]);

  const handleExport = () => {
    exportCsv(di.driver_name || 'driver', shifts);
  };

  const handlePdfExport = () => {
    exportPdf(di.driver_name || 'driver', di.card_number || '', s, shifts);
  };

  const [showChart, setShowChart] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Chart data: per-shift stacked bars
  const chartBars = useMemo(() => {
    return shifts.map((sh) => ({
      label: sh.shift_date.slice(5), // MM-DD
      segments: [
        { value: sh.driving_minutes / 60, color: '#3b82f6', name: t('analysisDriving') },
        { value: sh.work_only_minutes / 60, color: '#8b5cf6', name: t('analysisWork') },
        { value: sh.break_minutes / 60, color: '#6b7280', name: t('analysisBreaks') },
        { value: sh.night_25_minutes / 60, color: '#a78bfa', name: t('analysisNight25') },
        { value: sh.night_40_minutes / 60, color: '#6366f1', name: t('analysisNight40') },
      ],
    }));
  }, [shifts, t]);

  const handlePrint = useCallback(() => {
    if (!printRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const rows = shifts.map((sh) => `
      <tr>
        <td>${sh.weekday}</td>
        <td>${sh.shift_start}</td>
        <td>${sh.shift_end}</td>
        <td><b>${sh.duration_hm}</b></td>
        <td>${sh.vehicles.join(', ')}</td>
        <td>${sh.driving_hm}</td>
        <td>${sh.work_only_hm}</td>
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
      <th>${t('analysisTime')}</th><th>${t('analysisVehicle')}</th><th>${t('analysisDriving')}</th>
      <th>${t('analysisWork')}</th><th>${t('analysisBreaks')}</th><th>${t('analysisNight25')}</th>
      <th>${t('analysisNight40')}</th><th>${t('analysisDiet')}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [shifts, di, s, t, locale]);

  const hasDateFilter = onDateFromChange && onDateToChange;

  return (
    <div ref={printRef} className="space-y-5">
      {/* Driver card */}
      <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-gray-900 to-primary-800 p-5 text-white">
        <div>
          <h4 className="text-lg font-bold">{di.driver_name || '—'}</h4>
          <p className="mt-0.5 text-sm opacity-70">{di.card_number}</p>
        </div>
        <div className="text-right text-xs leading-relaxed opacity-70">
          <div>{t('analysisIssued')}: {formatDate(di.card_issue_date, locale)}</div>
          <div>{t('analysisValidUntil')}: {formatDate(di.card_expiry_date, locale)}</div>
        </div>
      </div>

      {/* Date filter */}
      {hasDateFilter && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-800">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('analysisDateFilter')}:</span>
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('detailFrom')}:</label>
          <input
            type="date"
            value={dateFrom || ''}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:[color-scheme:dark]"
          />
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('detailTo')}:</label>
          <input
            type="date"
            value={dateTo || ''}
            onChange={(e) => onDateToChange(e.target.value)}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:[color-scheme:dark]"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { onDateFromChange(''); onDateToChange(''); }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              {t('clear')}
            </button>
          )}
          {/* Excel copy – inline */}
          {shifts.length > 0 && (
            <div className="ml-auto">
              <ExcelCopyBlock summary={s} />
            </div>
          )}
        </div>
      )}

      {/* Key metrics - highlighted */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-center dark:border-primary-800 dark:bg-primary-900/30">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-primary-500 dark:text-primary-400">{t('analysisWorkTime')}</p>
          <p className="mt-1 text-2xl font-extrabold text-primary-700 dark:text-primary-300">{s.total_work_hm}</p>
          <p className="mt-0.5 text-xs text-primary-500/70 dark:text-primary-400/70">{s.total_work_decimal}h</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-center dark:border-violet-800 dark:bg-violet-900/30">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-violet-500 dark:text-violet-400">{t('analysisNight25')}</p>
          <p className="mt-1 text-2xl font-extrabold text-violet-700 dark:text-violet-300">{(s.night_25_minutes / 60).toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-violet-500/70 dark:text-violet-400/70">{s.night_25_hm}</p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-center dark:border-indigo-800 dark:bg-indigo-900/30">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">{t('analysisNight40')}</p>
          <p className="mt-1 text-2xl font-extrabold text-indigo-700 dark:text-indigo-300">{(s.night_40_minutes / 60).toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-indigo-500/70 dark:text-indigo-400/70">{s.night_40_hm}</p>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center dark:border-green-800 dark:bg-green-900/30">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-green-500 dark:text-green-400">{t('analysisDietCount')}</p>
          <p className="mt-1 text-2xl font-extrabold text-green-700 dark:text-green-300">{s.diet_count}</p>
          <p className="mt-0.5 text-xs text-green-500/70 dark:text-green-400/70">{t('analysisTotalShifts')}: {s.total_shifts}</p>
        </div>
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: t('analysisDriving'), value: s.total_driving_hm },
          { label: t('analysisBreaks'), value: s.total_break_hm },
          { label: t('analysisAvailability'), value: s.total_avail_hm },
          { label: t('analysisTotalShifts'), value: String(s.total_shifts) },
          { label: t('analysisNight25') + ' + ' + t('analysisNight40'), value: fmtNight(s.night_25_minutes + s.night_40_minutes, s.total_night_hm) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-gray-50 p-3 text-center dark:bg-gray-800">
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-gray-400">{label}</p>
            <p className="mt-0.5 text-xl font-extrabold">{value}</p>
          </div>
        ))}
      </div>

      {/* Chart toggle + chart */}
      {shifts.length > 1 && (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800">
          <button
            onClick={() => setShowChart(!showChart)}
            className="flex w-full items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <BarChart3 size={14} />
            {t('analysisChart')}
            <span className="ml-auto text-[10px] font-normal normal-case text-gray-400">
              {showChart ? '▲' : '▼'}
            </span>
          </button>
          {showChart && (
            <div className="px-4 pb-4">
              <div className="flex flex-wrap gap-3 pb-2 text-[10px]">
                {[
                  { color: '#3b82f6', name: t('analysisDriving') },
                  { color: '#8b5cf6', name: t('analysisWork') },
                  { color: '#6b7280', name: t('analysisBreaks') },
                  { color: '#a78bfa', name: t('analysisNight25') },
                  { color: '#6366f1', name: t('analysisNight40') },
                ].map((item) => (
                  <span key={item.name} className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
                    {item.name}
                  </span>
                ))}
              </div>
              <BarChart
                bars={chartBars}
                height={220}
                formatValue={(v) => v.toFixed(1)}
              />
            </div>
          )}
        </div>
      )}

      {/* Shifts table */}
      {shifts.length > 0 && (
        <div className="-mx-6 overflow-x-auto px-6">
          <div className="rounded-xl ring-1 ring-gray-200 dark:ring-gray-700">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                {[t('analysisWeekday'), t('analysisStart'), t('analysisEnd'), t('analysisTime'), t('analysisVehicle'),
                  t('analysisDriving'), t('analysisWork'), t('analysisBreaks'),
                  t('analysisNight25'), t('analysisNight40'), t('analysisDiet'),
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {shifts.map((sh, i) => {
                const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
                return (
                <tr key={i} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${isWeekend ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                  <td className={`whitespace-nowrap px-3 py-2 font-bold ${isWeekend ? 'text-red-500' : ''}`}>{sh.weekday}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{sh.shift_start}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-gray-400">{sh.shift_end}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-bold">{sh.duration_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-gray-400">{sh.vehicles.join(', ')}</td>
                  <td className="whitespace-nowrap px-3 py-2">{sh.driving_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2">{sh.work_only_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2">{sh.break_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtNight(sh.night_25_minutes, sh.night_25_hm)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtNight(sh.night_40_minutes, sh.night_40_hm)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {sh.has_diet
                      ? <Badge variant="green">{t('yes')}</Badge>
                      : <span className="text-gray-300 dark:text-gray-600">{t('no')}</span>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {shifts.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-400">{t('noData')}</p>
      )}

      {/* Export */}
      <div className="flex justify-center gap-3 pt-2">
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
        >
          <Download size={16} />
          {t('analysisExportCsv')}
        </button>
        <button
          onClick={handlePdfExport}
          className="flex items-center gap-2 rounded-xl border border-primary-200 px-5 py-2.5 text-sm font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-primary-800 dark:text-primary-400 dark:hover:bg-primary-900/20"
        >
          <FileText size={16} />
          {t('analysisExportPdf')}
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
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

function ExcelCopyBlock({ summary }: { summary: ReturnType<typeof Object> & Record<string, unknown> }) {
  const s = summary as Record<string, unknown>;
  const [copied, setCopied] = useState(false);

  const n25 = ((s.night_25_minutes as number) / 60).toFixed(2).replace('.', ',');
  const n40 = ((s.night_40_minutes as number) / 60).toFixed(2).replace('.', ',');
  const vma = String(s.diet_count ?? 0);
  const azMin = s.total_work_minutes as number;
  const az = `${Math.floor(azMin / 60)}:${String(azMin % 60).padStart(2, '0')}`;

  const headers = ['25%', '40%', 'Ü', 'Ur', 'Kr', 'VMA', 'AZ'];
  const values  = [n25,   n40,   '',  '',   '',   vma,   az];

  const handleCopy = useCallback(() => {
    const tsv = values.join('\t');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [n25, n40, vma, az]);

  const cols = headers.map((h, i) => ({ header: h, value: values[i] }));

  return (
    <div className="flex items-center gap-2">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.header} className="border border-gray-300 bg-gray-200/60 px-2 py-1 text-center font-bold text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {cols.map((c) => (
              <td key={c.header} className="border border-gray-300 bg-white px-2 py-1 text-center font-mono dark:border-gray-600 dark:bg-gray-900">
                {c.value || <span className="text-gray-300 dark:text-gray-600">&mdash;</span>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 rounded-lg bg-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
      >
        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
        {copied ? 'OK!' : 'Kopiuj'}
      </button>
    </div>
  );
}

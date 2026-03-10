import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { formatDate } from '../lib/format';
import { exportCsv } from '../lib/api';
import { Badge } from '../components/Badge';
import { Download } from 'lucide-react';
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

  const hasDateFilter = onDateFromChange && onDateToChange;

  return (
    <div className="space-y-5">
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
          <p className="mt-1 text-2xl font-extrabold text-violet-700 dark:text-violet-300">{fmtNight(s.night_25_minutes, s.night_25_hm)}</p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-center dark:border-indigo-800 dark:bg-indigo-900/30">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">{t('analysisNight40')}</p>
          <p className="mt-1 text-2xl font-extrabold text-indigo-700 dark:text-indigo-300">{fmtNight(s.night_40_minutes, s.night_40_hm)}</p>
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

      {/* Shifts table */}
      {shifts.length > 0 && (
        <div className="-mx-6 overflow-x-auto px-6">
          <div className="rounded-xl ring-1 ring-gray-200 dark:ring-gray-700">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                {[t('analysisStart'), t('analysisEnd'), t('analysisTime'), t('analysisVehicle'),
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
              {shifts.map((sh, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
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
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {shifts.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-400">{t('noData')}</p>
      )}

      {/* Export */}
      <div className="flex justify-center pt-2">
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
        >
          <Download size={16} />
          {t('analysisExportCsv')}
        </button>
      </div>
    </div>
  );
}

import { useI18n } from '../i18n';
import { formatDate } from '../lib/format';
import { exportCsv } from '../lib/api';
import { Badge } from '../components/Badge';
import { Download } from 'lucide-react';
import type { AnalysisResult } from '../types';

function fmtNight(minutes: number, hm: string) {
  const decimal = (minutes / 60).toFixed(2);
  return `${decimal} (${hm})`;
}

export function AnalysisView({ data }: { data: AnalysisResult }) {
  const { t, locale } = useI18n();
  const di = data.driver_info;
  const s = data.summary;
  const shifts = data.shift_details;

  const handleExport = () => {
    exportCsv(di.driver_name || 'driver', shifts);
  };

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

      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t('analysisWorkTime'), value: s.total_work_hm },
          { label: t('analysisDriving'), value: s.total_driving_hm },
          { label: t('analysisNight25'), value: fmtNight(s.night_25_minutes, s.night_25_hm) },
          { label: t('analysisNight40'), value: fmtNight(s.night_40_minutes, s.night_40_hm) },
          { label: t('analysisBreaks'), value: s.total_break_hm },
          { label: t('analysisTotalShifts'), value: String(s.total_shifts) },
          { label: t('analysisDietCount'), value: String(s.diet_count) },
          { label: t('analysisAvailability'), value: s.total_avail_hm },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-gray-50 p-3 text-center dark:bg-gray-800">
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-gray-400">{label}</p>
            <p className="mt-0.5 text-xl font-extrabold">{value}</p>
          </div>
        ))}
      </div>

      {/* Shifts table */}
      {shifts.length > 0 && (
        <div className="overflow-x-auto rounded-xl ring-1 ring-gray-200 dark:ring-gray-700">
          <table className="w-full text-sm">
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

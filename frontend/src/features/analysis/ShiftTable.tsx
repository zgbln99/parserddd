import { useI18n } from '../../i18n';
import { Badge } from '../../components/Badge';
import type { ShiftDetail } from '../../types';

function fmtNight(minutes: number, hm: string) {
  const decimal = (minutes / 60).toFixed(2);
  return `${decimal} (${hm})`;
}

const weekdayMap: Record<string, Record<string, string>> = {
  de: { Pn: 'Mo', Wt: 'Di', Śr: 'Mi', Cz: 'Do', Pt: 'Fr', So: 'Sa', Nd: 'So' },
};

function localizeWeekday(wd: string, locale: string): string {
  return weekdayMap[locale]?.[wd] ?? wd;
}

interface ShiftTableProps {
  shifts: ShiftDetail[];
}

export function ShiftTable({ shifts }: ShiftTableProps) {
  const { t, locale } = useI18n();

  return (
    <>
      {/* Mobile shifts cards */}
      <div className="block sm:hidden space-y-2">
        {shifts.map((sh, i) => {
          const isWeekend = sh.weekday === 'So' || sh.weekday === 'Nd';
          const wd = localizeWeekday(sh.weekday, locale);
          return (
            <div key={i} className={`rounded-xl border border-border p-3 ${isWeekend ? 'bg-rose-50/30 dark:bg-rose-900/10' : 'bg-white/50 dark:bg-white/5'}`}>
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
              return (
              <tr key={i} className={`hover:bg-surface ${isWeekend ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''}`}>
                <td className={`whitespace-nowrap px-3 py-2 font-bold ${isWeekend ? 'text-danger' : ''}`}>{wd}</td>
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
                <td className="whitespace-nowrap px-3 py-2">
                  {sh.manual_minutes > 0
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
  );
}

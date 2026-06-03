import { useI18n } from '../i18n';
import { Badge } from './Badge';
import type { ShiftDetail } from '../types';

/**
 * Driver-facing shift table for the public profile page.
 *
 * Deliberately separate from the heavy internal ``ShiftTable`` (which has a
 * 1100px min-width and a "Manual" column): here we prioritise readability —
 * the DATE is the first column, no horizontal scroll on normal screens, and
 * a clean card layout on mobile. No "Manual" column.
 */

const weekdayMap: Record<string, Record<string, string>> = {
  de: { Pn: 'Mo', Wt: 'Di', Śr: 'Mi', Cz: 'Do', Pt: 'Fr', So: 'Sa', Nd: 'So' },
};

function wd(w: string, locale: string): string {
  return weekdayMap[locale]?.[w] ?? w;
}

// "2026-05-02" → "02.05"
function ddmm(date: string): string {
  if (!date || date.length < 10) return date || '';
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

function hhmm(s: string): string {
  // shift_start/end are "YYYY-MM-DD HH:MM" — show just the clock time.
  if (!s) return '';
  const parts = s.split(' ');
  return parts.length > 1 ? parts[1] : s;
}

export function ProfileShiftTable({ shifts }: { shifts: ShiftDetail[] }) {
  const { t, locale } = useI18n();

  return (
    <>
      {/* Mobile: one card per shift */}
      <div className="space-y-2.5 sm:hidden">
        {shifts.map((sh, i) => {
          const weekend = sh.weekday === 'So' || sh.weekday === 'Nd';
          return (
            <div
              key={i}
              className={`rounded-2xl border p-3.5 ${
                weekend
                  ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-900/10'
                  : 'border-border bg-surface/40'
              }`}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span className={`text-base font-bold ${weekend ? 'text-danger' : 'text-ink'}`}>
                  {wd(sh.weekday, locale)} {ddmm(sh.shift_date)}
                </span>
                <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-1 text-sm font-bold text-[#0071e3]">
                  {sh.duration_hm}
                </span>
              </div>
              {sh.vehicles.length > 0 && (
                <div className="mb-2 text-xs font-medium text-muted">{sh.vehicles.join(', ')}</div>
              )}
              <div className="mb-2.5 flex items-center gap-2 text-sm">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {hhmm(sh.shift_start)}
                </span>
                <span className="text-muted">→</span>
                <span className="font-semibold text-rose-500 dark:text-rose-400">
                  {hhmm(sh.shift_end)}
                </span>
                {sh.has_diet && (
                  <span className="ml-auto">
                    <Badge variant="green">{t('analysisDiet')}</Badge>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <Field label={t('analysisWorkTime')} value={sh.work_hm} strong />
                <Field label={t('analysisDriving')} value={sh.driving_hm} />
                <Field label={t('analysisWork')} value={sh.work_only_hm} />
                <Field label={t('analysisAvailability')} value={sh.avail_hm} />
                <Field label={t('analysisBreaks')} value={sh.break_hm} />
                <Field label={t('analysisNight25')} value={sh.night_25_hm} />
                <Field label={t('analysisNight40')} value={sh.night_40_hm} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: full-width table, date first, no Manual */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {[
                t('analysisWeekday'),
                t('analysisVehicle'),
                t('analysisStart'),
                t('analysisEnd'),
                t('analysisTime'),
                t('analysisWorkTime'),
                t('analysisDriving'),
                t('analysisWork'),
                t('analysisAvailability'),
                t('analysisBreaks'),
                t('analysisNight25'),
                t('analysisNight40'),
                t('analysisDiet'),
              ].map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shifts.map((sh, i) => {
              const weekend = sh.weekday === 'So' || sh.weekday === 'Nd';
              return (
                <tr
                  key={i}
                  className={`transition hover:bg-surface ${
                    weekend ? 'bg-rose-50/50 dark:bg-rose-900/10' : ''
                  }`}
                >
                  <td className={`whitespace-nowrap px-3 py-2.5 font-bold ${weekend ? 'text-danger' : 'text-ink'}`}>
                    {wd(sh.weekday, locale)} <span className="font-medium text-muted">{ddmm(sh.shift_date)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted">{sh.vehicles.join(', ') || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-emerald-600 dark:text-emerald-400">
                    {hhmm(sh.shift_start)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-rose-500 dark:text-rose-400">
                    {hhmm(sh.shift_end)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-bold">{sh.duration_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{sh.work_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted">{sh.driving_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted">{sh.work_only_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted">{sh.avail_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted">{sh.break_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted">{sh.night_25_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted">{sh.night_40_hm}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {sh.has_diet ? (
                      <Badge variant="green">{t('yes')}</Badge>
                    ) : (
                      <span className="text-muted">{t('no')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className={strong ? 'text-right font-bold' : 'text-right'}>{value}</span>
    </>
  );
}

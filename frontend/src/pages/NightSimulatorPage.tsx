import { useState, useMemo } from 'react';
import { Moon, Play, RotateCcw } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { minutesToHm } from '../lib/utils';

/**
 * Night hours calculation — identical to backend calculate_shift_night_hours().
 *
 * Night window: 22:00–06:00
 *   22:00–00:00 → always 25%
 *   00:00–04:00 → 40% if shift started before midnight, else 25%
 *   04:00–06:00 → always 25%
 */
function calcNightMinutes(
  shiftStartH: number,
  shiftStartM: number,
  shiftEndH: number,
  shiftEndM: number,
): { night25: number; night40: number } {
  // Convert to minutes from a base of 00:00 on day 0
  let startMin = shiftStartH * 60 + shiftStartM;
  let endMin = shiftEndH * 60 + shiftEndM;

  // If end <= start, shift crosses midnight → end is next day
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }

  let night25 = 0;
  let night40 = 0;

  // Process each calendar day the shift spans
  // Day 0 starts at minute 0, day 1 at 1440, etc.
  const firstDay = Math.floor(startMin / (24 * 60));
  const lastDay = Math.floor((endMin - 1) / (24 * 60));

  for (let day = firstDay; day <= lastDay; day++) {
    const dayBase = day * 24 * 60;
    const chunkStart = Math.max(startMin, dayBase);
    const chunkEnd = Math.min(endMin, dayBase + 24 * 60);

    // 22:00–00:00 → always 25%
    const r1Start = dayBase + 22 * 60;
    const r1End = dayBase + 24 * 60;
    const o1Start = Math.max(chunkStart, r1Start);
    const o1End = Math.min(chunkEnd, r1End);
    if (o1End > o1Start) {
      night25 += o1End - o1Start;
    }

    // 00:00–04:00 → 40% if shift started before this day's midnight, else 25%
    const r2Start = dayBase;
    const r2End = dayBase + 4 * 60;
    const o2Start = Math.max(chunkStart, r2Start);
    const o2End = Math.min(chunkEnd, r2End);
    if (o2End > o2Start) {
      const mins = o2End - o2Start;
      // shift_start < day_base means shift started before 00:00 of this calendar day
      if (startMin < dayBase) {
        night40 += mins;
      } else {
        night25 += mins;
      }
    }

    // 04:00–06:00 → always 25%
    const r3Start = dayBase + 4 * 60;
    const r3End = dayBase + 6 * 60;
    const o3Start = Math.max(chunkStart, r3Start);
    const o3End = Math.min(chunkEnd, r3End);
    if (o3End > o3Start) {
      night25 += o3End - o3Start;
    }
  }

  return { night25, night40 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

interface DayResult {
  day: number;
  weekday: string;
  isWeekend: boolean;
  night25: number;
  night40: number;
  totalNight: number;
}

export function NightSimulatorPage() {
  const { t, locale } = useI18n();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [startH, setStartH] = useState('22');
  const [startM, setStartM] = useState('00');
  const [endH, setEndH] = useState('06');
  const [endM, setEndM] = useState('00');
  const [excludeWeekends, setExcludeWeekends] = useState(false);
  const [results, setResults] = useState<DayResult[] | null>(null);

  const wdNames = locale === 'de'
    ? ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
    : ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];

  const handleSimulate = () => {
    const sH = parseInt(startH, 10) || 0;
    const sM = parseInt(startM, 10) || 0;
    const eH = parseInt(endH, 10) || 0;
    const eM = parseInt(endM, 10) || 0;
    const numDays = daysInMonth(year, month);
    const days: DayResult[] = [];

    for (let d = 1; d <= numDays; d++) {
      const date = new Date(year, month - 1, d);
      const dayOfWeek = date.getDay();
      const wd = wdNames[dayOfWeek];
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      if (excludeWeekends && isWeekend) {
        days.push({ day: d, weekday: wd, isWeekend, night25: 0, night40: 0, totalNight: 0 });
        continue;
      }

      const { night25, night40 } = calcNightMinutes(sH, sM, eH, eM);
      days.push({ day: d, weekday: wd, isWeekend, night25, night40, totalNight: night25 + night40 });
    }

    setResults(days);
  };

  const totals = useMemo(() => {
    if (!results) return null;
    const n25 = results.reduce((s, r) => s + r.night25, 0);
    const n40 = results.reduce((s, r) => s + r.night40, 0);
    const workingDays = results.filter((r) => r.totalNight > 0).length;
    return { night25: n25, night40: n40, total: n25 + n40, workingDays };
  }, [results]);

  const handleReset = () => {
    setResults(null);
    setStartH('22');
    setStartM('00');
    setEndH('06');
    setEndM('00');
    setExcludeWeekends(false);
  };

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = ['00', '15', '30', '45'];
  const inputCls = 'input rounded-lg px-3 py-2 text-sm';
  const monthOptions = (locale === 'de'
    ? ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
    : ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień']
  );

  const fmtMin = (m: number) => {
    const decimal = (m / 60).toFixed(2);
    return `${minutesToHm(m)} (${decimal}h)`;
  };

  return (
    <div className="animate-slide-up space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
          <Moon size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nightSimTitle')}</h1>
          <p className="text-xs text-muted">{t('nightSimSubtitle')}</p>
        </div>
      </div>

      {/* Configuration */}
      <Card className="p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Month & Year */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('nightSimMonth')}</label>
            <div className="flex gap-2">
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={`flex-1 ${inputCls}`}
              >
                {monthOptions.map((name, i) => (
                  <option key={i} value={i + 1}>{name}</option>
                ))}
              </select>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className={`w-20 ${inputCls}`}
                min={2020}
                max={2040}
              />
            </div>
          </div>

          {/* Shift start */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('nightSimStart')}</label>
            <div className="flex items-center gap-1">
              <select value={startH} onChange={(e) => setStartH(e.target.value)} className={inputCls}>
                {hours.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="text-muted font-bold">:</span>
              <select value={startM} onChange={(e) => setStartM(e.target.value)} className={inputCls}>
                {minutes.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Shift end */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('nightSimEnd')}</label>
            <div className="flex items-center gap-1">
              <select value={endH} onChange={(e) => setEndH(e.target.value)} className={inputCls}>
                {hours.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="text-muted font-bold">:</span>
              <select value={endM} onChange={(e) => setEndM(e.target.value)} className={inputCls}>
                {minutes.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Options */}
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={excludeWeekends}
                onChange={(e) => setExcludeWeekends(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600"
              />
              {t('nightSimExcludeWeekends')}
            </label>
          </div>
        </div>

        {/* Buttons */}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={handleSimulate}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
          >
            <Play size={14} />
            {t('nightSimGenerate')}
          </button>
          {results && (
            <button
              onClick={handleReset}
              className="flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted transition hover:bg-surface"
            >
              <RotateCcw size={14} />
              {t('nightSimReset')}
            </button>
          )}
        </div>
      </Card>

      {/* Info box about the algorithm */}
      <Card className="p-4 sm:p-5">
        <p className="mb-2 text-sm font-semibold">{t('nightSimRules')}</p>
        <ul className="space-y-1 text-xs text-muted">
          <li>• 22:00–00:00 → {t('nightSimAlways25')}</li>
          <li>• 00:00–04:00 → {t('nightSim40rule')}</li>
          <li>• 04:00–06:00 → {t('nightSimAlways25')}</li>
          <li>• {t('nightSimRestSkip')}</li>
        </ul>
      </Card>

      {/* Results */}
      {results && totals && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4 text-center">
              <p className="text-xs text-muted">{t('nightSimWorkDays')}</p>
              <p className="mt-1 text-2xl font-bold">{totals.workingDays}</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-xs text-muted">{t('analysisNight25')}</p>
              <p className="mt-1 text-lg font-bold text-amber-600 dark:text-amber-400">{fmtMin(totals.night25)}</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-xs text-muted">{t('analysisNight40')}</p>
              <p className="mt-1 text-lg font-bold text-rose-600 dark:text-rose-400">{fmtMin(totals.night40)}</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-xs text-muted">{t('nightSimTotal')}</p>
              <p className="mt-1 text-lg font-bold text-primary-600">{fmtMin(totals.total)}</p>
            </Card>
          </div>

          {/* Day-by-day table */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('nightSimDay')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('analysisWeekday')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">{t('analysisNight25')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">{t('analysisNight40')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted">{t('nightSimTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.map((r) => (
                    <tr
                      key={r.day}
                      className={r.isWeekend ? 'bg-rose-50/30 dark:bg-rose-900/5' : 'hover:bg-surface'}
                    >
                      <td className="px-4 py-2 font-medium">{r.day}</td>
                      <td className={`px-4 py-2 ${r.isWeekend ? 'font-bold text-rose-400' : 'text-muted'}`}>{r.weekday}</td>
                      <td className="px-4 py-2 text-right font-medium text-amber-600 dark:text-amber-400">
                        {r.night25 > 0 ? minutesToHm(r.night25) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-rose-600 dark:text-rose-400">
                        {r.night40 > 0 ? minutesToHm(r.night40) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold">
                        {r.totalNight > 0 ? minutesToHm(r.totalNight) : '—'}
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="border-t-2 border-border bg-surface font-bold">
                    <td className="px-4 py-3" colSpan={2}>{t('settlementTotal')}</td>
                    <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-400">{fmtMin(totals.night25)}</td>
                    <td className="px-4 py-3 text-right text-rose-600 dark:text-rose-400">{fmtMin(totals.night40)}</td>
                    <td className="px-4 py-3 text-right text-primary-600">{fmtMin(totals.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

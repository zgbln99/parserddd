import { useState, useMemo } from 'react';
import { Moon, Play, RotateCcw, Plus, Trash2, Coffee, Calculator } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { minutesToHm } from '../lib/utils';

/* ── Types ── */

interface BreakSlot {
  id: number;
  afterMinutes: number;   // break starts X minutes after shift start
  durationMinutes: number; // break duration
}

interface WorkInterval {
  start: number; // absolute minutes
  end: number;
}

interface DayResult {
  day: number;
  weekday: string;
  isWeekend: boolean;
  night25: number;
  night40: number;
  totalNight: number;
  breakMinutes: number;
  workMinutes: number;
}

/* ── Calculation (identical to backend calculate_shift_night_hours) ── */

function calcNightForIntervals(
  intervals: WorkInterval[],
  shiftStartMin: number,
): { night25: number; night40: number } {
  let night25 = 0;
  let night40 = 0;

  for (const iv of intervals) {
    const firstDay = Math.floor(iv.start / (24 * 60));
    const lastDay = Math.floor(Math.max(iv.start, iv.end - 1) / (24 * 60));

    for (let day = firstDay; day <= lastDay; day++) {
      const dayBase = day * 24 * 60;
      const chunkStart = Math.max(iv.start, dayBase);
      const chunkEnd = Math.min(iv.end, dayBase + 24 * 60);
      if (chunkEnd <= chunkStart) continue;

      // 22:00–00:00 → always 25%
      const o1Start = Math.max(chunkStart, dayBase + 22 * 60);
      const o1End = Math.min(chunkEnd, dayBase + 24 * 60);
      if (o1End > o1Start) night25 += o1End - o1Start;

      // 00:00–04:00 → 40% if shift started before midnight, else 25%
      const o2Start = Math.max(chunkStart, dayBase);
      const o2End = Math.min(chunkEnd, dayBase + 4 * 60);
      if (o2End > o2Start) {
        if (shiftStartMin < dayBase) {
          night40 += o2End - o2Start;
        } else {
          night25 += o2End - o2Start;
        }
      }

      // 04:00–06:00 → always 25%
      const o3Start = Math.max(chunkStart, dayBase + 4 * 60);
      const o3End = Math.min(chunkEnd, dayBase + 6 * 60);
      if (o3End > o3Start) night25 += o3End - o3Start;
    }
  }

  return { night25, night40 };
}

/**
 * Build work intervals from shift times + breaks.
 * Breaks are defined as "after X minutes from shift start, pause Y minutes".
 * The parser skips work_type==0 intervals — here we do the same by splitting
 * the shift into work-only intervals around the breaks.
 */
function buildWorkIntervals(
  shiftStartMin: number,
  shiftEndMin: number,
  breaks: BreakSlot[],
): WorkInterval[] {
  // Sort breaks by when they start (absolute time)
  const sortedBreaks = [...breaks]
    .map((b) => ({
      start: shiftStartMin + b.afterMinutes,
      end: shiftStartMin + b.afterMinutes + b.durationMinutes,
    }))
    .filter((b) => b.start < shiftEndMin && b.end > shiftStartMin)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping breaks
  const merged: { start: number; end: number }[] = [];
  for (const brk of sortedBreaks) {
    const clamped = { start: Math.max(brk.start, shiftStartMin), end: Math.min(brk.end, shiftEndMin) };
    if (merged.length > 0 && clamped.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, clamped.end);
    } else {
      merged.push({ ...clamped });
    }
  }

  // Build work intervals (gaps between breaks)
  const intervals: WorkInterval[] = [];
  let cursor = shiftStartMin;
  for (const brk of merged) {
    if (cursor < brk.start) {
      intervals.push({ start: cursor, end: brk.start });
    }
    cursor = brk.end;
  }
  if (cursor < shiftEndMin) {
    intervals.push({ start: cursor, end: shiftEndMin });
  }

  return intervals;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/* ── Presets ── */

interface BreakPreset {
  labelKey: string;
  breaks: Omit<BreakSlot, 'id'>[];
}

const BREAK_PRESETS: BreakPreset[] = [
  {
    labelKey: 'nightSimPresetNone',
    breaks: [],
  },
  {
    // 1x 45 min after 4.5h (EU 561/2006 standard)
    labelKey: 'nightSimPreset45',
    breaks: [{ afterMinutes: 270, durationMinutes: 45 }],
  },
  {
    // 15 min + 30 min (split EU break)
    labelKey: 'nightSimPresetSplit',
    breaks: [
      { afterMinutes: 120, durationMinutes: 15 },
      { afterMinutes: 330, durationMinutes: 30 },
    ],
  },
  {
    // 2x 30 min breaks
    labelKey: 'nightSimPreset2x30',
    breaks: [
      { afterMinutes: 180, durationMinutes: 30 },
      { afterMinutes: 390, durationMinutes: 30 },
    ],
  },
];

let _nextBreakId = 1;

/* ── Component ── */

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
  const [breaks, setBreaks] = useState<BreakSlot[]>([
    { id: _nextBreakId++, afterMinutes: 270, durationMinutes: 45 },
  ]);
  const [monthlyGross, setMonthlyGross] = useState('');
  const [results, setResults] = useState<DayResult[] | null>(null);

  const wdNames = locale === 'de'
    ? ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
    : ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];

  const handleSimulate = () => {
    const sH = parseInt(startH, 10) || 0;
    const sM = parseInt(startM, 10) || 0;
    const eH = parseInt(endH, 10) || 0;
    const eM = parseInt(endM, 10) || 0;

    let shiftStartMin = sH * 60 + sM;
    let shiftEndMin = eH * 60 + eM;
    if (shiftEndMin <= shiftStartMin) shiftEndMin += 24 * 60;

    const totalShiftMin = shiftEndMin - shiftStartMin;
    const totalBreakMin = breaks.reduce((s, b) => s + b.durationMinutes, 0);

    const workIntervals = buildWorkIntervals(shiftStartMin, shiftEndMin, breaks);
    const numDays = daysInMonth(year, month);
    const days: DayResult[] = [];

    for (let d = 1; d <= numDays; d++) {
      const date = new Date(year, month - 1, d);
      const dayOfWeek = date.getDay();
      const wd = wdNames[dayOfWeek];
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      if (excludeWeekends && isWeekend) {
        days.push({ day: d, weekday: wd, isWeekend, night25: 0, night40: 0, totalNight: 0, breakMinutes: 0, workMinutes: 0 });
        continue;
      }

      const { night25, night40 } = calcNightForIntervals(workIntervals, shiftStartMin);
      const workMin = totalShiftMin - totalBreakMin;
      days.push({ day: d, weekday: wd, isWeekend, night25, night40, totalNight: night25 + night40, breakMinutes: totalBreakMin, workMinutes: workMin });
    }

    setResults(days);
  };

  const totals = useMemo(() => {
    if (!results) return null;
    const n25 = results.reduce((s, r) => s + r.night25, 0);
    const n40 = results.reduce((s, r) => s + r.night40, 0);
    const workingDays = results.filter((r) => r.totalNight > 0).length;
    const totalWork = results.reduce((s, r) => s + r.workMinutes, 0);
    const totalBreak = results.reduce((s, r) => s + r.breakMinutes, 0);
    return { night25: n25, night40: n40, total: n25 + n40, workingDays, totalWork, totalBreak };
  }, [results]);

  const costCalc = useMemo(() => {
    if (!totals || totals.totalWork <= 0) return null;
    const gross = parseFloat(monthlyGross.replace(',', '.'));
    if (!gross || gross <= 0) return null;
    const totalWorkH = totals.totalWork / 60;
    const hourlyRate = gross / totalWorkH;
    const cost25 = (totals.night25 / 60) * hourlyRate * 0.25;
    const cost40 = (totals.night40 / 60) * hourlyRate * 0.40;
    return { gross, hourlyRate, cost25, cost40, total: cost25 + cost40 };
  }, [totals, monthlyGross]);

  const handleReset = () => {
    setResults(null);
    setStartH('22');
    setStartM('00');
    setEndH('06');
    setEndM('00');
    setExcludeWeekends(false);
    setBreaks([{ id: _nextBreakId++, afterMinutes: 270, durationMinutes: 45 }]);
    setMonthlyGross('');
  };

  const addBreak = () => {
    setBreaks((prev) => [...prev, { id: _nextBreakId++, afterMinutes: 180, durationMinutes: 30 }]);
  };

  const removeBreak = (id: number) => {
    setBreaks((prev) => prev.filter((b) => b.id !== id));
  };

  const updateBreak = (id: number, field: 'afterMinutes' | 'durationMinutes', value: number) => {
    setBreaks((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  };

  const applyPreset = (preset: BreakPreset) => {
    setBreaks(preset.breaks.map((b) => ({ ...b, id: _nextBreakId++ })));
  };

  // Shift duration for displaying break "after X min" as actual clock time
  const shiftStartTotalMin = (parseInt(startH, 10) || 0) * 60 + (parseInt(startM, 10) || 0);
  const breakToTime = (afterMin: number) => {
    const abs = (shiftStartTotalMin + afterMin) % (24 * 60);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">{t('nightSimMonthlyGross')}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={monthlyGross}
                  onChange={(e) => setMonthlyGross(e.target.value)}
                  placeholder={locale === 'de' ? 'z.B. 2800' : 'np. 2800'}
                  className={`w-28 ${inputCls}`}
                />
                <span className="text-xs text-muted">EUR</span>
              </div>
            </div>
          </div>
        </div>

        {/* Breaks section */}
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Coffee size={16} className="text-muted" />
              <span className="text-sm font-semibold">{t('nightSimBreaks')}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {BREAK_PRESETS.map((preset, i) => (
                <button
                  key={i}
                  onClick={() => applyPreset(preset)}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-primary-300 hover:text-ink"
                >
                  {t(preset.labelKey as any)}
                </button>
              ))}
            </div>
          </div>

          {breaks.length === 0 && (
            <p className="mb-3 text-xs text-muted italic">{t('nightSimNoBreaks')}</p>
          )}

          <div className="space-y-2">
            {breaks.map((brk) => (
              <div key={brk.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface p-2.5">
                <span className="text-xs text-muted whitespace-nowrap">{t('nightSimBreakAfter')}</span>
                <select
                  value={brk.afterMinutes}
                  onChange={(e) => updateBreak(brk.id, 'afterMinutes', Number(e.target.value))}
                  className="input rounded-md px-2 py-1.5 text-xs"
                >
                  {Array.from({ length: 49 }, (_, i) => i * 15).map((m) => (
                    <option key={m} value={m}>
                      {minutesToHm(m)} ({breakToTime(m)})
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted whitespace-nowrap">{t('nightSimBreakDuration')}</span>
                <select
                  value={brk.durationMinutes}
                  onChange={(e) => updateBreak(brk.id, 'durationMinutes', Number(e.target.value))}
                  className="input rounded-md px-2 py-1.5 text-xs"
                >
                  {[15, 30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>{m} min</option>
                  ))}
                </select>
                <span className="ml-auto text-[10px] text-muted">
                  {breakToTime(brk.afterMinutes)}–{breakToTime(brk.afterMinutes + brk.durationMinutes)}
                </span>
                <button
                  onClick={() => removeBreak(brk.id)}
                  className="rounded-md p-1.5 text-muted transition hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addBreak}
            className="mt-2 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface hover:text-ink"
          >
            <Plus size={14} />
            {t('nightSimAddBreak')}
          </button>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Card className="p-4 text-center">
              <p className="text-xs text-muted">{t('nightSimWorkDays')}</p>
              <p className="mt-1 text-2xl font-bold">{totals.workingDays}</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-xs text-muted">{t('nightSimTotalWork')}</p>
              <p className="mt-1 text-lg font-bold">{fmtMin(totals.totalWork)}</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-xs text-muted">{t('nightSimTotalBreak')}</p>
              <p className="mt-1 text-lg font-bold text-muted">{fmtMin(totals.totalBreak)}</p>
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

          {/* Cost calculator */}
          {costCalc && (
            <Card className="p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Calculator size={16} className="text-primary-600" />
                <span className="text-sm font-semibold">{t('nightSimCostTitle')}</span>
                <span className="text-xs text-muted">
                  ({costCalc.gross.toFixed(0)} EUR ÷ {(totals!.totalWork / 60).toFixed(1)}h = {costCalc.hourlyRate.toFixed(2)} EUR/h)
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/10">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{t('nightSimCost25')}</p>
                  <p className="text-xs text-muted">{(totals!.night25 / 60).toFixed(2)}h × {costCalc.hourlyRate.toFixed(2)} × 25%</p>
                  <p className="mt-1 text-xl font-bold text-amber-600 dark:text-amber-400">{costCalc.cost25.toFixed(2)} EUR</p>
                </div>
                <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-900/10">
                  <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{t('nightSimCost40')}</p>
                  <p className="text-xs text-muted">{(totals!.night40 / 60).toFixed(2)}h × {costCalc.hourlyRate.toFixed(2)} × 40%</p>
                  <p className="mt-1 text-xl font-bold text-rose-600 dark:text-rose-400">{costCalc.cost40.toFixed(2)} EUR</p>
                </div>
                <div className="rounded-lg bg-primary-50 p-3 dark:bg-primary-900/10">
                  <p className="text-xs font-medium">{t('nightSimCostTotal')}</p>
                  <p className="mt-1 text-2xl font-bold text-primary-600">{costCalc.total.toFixed(2)} EUR</p>
                </div>
              </div>
            </Card>
          )}

          {/* Day-by-day table */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('nightSimDay')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('analysisWeekday')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted">{t('analysisWorkTime')}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted">{t('analysisBreaks')}</th>
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
                      <td className="px-4 py-2 text-right text-muted">
                        {r.workMinutes > 0 ? minutesToHm(r.workMinutes) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-muted">
                        {r.breakMinutes > 0 ? minutesToHm(r.breakMinutes) : '—'}
                      </td>
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
                    <td className="px-4 py-3 text-right">{fmtMin(totals.totalWork)}</td>
                    <td className="px-4 py-3 text-right text-muted">{fmtMin(totals.totalBreak)}</td>
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

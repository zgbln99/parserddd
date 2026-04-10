import { useState, useCallback, useRef, useMemo, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import {
  Upload, FileText, AlertCircle, Clock, Moon, UtensilsCrossed,
  CalendarDays, Thermometer, Palmtree, Star, ClipboardCopy, Check,
  Plus, Trash2,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { parseStundenzettel, type StundenzettelDay } from '../lib/api';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('StundenzettelPage crash:', error, info); }
  render() {
    if (this.state.error) return (
      <div className="rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
        <strong>Render error:</strong> {this.state.error}
      </div>
    );
    return this.props.children;
  }
}

interface EditableDay {
  day: number;
  start: string;
  end: string;
  pause: number;
  code: string;
}

const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const CODE_OPTIONS = ['', 'K', 'U', 'F', 'UU', 'SA', 'SU'];
const CODE_COLORS: Record<string, string> = {
  K: 'bg-red-50/50 dark:bg-red-900/10',
  U: 'bg-emerald-50/50 dark:bg-emerald-900/10',
  F: 'bg-blue-50/50 dark:bg-blue-900/10',
};

function hm(minutes: number): string {
  if (!minutes || minutes <= 0) return '0:00';
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function parseTimeToMin(t: string): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

function calcDay(d: EditableDay, weekend = false) {
  const startMin = parseTimeToMin(d.start);
  const endMin = parseTimeToMin(d.end);
  if (startMin === null || endMin === null) return { work: 0, night25: 0, night40: 0, diet: false };

  let end = endMin;
  if (end <= startMin) end += 1440;

  const gross = end - startMin;
  const work = Math.max(0, gross - d.pause);

  let night25 = 0, night40 = 0;
  for (let m = startMin; m < startMin + work && m < end; m++) {
    const h = (m % 1440) / 60 | 0;
    if (h >= 22 || (h >= 4 && h < 6)) night25++;
    else if (h >= 0 && h < 4) {
      if (startMin < 1440) night40++; else night25++;
    }
  }

  return { work, night25, night40, diet: !weekend && gross >= 480 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function makeEmptyDays(year: number, month: number): EditableDay[] {
  const count = daysInMonth(year, month);
  return Array.from({ length: count }, (_, i) => ({
    day: i + 1, start: '', end: '', pause: 0, code: '',
  }));
}

function getWeekday(year: number, month: number, day: number): string {
  try { return WEEKDAYS_SHORT[new Date(year, month - 1, day).getDay()] || ''; } catch { return ''; }
}

function isWeekend(year: number, month: number, day: number): boolean {
  try { const d = new Date(year, month - 1, day).getDay(); return d === 0 || d === 6; } catch { return false; }
}

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function StundenzettelPage() {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [period, setPeriod] = useState(getCurrentPeriod);
  const year = parseInt(period.slice(0, 4)) || new Date().getFullYear();
  const month = parseInt(period.slice(5, 7)) || (new Date().getMonth() + 1);

  const [name, setName] = useState('');
  const [days, setDays] = useState<EditableDay[]>(() => makeEmptyDays(
    parseInt(getCurrentPeriod().slice(0, 4)),
    parseInt(getCurrentPeriod().slice(5, 7)),
  ));

  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
    const y = parseInt(newPeriod.slice(0, 4)) || year;
    const m = parseInt(newPeriod.slice(5, 7)) || month;
    // Keep existing data for days that exist in new month, add/remove as needed
    setDays(prev => {
      const newCount = daysInMonth(y, m);
      const result: EditableDay[] = [];
      for (let i = 1; i <= newCount; i++) {
        result.push(prev.find(d => d.day === i) || { day: i, start: '', end: '', pause: 0, code: '' });
      }
      return result;
    });
  };

  // Load pre-filled data from analysis page (via localStorage)
  useEffect(() => {
    const raw = localStorage.getItem('stz_prefill');
    if (!raw) return;
    localStorage.removeItem('stz_prefill');
    try {
      const prefill = JSON.parse(raw);
      if (prefill.period) {
        setPeriod(prefill.period);
      }
      if (prefill.name) {
        setName(prefill.name);
      }
      if (prefill.days && Array.isArray(prefill.days)) {
        const y = parseInt((prefill.period || '').slice(0, 4)) || year;
        const m = parseInt((prefill.period || '').slice(5, 7)) || month;
        const count = daysInMonth(y, m);
        const prefillMap = new Map<number, { start: string; end: string; pause: number; code: string }>();
        for (const d of prefill.days) {
          prefillMap.set(d.day, d);
        }
        const result: EditableDay[] = [];
        for (let i = 1; i <= count; i++) {
          const p = prefillMap.get(i);
          result.push(p ? { day: i, start: p.start || '', end: p.end || '', pause: p.pause || 0, code: p.code || '' } : { day: i, start: '', end: '', pause: 0, code: '' });
        }
        setDays(result);
      }
    } catch { /* ignore parse errors */ }
  }, []);

  const handleOcrUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await parseStundenzettel(file);
      const r = res.results?.[0];
      if (!r) { setError('Brak danych'); return; }
      if (r.error) { setError(r.error); return; }
      if (r.name) setName(r.name);

      // Merge OCR results into existing days
      // Handle both old format (start/end/code) and new format (start_time/end_time/notes)
      setDays(prev => {
        const ocrMap = new Map<number, any>();
        for (const d of (r.days || [])) ocrMap.set(d.day, d);
        return prev.map(existing => {
          const ocr = ocrMap.get(existing.day);
          if (!ocr) return existing;
          const startTime = ocr.start_time || ocr.start || '';
          const endTime = ocr.end_time || ocr.end || '';
          const breakMin = ocr.break_minutes ?? ocr.pause_minutes ?? 0;
          const notes = (ocr.notes || '').trim();
          // Detect code from notes or code field
          let code = ocr.code || '';
          if (!code && notes) {
            const upper = notes.toUpperCase();
            if (upper === 'FEIERTAG' || upper === 'F') code = 'F';
            else if (upper === 'KRANK' || upper === 'K') code = 'K';
            else if (upper === 'URLAUB' || upper === 'U') code = 'U';
          }
          return {
            day: existing.day,
            start: code ? '' : (startTime || ''),
            end: code ? '' : (endTime || ''),
            pause: code ? 0 : (typeof breakMin === 'number' ? breakMin : parseInt(breakMin) || 0),
            code,
          };
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, []);

  const updateDay = (idx: number, field: keyof EditableDay, value: string | number) => {
    setDays(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  };

  const clearAll = () => {
    setDays(makeEmptyDays(year, month));
    setName('');
  };

  // Calculate totals
  const totals = useMemo(() => {
    let workMin = 0, n25 = 0, n40 = 0, diets = 0, workDays = 0;
    let sick = 0, vacation = 0, holidays = 0;
    for (const d of days) {
      if (d.code === 'K') { sick++; continue; }
      if (d.code === 'U') { vacation++; continue; }
      if (d.code === 'F') { holidays++; continue; }
      if (d.code) continue;
      const c = calcDay(d, isWeekend(year, month, d.day));
      if (c.work > 0) {
        workMin += c.work; n25 += c.night25; n40 += c.night40; workDays++;
        if (c.diet) diets++;
      }
    }
    return { workMin, n25, n40, diets, workDays, sick, vacation, holidays };
  }, [days]);

  // Bulk fill state
  const [bulkStart, setBulkStart] = useState('');
  const [bulkEnd, setBulkEnd] = useState('');
  const [bulkPause, setBulkPause] = useState(0);
  const [bulkRange, setBulkRange] = useState<'month' | 'week' | 'custom'>('month');
  const [bulkWeek, setBulkWeek] = useState(1);
  const [bulkOnlyEmpty, setBulkOnlyEmpty] = useState(true);
  const [bulkSelectedDays, setBulkSelectedDays] = useState<Set<number>>(new Set());

  const toggleBulkDay = (day: number) => {
    setBulkSelectedDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  const weeksInMonth = useMemo(() => {
    const count = daysInMonth(year, month);
    const weeks: { num: number; label: string }[] = [];
    let weekStart = 1;
    for (let d = 1; d <= count; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      // End of week (Sunday) or last day of month
      if (dow === 0 || d === count) {
        weeks.push({ num: weeks.length + 1, label: `${weekStart}–${d}` });
        weekStart = d + 1;
      }
    }
    return weeks;
  }, [year, month]);

  // Map each day to its week number
  const dayToWeek = useMemo(() => {
    const map: Record<number, number> = {};
    let wk = 1;
    const count = daysInMonth(year, month);
    for (let d = 1; d <= count; d++) {
      map[d] = wk;
      if (new Date(year, month - 1, d).getDay() === 0 && d < count) wk++;
    }
    return map;
  }, [year, month]);

  const applyBulkFill = () => {
    if (!bulkStart && !bulkEnd) return;
    if (bulkRange === 'custom' && bulkSelectedDays.size === 0) return;
    setDays(prev => prev.map(d => {
      if (d.code) return d;
      if (bulkOnlyEmpty && (d.start || d.end)) return d;
      if (bulkRange === 'custom') {
        if (!bulkSelectedDays.has(d.day)) return d;
      } else {
        const dow = new Date(year, month - 1, d.day).getDay();
        if (dow === 0 || dow === 6) return d;
        if (bulkRange === 'week' && dayToWeek[d.day] !== bulkWeek) return d;
      }
      return { ...d, start: bulkStart || d.start, end: bulkEnd || d.end, pause: bulkPause };
    }));
  };

  const hasAnyData = days.some(d => d.start || d.end || d.code);

  return (
    <div className="space-y-5 animate-slide-up">
      {/* Header with period picker */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t('stzTitle')}</h1>
          <p className="text-sm text-muted mt-1">{t('stzSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={period}
            onChange={e => handlePeriodChange(e.target.value)}
            className="input rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Name + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('stzNamePlaceholder')}
          className="input rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] max-w-sm"
        />
        <label className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm cursor-pointer rounded-lg">
          <Upload size={14} />
          {t('stzOcrFill')}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={handleOcrUpload} />
        </label>
        {loading && <Spinner />}
        {hasAnyData && (
          <button onClick={clearAll} className="text-xs text-muted hover:text-red-500 flex items-center gap-1">
            <Trash2 size={13} /> {t('stzClear')}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Bulk fill */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">{t('stzBulkFill')}</span>
          <input type="time" value={bulkStart} onChange={e => setBulkStart(e.target.value)}
            placeholder={t('stzStart')} className="input rounded px-2 py-1 text-xs font-mono w-24" />
          <input type="time" value={bulkEnd} onChange={e => setBulkEnd(e.target.value)}
            placeholder={t('stzEnd')} className="input rounded px-2 py-1 text-xs font-mono w-24" />
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted">{t('stzPause')}</span>
            <input type="number" min={0} max={120} value={bulkPause || ''} placeholder="0"
              onChange={e => setBulkPause(parseInt(e.target.value) || 0)}
              className="input rounded px-2 py-1 text-xs font-mono w-14 text-center" />
          </div>
          <select value={bulkRange} onChange={e => setBulkRange(e.target.value as 'month' | 'week' | 'custom')}
            className="input rounded px-2 py-1 text-xs">
            <option value="month">{t('stzBulkWholeMonth')}</option>
            <option value="week">{t('stzBulkWeek')}</option>
            <option value="custom">{t('stzBulkCustom')}</option>
          </select>
          {bulkRange === 'week' && (
            <select value={bulkWeek} onChange={e => setBulkWeek(parseInt(e.target.value))}
              className="input rounded px-2 py-1 text-xs">
              {weeksInMonth.map(w => (
                <option key={w.num} value={w.num}>{t('stzBulkWeek')} {w.num} ({w.label})</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={bulkOnlyEmpty} onChange={e => setBulkOnlyEmpty(e.target.checked)}
              className="rounded" />
            {t('stzBulkOnlyEmpty')}
          </label>
          <button onClick={applyBulkFill} disabled={(!bulkStart && !bulkEnd) || (bulkRange === 'custom' && bulkSelectedDays.size === 0)}
            className="btn-primary px-3 py-1 text-xs rounded-lg disabled:opacity-40">
            {t('stzBulkApply')}
          </button>
        </div>
        {bulkRange === 'custom' && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {days.map(d => {
              const wd = getWeekday(year, month, d.day);
              const weekend = isWeekend(year, month, d.day);
              const selected = bulkSelectedDays.has(d.day);
              return (
                <button key={d.day} onClick={() => toggleBulkDay(d.day)}
                  className={`w-8 h-8 rounded text-[10px] font-medium border transition-colors ${
                    selected
                      ? 'bg-primary-600 text-white border-primary-600'
                      : weekend
                      ? 'bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-500'
                      : 'bg-white text-ink border-gray-300 hover:border-primary-400 dark:bg-gray-900 dark:border-gray-600'
                  }`}
                  title={`${d.day} ${wd}`}
                >
                  {d.day}
                </button>
              );
            })}
            {bulkSelectedDays.size > 0 && (
              <button onClick={() => setBulkSelectedDays(new Set())}
                className="text-[10px] text-muted hover:text-red-500 ml-1">
                {t('stzClear')}
              </button>
            )}
          </div>
        )}
      </Card>

      <ErrorBoundary>
        {/* Stats - only show when there's data */}
        {hasAnyData && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={<Clock size={20} />} label={t('stzWorkHours')} value={hm(totals.workMin)} color="primary" />
              <StatCard icon={<Moon size={20} />} label={t('stzNightHours')} value={hm(totals.n25 + totals.n40)} color="blue" />
              <StatCard icon={<UtensilsCrossed size={20} />} label={t('stzDiets')} value={totals.diets} color="green" />
              <StatCard icon={<CalendarDays size={20} />} label={t('stzWorkDays')} value={totals.workDays} color="primary" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={<Thermometer size={20} />} label={t('stzSickDays')} value={totals.sick} color="red" />
              <StatCard icon={<Palmtree size={20} />} label={t('stzVacationDays')} value={totals.vacation} color="green" />
              <StatCard icon={<Star size={20} />} label={t('stzHolidays')} value={totals.holidays} color="blue" />
              <StatCard icon={<Moon size={20} />} label="Nacht 25% / 40%" value={`${hm(totals.n25)} / ${hm(totals.n40)}`} color="blue" />
            </div>

            {/* Copy grid */}
            <StzCopyGrid days={days} year={year} month={month} totals={totals} />
          </>
        )}

        {/* Editable table - always visible */}
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-2 py-2 text-left font-semibold text-muted w-10">{t('stzDay')}</th>
                <th className="px-2 py-2 text-left font-semibold text-muted w-8"></th>
                <th className="px-1 py-2 text-center font-semibold text-muted w-24">{t('stzStart')}</th>
                <th className="px-1 py-2 text-center font-semibold text-muted w-24">{t('stzEnd')}</th>
                <th className="px-1 py-2 text-center font-semibold text-muted w-16">{t('stzPause')}</th>
                <th className="px-1 py-2 text-center font-semibold text-muted w-16">{t('stzCode')}</th>
                <th className="px-2 py-2 text-center font-semibold text-muted w-16">{t('stzWork')}</th>
                <th className="px-2 py-2 text-center font-semibold text-muted hidden sm:table-cell">{t('stzNight')}</th>
                <th className="px-2 py-2 text-center font-semibold text-muted hidden sm:table-cell">{t('stzDiet')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day, idx) => {
                const wd = getWeekday(year, month, day.day);
                const weekend = isWeekend(year, month, day.day);
                const c = calcDay(day, weekend);
                const hasCode = !!day.code;
                const rowColor = day.code ? (CODE_COLORS[day.code] || '') : weekend ? 'bg-gray-50/50 dark:bg-gray-800/20' : '';

                return (
                  <tr key={day.day} className={`border-b border-border ${rowColor}`}>
                    <td className="px-2 py-1 font-medium text-ink">{day.day}</td>
                    <td className={`px-2 py-1 text-xs ${weekend ? 'font-bold text-red-500' : 'text-muted'}`}>{wd}</td>
                    <td className="px-1 py-1">
                      <input type="time" value={day.start} onChange={e => updateDay(idx, 'start', e.target.value)}
                        disabled={hasCode} className="input w-full text-xs text-center px-1 py-0.5 rounded font-mono disabled:opacity-30" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="time" value={day.end} onChange={e => updateDay(idx, 'end', e.target.value)}
                        disabled={hasCode} className="input w-full text-xs text-center px-1 py-0.5 rounded font-mono disabled:opacity-30" />
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" min={0} max={120} value={day.pause || ''} placeholder="0"
                        onChange={e => updateDay(idx, 'pause', parseInt(e.target.value) || 0)}
                        disabled={hasCode} className="input w-full text-xs text-center px-1 py-0.5 rounded font-mono disabled:opacity-30" />
                    </td>
                    <td className="px-1 py-1">
                      <select value={day.code} onChange={e => {
                        updateDay(idx, 'code', e.target.value);
                        if (e.target.value) { updateDay(idx, 'start', ''); updateDay(idx, 'end', ''); updateDay(idx, 'pause', 0); }
                      }} className="input w-full text-xs px-1 py-0.5 rounded">
                        {CODE_OPTIONS.map(c => <option key={c} value={c}>{c || '—'}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-center font-mono text-xs font-medium">
                      {c.work > 0 ? hm(c.work) : ''}
                    </td>
                    <td className="px-2 py-1 text-center text-xs hidden sm:table-cell">
                      {(c.night25 + c.night40) > 0 && <span className="text-blue-600 dark:text-blue-400 font-medium">{hm(c.night25 + c.night40)}</span>}
                    </td>
                    <td className="px-2 py-1 text-center hidden sm:table-cell">
                      {c.diet && <Badge variant="green">D</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface font-semibold">
                <td className="px-2 py-3" colSpan={2}>{t('stzTotal')}</td>
                <td className="px-1 py-3" colSpan={4}></td>
                <td className="px-2 py-3 text-center font-mono">{hm(totals.workMin)}</td>
                <td className="px-2 py-3 text-center font-mono text-blue-600 hidden sm:table-cell">{hm(totals.n25 + totals.n40)}</td>
                <td className="px-2 py-3 text-center hidden sm:table-cell"><Badge variant="green">{totals.diets}</Badge></td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </ErrorBoundary>
    </div>
  );
}

// --- Copy Grid ---

function StzCopyGrid({ days, year, month, totals }: {
  days: EditableDay[]; year: number; month: number;
  totals: { workMin: number; n25: number; n40: number; diets: number; sick: number; vacation: number; holidays: number; workDays: number };
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const dayValues = useMemo(() => {
    return days.map(d => {
      if (d.code === 'K') return 'Kr';
      if (d.code === 'U') return 'Ur';
      if (d.code === 'F') return 'F';
      if (d.code) return d.code;
      const c = calcDay(d, isWeekend(year, month, d.day));
      return c.work > 0 ? hm(c.work) : '';
    });
  }, [days]);

  const weekdays = days.map(d => {
    try { return WEEKDAYS_SHORT[new Date(year, month - 1, d.day).getDay()]; } catch { return ''; }
  });

  const n25 = (totals.n25 / 60).toFixed(2).replace('.', ',');
  const n40 = (totals.n40 / 60).toFixed(2).replace('.', ',');
  const az = hm(totals.workMin);
  const vma = String(totals.diets);
  const ur = totals.vacation > 0 ? String(totals.vacation) : '';
  const kr = totals.sick > 0 ? String(totals.sick) : '';

  const summaryHeaders = ['25%', '40%', 'Ü', 'Ur', 'Kr', 'VMA', 'AZ'];
  const summaryValues = [n25, n40, '', ur, kr, vma, az];

  const handleCopy = useCallback(() => {
    const tsv = [...dayValues, ...summaryValues].join('\t');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [dayValues, summaryValues]);

  const thCls = 'border border-gray-300 bg-gray-200/60 px-1 py-0.5 text-center text-[10px] font-bold text-muted dark:border-gray-600 dark:bg-gray-700';
  const tdCls = 'border border-gray-300 bg-white px-1 py-0.5 text-center font-mono text-[10px] dark:border-gray-600 dark:bg-gray-900';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {String(month).padStart(2, '0')}/{year}
        </span>
        <button onClick={handleCopy}
          className="flex items-center gap-1 rounded-lg bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700 transition hover:bg-primary-200 dark:bg-primary-900/30 dark:hover:bg-primary-900/50">
          {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
          {copied ? 'OK!' : t('stzCopy')}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {days.map(d => <th key={d.day} className={thCls}>{d.day}</th>)}
              {summaryHeaders.map(h => <th key={h} className={thCls}>{h}</th>)}
            </tr>
            <tr>
              {weekdays.map((wd, i) => (
                <th key={i} className={`${thCls} ${wd === 'So' || wd === 'Sa' ? '!text-red-400 !bg-red-50 dark:!bg-red-900/20' : ''}`}>{wd}</th>
              ))}
              {summaryHeaders.map(h => <th key={`e-${h}`} className="w-1" />)}
            </tr>
          </thead>
          <tbody>
            <tr>
              {dayValues.map((val, i) => {
                let cls = tdCls;
                if (val === 'Ur') cls += ' !bg-blue-100 !text-blue-700 font-bold dark:!bg-blue-900/40';
                else if (val === 'Kr') cls += ' !bg-orange-100 !text-orange-700 font-bold dark:!bg-orange-900/40';
                else if (val === 'F') cls += ' !bg-blue-50 !text-blue-500 font-bold';
                else if (val) cls += ' font-semibold text-gray-800 dark:text-gray-200';
                return <td key={i} className={cls}>{val}</td>;
              })}
              {summaryValues.map((val, i) => <td key={i} className={`${tdCls} font-bold`}>{val}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

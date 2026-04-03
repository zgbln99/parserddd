import { useState, useCallback, useRef, useMemo, Component, type ReactNode, type ErrorInfo } from 'react';
import {
  Upload, FileText, AlertCircle, Clock, Moon, UtensilsCrossed,
  CalendarDays, Thermometer, Palmtree, Star,
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

// Editable day row type (local state)
interface EditableDay {
  day: number;
  start: string; // "HH:MM" or ""
  end: string;
  pause: number; // minutes
  code: string;  // "K","U","F","UU","SA","SU" or ""
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTH_NAMES = ['', 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const CODE_OPTIONS = ['', 'K', 'U', 'F', 'UU', 'SA', 'SU'];
const CODE_LABELS: Record<string, string> = {
  K: 'Krank', U: 'Urlaub', F: 'Feiertag', UU: 'Unbez.Url.', SA: 'Std.abw.', SU: 'Std.Url.',
};

function getWeekday(year: number, month: number, day: number): string {
  try { return WEEKDAYS[new Date(year, month - 1, day).getDay()] || ''; } catch { return ''; }
}
function isWeekend(year: number, month: number, day: number): boolean {
  try { const d = new Date(year, month - 1, day).getDay(); return d === 0 || d === 6; } catch { return false; }
}
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

// Calculate work/night/diet for a single day
function calcDay(d: EditableDay) {
  const startMin = parseTimeToMin(d.start);
  const endMin = parseTimeToMin(d.end);
  if (startMin === null || endMin === null) return { work: 0, night25: 0, night40: 0, diet: false };

  let end = endMin;
  if (end <= startMin) end += 1440; // crosses midnight

  const gross = end - startMin;
  const work = Math.max(0, gross - d.pause);

  // Night: 22-24 and 04-06 = 25%, 00-04 = 40% if started before midnight
  let night25 = 0, night40 = 0;
  for (let m = startMin; m < startMin + work && m < end; m++) {
    const h = (m % 1440) / 60 | 0;
    if (h >= 22 || (h >= 4 && h < 6)) night25++;
    else if (h >= 0 && h < 4) {
      if (startMin < 1440) night40++; else night25++;
    }
  }

  return { work, night25, night40, diet: gross >= 480 };
}

function apiDaysToEditable(days: StundenzettelDay[], maxDay: number): EditableDay[] {
  const map = new Map<number, StundenzettelDay>();
  for (const d of days) map.set(d.day, d);
  const result: EditableDay[] = [];
  for (let i = 1; i <= maxDay; i++) {
    const d = map.get(i);
    result.push({
      day: i,
      start: d?.start || '',
      end: d?.end || '',
      pause: d?.pause_minutes || 0,
      code: d?.code || '',
    });
  }
  return result;
}

function daysInMonth(year: number, month: number): number {
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

export function StundenzettelPage() {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Parsed header info
  const [name, setName] = useState('');
  const [month, setMonth] = useState(0);
  const [year, setYear] = useState(0);

  // Editable day rows
  const [days, setDays] = useState<EditableDay[]>([]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await parseStundenzettel(file);
      const r = res.results?.[0];
      if (!r) { setError('Brak danych w odpowiedzi'); return; }
      if (r.error) { setError(r.error); return; }
      setName(r.name || '');
      setMonth(r.month || 0);
      setYear(r.year || 0);
      const maxDay = daysInMonth(r.year, r.month);
      setDays(apiDaysToEditable(r.days || [], maxDay));
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

  // Calculate totals from editable data
  const totals = useMemo(() => {
    let workMin = 0, n25 = 0, n40 = 0, diets = 0, workDays = 0;
    let sick = 0, vacation = 0, holidays = 0;
    for (const d of days) {
      if (d.code === 'K') { sick++; continue; }
      if (d.code === 'U') { vacation++; continue; }
      if (d.code === 'F') { holidays++; continue; }
      if (d.code) continue;
      const c = calcDay(d);
      if (c.work > 0) {
        workMin += c.work;
        n25 += c.night25;
        n40 += c.night40;
        workDays++;
        if (c.diet) diets++;
      }
    }
    return { workMin, n25, n40, diets, workDays, sick, vacation, holidays };
  }, [days]);

  const hasDays = days.length > 0;

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t('stzTitle')}</h1>
          <p className="text-sm text-muted mt-1">{t('stzSubtitle')}</p>
        </div>
      </div>

      {/* Upload */}
      <Card className="p-6">
        <div className="flex flex-col items-center gap-4">
          <label className="btn-primary inline-flex items-center gap-2 px-6 py-3 text-sm cursor-pointer rounded-xl font-medium">
            <Upload size={18} />
            {t('stzUpload')}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={handleUpload} />
          </label>
          <p className="text-xs text-muted">{t('stzFormats')}</p>
          {loading && (
            <div className="flex items-center gap-3 text-sm text-muted">
              <Spinner />
              {t('stzParsing')}
            </div>
          )}
        </div>
      </Card>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {hasDays && (
        <ErrorBoundary>
          {/* Header */}
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <FileText size={20} className="text-primary-500" />
              <div>
                <h2 className="text-lg font-bold text-ink">{name || 'Unbekannt'}</h2>
                <p className="text-sm text-muted">
                  {month > 0 ? MONTH_NAMES[month] : ''} {year || ''}
                </p>
              </div>
            </div>
          </Card>

          {/* Stats */}
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

          {/* Editable table */}
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="px-2 py-2 text-left font-semibold text-muted w-10">{t('stzDay')}</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted w-8"></th>
                  <th className="px-1 py-2 text-center font-semibold text-muted w-20">{t('stzStart')}</th>
                  <th className="px-1 py-2 text-center font-semibold text-muted w-20">{t('stzEnd')}</th>
                  <th className="px-1 py-2 text-center font-semibold text-muted w-16">{t('stzPause')}</th>
                  <th className="px-1 py-2 text-center font-semibold text-muted w-16">{t('stzCode')}</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted">{t('stzWork')}</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted hidden sm:table-cell">{t('stzNight')}</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted hidden sm:table-cell">{t('stzDiet')}</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day, idx) => {
                  const wd = getWeekday(year, month, day.day);
                  const weekend = isWeekend(year, month, day.day);
                  const c = calcDay(day);
                  const hasCode = !!day.code;

                  return (
                    <tr
                      key={day.day}
                      className={`border-b border-border ${
                        weekend ? 'bg-gray-50/50 dark:bg-gray-800/20' :
                        day.code === 'F' ? 'bg-blue-50/30 dark:bg-blue-900/10' :
                        day.code === 'K' ? 'bg-red-50/30 dark:bg-red-900/10' :
                        day.code === 'U' ? 'bg-emerald-50/30 dark:bg-emerald-900/10' :
                        ''
                      }`}
                    >
                      <td className="px-2 py-1 font-medium text-ink">{day.day}</td>
                      <td className={`px-2 py-1 text-xs ${weekend ? 'font-semibold text-red-500' : 'text-muted'}`}>{wd}</td>
                      <td className="px-1 py-1">
                        <input
                          type="time"
                          value={day.start}
                          onChange={e => updateDay(idx, 'start', e.target.value)}
                          disabled={hasCode}
                          className="input w-full text-xs text-center px-1 py-0.5 rounded font-mono disabled:opacity-40"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="time"
                          value={day.end}
                          onChange={e => updateDay(idx, 'end', e.target.value)}
                          disabled={hasCode}
                          className="input w-full text-xs text-center px-1 py-0.5 rounded font-mono disabled:opacity-40"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          min={0}
                          max={120}
                          value={day.pause || ''}
                          onChange={e => updateDay(idx, 'pause', parseInt(e.target.value) || 0)}
                          disabled={hasCode}
                          placeholder="0"
                          className="input w-full text-xs text-center px-1 py-0.5 rounded font-mono disabled:opacity-40"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <select
                          value={day.code}
                          onChange={e => {
                            const code = e.target.value;
                            updateDay(idx, 'code', code);
                            if (code) {
                              updateDay(idx, 'start', '');
                              updateDay(idx, 'end', '');
                              updateDay(idx, 'pause', 0);
                            }
                          }}
                          className="input w-full text-xs px-1 py-0.5 rounded"
                        >
                          {CODE_OPTIONS.map(c => (
                            <option key={c} value={c}>{c ? `${c}` : '—'}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-center font-mono text-xs font-medium">
                        {c.work > 0 ? hm(c.work) : ''}
                      </td>
                      <td className="px-2 py-1 text-center text-xs hidden sm:table-cell">
                        {(c.night25 + c.night40) > 0 ? (
                          <span className="text-blue-600 dark:text-blue-400 font-medium">{hm(c.night25 + c.night40)}</span>
                        ) : ''}
                      </td>
                      <td className="px-2 py-1 text-center hidden sm:table-cell">
                        {c.diet ? <Badge variant="green">D</Badge> : ''}
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
                  <td className="px-2 py-3 text-center hidden sm:table-cell">
                    <Badge variant="green">{totals.diets}</Badge>
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>
        </ErrorBoundary>
      )}
    </div>
  );
}

import { useState, useCallback, useRef, Component, type ReactNode, type ErrorInfo } from 'react';
import {
  Upload, FileText, AlertCircle, Clock, Moon, UtensilsCrossed,
  CalendarDays, Thermometer, Palmtree, Star, ChevronDown, ChevronUp,
} from 'lucide-react';

// Error boundary to catch render crashes and show error instead of white screen
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
import { useI18n } from '../i18n';
import { parseStundenzettel, type StundenzettelResult } from '../lib/api';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';

const CODE_LABELS: Record<string, { label: string; color: string }> = {
  K: { label: 'Krank', color: 'text-red-600 dark:text-red-400' },
  U: { label: 'Urlaub', color: 'text-emerald-600 dark:text-emerald-400' },
  UU: { label: 'Unbez. Urlaub', color: 'text-amber-600 dark:text-amber-400' },
  F: { label: 'Feiertag', color: 'text-blue-600 dark:text-blue-400' },
  SA: { label: 'Std. abwesend', color: 'text-gray-500' },
  SU: { label: 'Std. Urlaub', color: 'text-gray-500' },
};

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function getWeekday(year: number, month: number, day: number): string {
  try {
    if (!year || !month || !day) return '';
    const d = new Date(year, month - 1, day);
    return WEEKDAYS[d.getDay()] || '';
  } catch { return ''; }
}

function isWeekend(year: number, month: number, day: number): boolean {
  try {
    if (!year || !month || !day) return false;
    const d = new Date(year, month - 1, day);
    return d.getDay() === 0 || d.getDay() === 6;
  } catch { return false; }
}

function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

const MONTH_NAMES = [
  '', 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export function StundenzettelPage() {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<StundenzettelResult[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    setResults([]);
    try {
      const res = await parseStundenzettel(file);
      console.log('Stundenzettel API response:', JSON.stringify(res, null, 2));
      setResults(res.results || []);
      if (res.results.length === 1) setExpandedIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, []);

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
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
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={handleUpload}
            />
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

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Results */}
      {results.map((result, idx) => (
        <ErrorBoundary key={idx}>
          <ResultCard
            result={result}
            expanded={expandedIdx === idx}
            onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            showToggle={results.length > 1}
          />
        </ErrorBoundary>
      ))}
    </div>
  );
}

function ResultCard({
  result,
  expanded,
  onToggle,
  showToggle,
}: {
  result: StundenzettelResult;
  expanded: boolean;
  onToggle: () => void;
  showToggle: boolean;
}) {
  if (result.error || !result.totals) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle size={16} />
          {result.error || 'Brak danych'}
        </div>
      </Card>
    );
  }

  const totals = result.totals;
  const days = result.days || [];
  const totalNight = totals.total_night_minutes || 0;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <Card className="p-4">
        <div
          className={`flex items-center justify-between ${showToggle ? 'cursor-pointer' : ''}`}
          onClick={showToggle ? onToggle : undefined}
        >
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-primary-500" />
            <div>
              <h2 className="text-lg font-bold text-ink">{result.name || 'Unbekannt'}</h2>
              <p className="text-sm text-muted">
                {MONTH_NAMES[result.month]} {result.year}
                {result.personal_nr && ` · Pers.Nr. ${result.personal_nr}`}
              </p>
            </div>
          </div>
          {showToggle && (expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />)}
        </div>
      </Card>

      {/* Stats */}
      {(!showToggle || expanded) && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<Clock size={20} />} label={t('stzWorkHours')} value={totals.work_hm || '0:00'} color="primary" />
            <StatCard icon={<Moon size={20} />} label={t('stzNightHours')} value={hm(totalNight)} color="blue" />
            <StatCard icon={<UtensilsCrossed size={20} />} label={t('stzDiets')} value={totals.diet_count || 0} color="green" />
            <StatCard icon={<CalendarDays size={20} />} label={t('stzWorkDays')} value={totals.work_days || 0} color="primary" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<Thermometer size={20} />} label={t('stzSickDays')} value={totals.sick_days || 0} color="red" />
            <StatCard icon={<Palmtree size={20} />} label={t('stzVacationDays')} value={totals.vacation_days || 0} color="green" />
            <StatCard icon={<Star size={20} />} label={t('stzHolidays')} value={totals.holiday_days || 0} color="blue" />
            <StatCard
              icon={<Moon size={20} />}
              label="Nacht 25% / 40%"
              value={`${totals.night_25_hm || '0:00'} / ${totals.night_40_hm || '0:00'}`}
              color="blue"
            />
          </div>

          {/* Day table */}
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="px-3 py-2 text-left font-semibold text-muted w-12">{t('stzDay')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted w-10"></th>
                  <th className="px-3 py-2 text-center font-semibold text-muted">{t('stzStart')}</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted">{t('stzEnd')}</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted">{t('stzPause')}</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted">{t('stzWork')}</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted hidden sm:table-cell">{t('stzNight')}</th>
                  <th className="px-3 py-2 text-center font-semibold text-muted hidden sm:table-cell">{t('stzDiet')}</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted hidden md:table-cell">{t('stzCode')}</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => {
                  const wd = getWeekday(result.year, result.month, day.day);
                  const weekend = isWeekend(result.year, result.month, day.day);
                  const codeInfo = day.code ? CODE_LABELS[day.code] : null;
                  const nightTotal = (day.night_25_minutes || 0) + (day.night_40_minutes || 0);
                  const isEmpty = !day.start && !day.end && !day.code;

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
                      <td className="px-3 py-2 font-medium text-ink">{day.day}</td>
                      <td className={`px-3 py-2 text-xs ${weekend ? 'font-semibold text-red-500' : 'text-muted'}`}>{wd}</td>
                      <td className="px-3 py-2 text-center font-mono text-xs">
                        {day.start || (isEmpty ? '' : '—')}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-xs">
                        {day.end || (isEmpty ? '' : '—')}
                      </td>
                      <td className="px-3 py-2 text-center text-xs text-muted">
                        {day.pause_minutes > 0 ? `${day.pause_minutes}m` : isEmpty ? '' : '—'}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-xs font-medium">
                        {day.work_minutes > 0 ? hm(day.work_minutes) : ''}
                      </td>
                      <td className="px-3 py-2 text-center text-xs hidden sm:table-cell">
                        {nightTotal > 0 ? (
                          <span className="text-blue-600 dark:text-blue-400 font-medium">{hm(nightTotal)}</span>
                        ) : ''}
                      </td>
                      <td className="px-3 py-2 text-center hidden sm:table-cell">
                        {day.has_diet ? (
                          <Badge variant="green">D</Badge>
                        ) : ''}
                      </td>
                      <td className="px-3 py-2 text-left hidden md:table-cell">
                        {codeInfo ? (
                          <span className={`text-xs font-medium ${codeInfo.color}`}>
                            {day.code} - {codeInfo.label}
                          </span>
                        ) : day.remarks ? (
                          <span className="text-xs text-muted">{day.remarks}</span>
                        ) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface font-semibold">
                  <td className="px-3 py-3" colSpan={2}>{t('stzTotal')}</td>
                  <td className="px-3 py-3" colSpan={2}></td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 text-center font-mono">{totals.work_hm || '0:00'}</td>
                  <td className="px-3 py-3 text-center font-mono text-blue-600 hidden sm:table-cell">{hm(totalNight)}</td>
                  <td className="px-3 py-3 text-center hidden sm:table-cell">
                    <Badge variant="green">{totals.diet_count}</Badge>
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell"></td>
                </tr>
              </tfoot>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

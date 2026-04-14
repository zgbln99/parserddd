import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, AlertCircle, Users, Calendar, Clock,
  Car, Wrench, Coffee, Timer, HelpCircle, Printer,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchDrivers, analyzeDropboxFile } from '../lib/api';
import type { Driver, AnalysisResult, ShiftDetail } from '../types';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { minutesToHm } from '../lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Activity {
  start: string;
  end: string;
  duration_minutes: number;
  type: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TYPE_CONFIG: Record<string, { bg: string; bgLight: string; text: string; label: string; labelPl: string; icon: typeof Car }> = {
  DRIVING:      { bg: 'bg-emerald-500', bgLight: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-400', label: 'Lenkzeit',     labelPl: 'Jazda',        icon: Car },
  WORK:         { bg: 'bg-blue-500',    bgLight: 'bg-blue-50 dark:bg-blue-900/20',       text: 'text-blue-700 dark:text-blue-400',       label: 'Arbeitszeit',  labelPl: 'Praca',        icon: Wrench },
  REST:         { bg: 'bg-amber-400',   bgLight: 'bg-amber-50 dark:bg-amber-900/20',     text: 'text-amber-700 dark:text-amber-400',     label: 'Ruhezeit',     labelPl: 'Odpoczynek',   icon: Coffee },
  AVAILABILITY: { bg: 'bg-gray-400',    bgLight: 'bg-gray-50 dark:bg-gray-800/40',       text: 'text-gray-600 dark:text-gray-400',       label: 'Bereitschaft', labelPl: 'Dyspozycyjność', icon: Timer },
  UNKNOWN:      { bg: 'bg-gray-200',    bgLight: 'bg-gray-50 dark:bg-gray-800/40',       text: 'text-gray-400',                          label: 'Unbekannt',    labelPl: 'Nieznany',     icon: HelpCircle },
};

const WEEKDAYS_DE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const WEEKDAYS_PL = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
const WEEKDAYS_SHORT_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WEEKDAYS_SHORT_PL = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtHm(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

function fmtTime(s: string) {
  return s?.slice(11, 16) || '';
}

function fmtDate(s: string) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

/** Get Monday of the ISO week containing the given date */
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Format Date to YYYY-MM-DD */
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Get ISO week number */
function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Get 7 days starting from Monday */
function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Day timeline row — Samsara-style colored bar */
function DayTimeline({
  date,
  weekdayLabel,
  activities,
  locale,
  expanded,
  onToggle,
}: {
  date: string;
  weekdayLabel: string;
  activities: Activity[];
  locale: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalMin = activities.reduce((s, a) => s + a.duration_minutes, 0);
  const summary: Record<string, number> = {};
  for (const a of activities) {
    summary[a.type] = (summary[a.type] || 0) + a.duration_minutes;
  }

  if (activities.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card p-3 opacity-60">
        <div className="w-20 shrink-0">
          <p className="text-xs font-bold text-ink">{weekdayLabel}</p>
          <p className="text-[11px] text-muted">{fmtDate(date)}</p>
        </div>
        <div className="flex-1">
          <div className="flex h-7 w-full items-center rounded-lg bg-gray-100 dark:bg-gray-800 px-3">
            <span className="text-xs text-muted">{locale === 'de' ? 'Kein Dienst' : 'Brak służby'}</span>
          </div>
        </div>
        <div className="w-16 text-right text-xs text-muted">—</div>
      </div>
    );
  }

  // Find earliest start / latest end for the axis
  const firstStart = activities[0]?.start || '';
  const lastEnd = activities[activities.length - 1]?.end || '';

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden transition-shadow hover:shadow-md">
      {/* Clickable header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-surface/50"
      >
        {/* Day label */}
        <div className="w-20 shrink-0">
          <p className="text-xs font-bold text-ink">{weekdayLabel}</p>
          <p className="text-[11px] text-muted">{fmtDate(date)}</p>
        </div>

        {/* Timeline bar */}
        <div className="flex-1 min-w-0">
          <div className="flex h-7 w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
            {activities.map((a, i) => {
              const pct = Math.max(0.5, (a.duration_minutes / totalMin) * 100);
              const cfg = TYPE_CONFIG[a.type] || TYPE_CONFIG.UNKNOWN;
              return (
                <div
                  key={i}
                  className={`${cfg.bg} relative transition-all hover:opacity-80`}
                  style={{ width: `${pct}%` }}
                  title={`${locale === 'de' ? cfg.label : cfg.labelPl}: ${fmtTime(a.start)} – ${fmtTime(a.end)} (${a.duration_minutes}min)`}
                />
              );
            })}
          </div>
          {/* Time labels */}
          <div className="mt-0.5 flex justify-between text-[9px] text-muted">
            <span>{fmtTime(firstStart)}</span>
            <span>{fmtTime(lastEnd)}</span>
          </div>
        </div>

        {/* Total duration */}
        <div className="w-16 shrink-0 text-right">
          <p className="text-xs font-bold text-ink">{fmtHm(totalMin)}</p>
        </div>

        <ChevronRight
          size={14}
          className={`text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/50 px-3 pb-3 animate-slide-up">
          {/* Mini summary chips */}
          <div className="flex flex-wrap gap-1.5 py-2.5">
            {(['DRIVING', 'WORK', 'REST', 'AVAILABILITY'] as const).map(type => {
              const cfg = TYPE_CONFIG[type];
              const min = summary[type] || 0;
              if (min === 0) return null;
              return (
                <span key={type} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cfg.bgLight} ${cfg.text}`}>
                  <span className={`h-2 w-2 rounded-full ${cfg.bg}`} />
                  {locale === 'de' ? cfg.label : cfg.labelPl}: {fmtHm(min)}
                </span>
              );
            })}
          </div>

          {/* Activity table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {locale === 'de' ? 'Zeit' : 'Czas'}
                  </th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {locale === 'de' ? 'Dauer' : 'Czas trwania'}
                  </th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {locale === 'de' ? 'Aktivität' : 'Aktywność'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {activities.map((a, i) => {
                  const cfg = TYPE_CONFIG[a.type] || TYPE_CONFIG.UNKNOWN;
                  return (
                    <tr key={i} className="hover:bg-surface/50 transition">
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span className="font-medium text-ink">{fmtTime(a.start)}</span>
                        <span className="text-muted mx-1">–</span>
                        <span className="text-muted">{fmtTime(a.end)}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-medium text-ink">
                        {a.duration_minutes} min
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className={`h-2.5 w-2.5 rounded-full ${cfg.bg}`} />
                          <span className={`text-xs font-semibold ${cfg.text}`}>
                            {locale === 'de' ? cfg.label : cfg.labelPl}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Weekly summary card */
function WeeklySummary({ shifts, locale }: { shifts: ShiftDetail[]; locale: string }) {
  const totals = useMemo(() => {
    let driving = 0, work = 0, rest = 0, avail = 0, total = 0;
    for (const sh of shifts) {
      driving += sh.driving_minutes || 0;
      work += sh.work_minutes || 0;
      rest += sh.break_minutes || 0;
      avail += sh.avail_minutes || 0;
      total += sh.duration_minutes || 0;
    }
    return { driving, work, rest, avail, total, shifts: shifts.length };
  }, [shifts]);

  const items = [
    { key: 'DRIVING', min: totals.driving, icon: Car },
    { key: 'WORK', min: totals.work, icon: Wrench },
    { key: 'REST', min: totals.rest, icon: Coffee },
    { key: 'AVAILABILITY', min: totals.avail, icon: Timer },
  ] as const;

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <h3 className="mb-3 text-sm font-bold text-ink">
        {locale === 'de' ? 'Wochenzusammenfassung' : 'Podsumowanie tygodnia'}
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {items.map(({ key, min, icon: Icon }) => {
          const cfg = TYPE_CONFIG[key];
          return (
            <div key={key} className={`flex items-center gap-2.5 rounded-xl p-3 ${cfg.bgLight}`}>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${cfg.bg} text-white`}>
                <Icon size={14} />
              </div>
              <div>
                <p className={`text-[10px] font-semibold uppercase tracking-wider ${cfg.text}`}>
                  {locale === 'de' ? cfg.label : cfg.labelPl}
                </p>
                <p className="text-sm font-bold text-ink">{fmtHm(min)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Total bar */}
      <div className="flex items-center justify-between rounded-xl bg-surface p-3">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-primary-500" />
          <span className="text-sm font-semibold text-ink">
            {locale === 'de' ? 'Gesamtzeit' : 'Czas całkowity'}
          </span>
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-ink">{fmtHm(totals.total)}</span>
          <span className="ml-2 text-xs text-muted">
            ({totals.shifts} {locale === 'de' ? 'Schichten' : 'zmian'})
          </span>
        </div>
      </div>

      {/* Proportional bar */}
      {totals.total > 0 && (
        <div className="mt-3">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            {items.map(({ key, min }) => {
              if (min === 0) return null;
              const pct = (min / totals.total) * 100;
              const cfg = TYPE_CONFIG[key];
              return (
                <div
                  key={key}
                  className={`${cfg.bg} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${locale === 'de' ? cfg.label : cfg.labelPl}: ${Math.round(pct)}%`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted">
            {items.map(({ key, min }) => {
              if (min === 0) return null;
              const cfg = TYPE_CONFIG[key];
              const pct = Math.round((min / totals.total) * 100);
              return (
                <span key={key} className="flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${cfg.bg}`} />
                  {locale === 'de' ? cfg.label : cfg.labelPl} {pct}%
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function ArbeitszeitberichtPage() {
  const { t, locale } = useI18n();

  // Driver list
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [selectedDriverIdx, setSelectedDriverIdx] = useState<number>(-1);

  // Week picker
  const [weekMonday, setWeekMonday] = useState<Date>(() => {
    const now = new Date();
    return getMonday(now);
  });

  // Analysis
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Expanded days
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // Load drivers on mount
  useEffect(() => {
    fetchDrivers()
      .then((data) => {
        const withFiles = data.drivers.filter((d) => d.files.length > 0);
        setDrivers(withFiles);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingDrivers(false));
  }, []);

  // Selected driver
  const selectedDriver = selectedDriverIdx >= 0 ? drivers[selectedDriverIdx] : null;

  // Analyze when driver changes
  const runAnalysis = useCallback(async (driver: Driver) => {
    const latestFile = driver.files[0];
    if (!latestFile?.path) {
      setError(locale === 'de' ? 'Keine Dateien vorhanden' : 'Brak plików');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await analyzeDropboxFile(latestFile.path);
      setAnalysisData(result);
    } catch (e: any) {
      setError(e.message);
      setAnalysisData(null);
    } finally {
      setLoading(false);
    }
  }, [locale]);

  const handleDriverChange = useCallback((idx: number) => {
    setSelectedDriverIdx(idx);
    setExpandedDays(new Set());
    if (idx >= 0 && drivers[idx]) {
      runAnalysis(drivers[idx]);
    } else {
      setAnalysisData(null);
    }
  }, [drivers, runAnalysis]);

  // Week navigation
  const prevWeek = () => {
    setWeekMonday((m) => {
      const d = new Date(m);
      d.setDate(d.getDate() - 7);
      return d;
    });
    setExpandedDays(new Set());
  };
  const nextWeek = () => {
    setWeekMonday((m) => {
      const d = new Date(m);
      d.setDate(d.getDate() + 7);
      return d;
    });
    setExpandedDays(new Set());
  };
  const goToCurrentWeek = () => {
    setWeekMonday(getMonday(new Date()));
    setExpandedDays(new Set());
  };

  // Week range
  const weekDays = useMemo(() => getWeekDays(weekMonday), [weekMonday]);
  const weekSunday = weekDays[6];
  const weekNumber = getISOWeek(weekMonday);
  const weekdayNames = locale === 'de' ? WEEKDAYS_DE : WEEKDAYS_PL;
  const weekdayShortNames = locale === 'de' ? WEEKDAYS_SHORT_DE : WEEKDAYS_SHORT_PL;

  // Filter shifts for selected week
  const weekShifts = useMemo(() => {
    if (!analysisData?.shift_details) return [];
    const mondayStr = toISO(weekMonday);
    const sundayStr = toISO(weekSunday);
    return analysisData.shift_details.filter((sh) => {
      const d = sh.shift_date || sh.grid_date;
      return d >= mondayStr && d <= sundayStr;
    });
  }, [analysisData, weekMonday, weekSunday]);

  // Map shifts by date with activity_timeline
  const dayData = useMemo(() => {
    const map = new Map<string, { shift: ShiftDetail; activities: Activity[] }>();
    for (const sh of weekShifts) {
      const dateKey = sh.shift_date || sh.grid_date;
      const activities: Activity[] = (sh as any).activity_timeline || [];
      map.set(dateKey, { shift: sh, activities });
    }
    return map;
  }, [weekShifts]);

  const toggleDay = (date: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const expandAll = () => {
    const allDates = weekDays.map(d => toISO(d)).filter(d => dayData.has(d));
    setExpandedDays(new Set(allDates));
  };
  const collapseAll = () => setExpandedDays(new Set());

  // Print handler
  const handlePrint = () => window.print();

  return (
    <div className="animate-slide-up space-y-6 print:space-y-4">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {locale === 'de' ? 'Arbeitszeitbericht' : 'Raport czasu pracy'}
          </h1>
          <p className="text-sm text-muted">
            {locale === 'de'
              ? 'Wochenübersicht der Fahreraktivitäten'
              : 'Tygodniowy przegląd aktywności kierowcy'}
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted transition hover:bg-surface hover:text-ink print:hidden"
        >
          <Printer size={16} />
          {locale === 'de' ? 'Drucken' : 'Drukuj'}
        </button>
      </div>

      {/* Controls row */}
      <Card className="p-4 print:shadow-none print:border-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          {/* Driver selector */}
          <div className="flex-1 min-w-0">
            <label className="mb-1.5 block text-xs font-semibold text-muted uppercase tracking-wider">
              <Users size={12} className="inline mr-1" />
              {locale === 'de' ? 'Fahrer' : 'Kierowca'}
            </label>
            {loadingDrivers ? (
              <div className="flex items-center gap-2 h-10">
                <Spinner size="sm" />
                <span className="text-sm text-muted">{t('loading')}</span>
              </div>
            ) : (
              <select
                value={selectedDriverIdx}
                onChange={(e) => handleDriverChange(Number(e.target.value))}
                className="input w-full rounded-xl px-3 py-2.5 text-sm"
              >
                <option value={-1}>
                  {locale === 'de' ? '— Fahrer auswählen —' : '— Wybierz kierowcę —'}
                </option>
                {drivers.map((d, i) => (
                  <option key={d.card_number || i} value={i}>
                    {d.name} {d.card_number ? `(${d.card_number.slice(-4)})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Week picker */}
          <div className="shrink-0">
            <label className="mb-1.5 block text-xs font-semibold text-muted uppercase tracking-wider">
              <Calendar size={12} className="inline mr-1" />
              {locale === 'de' ? 'Kalenderwoche' : 'Tydzień'}
            </label>
            <div className="flex items-center gap-1">
              <button
                onClick={prevWeek}
                className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-ink"
                title={locale === 'de' ? 'Vorherige Woche' : 'Poprzedni tydzień'}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={goToCurrentWeek}
                className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface min-w-[220px] text-center"
              >
                <span className="font-bold">KW {weekNumber}</span>
                <span className="mx-1.5 text-muted">|</span>
                <span className="text-muted">
                  {fmtDate(toISO(weekMonday))} – {fmtDate(toISO(weekSunday))}
                </span>
              </button>
              <button
                onClick={nextWeek}
                className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-ink"
                title={locale === 'de' ? 'Nächste Woche' : 'Następny tydzień'}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Loading state */}
      {loading && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-muted">
            <Spinner size="lg" />
            <p className="text-sm font-medium">
              {locale === 'de' ? 'Daten werden geladen...' : 'Ładowanie danych...'}
            </p>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="py-8">
          <div className="flex flex-col items-center gap-2 text-danger">
            <AlertCircle size={28} />
            <p className="text-sm">{error}</p>
          </div>
        </Card>
      )}

      {/* No driver selected */}
      {!loading && !error && !selectedDriver && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-muted">
            <Users size={32} className="opacity-40" />
            <p className="text-sm">
              {locale === 'de'
                ? 'Fahrer auswählen, um den Bericht anzuzeigen'
                : 'Wybierz kierowcę, aby wyświetlić raport'}
            </p>
          </div>
        </Card>
      )}

      {/* Report content */}
      {!loading && !error && selectedDriver && analysisData && (
        <>
          {/* Driver info bar */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-primary-600 to-primary-500 px-5 py-3 text-white shadow-lg shadow-primary-600/20 print:bg-gray-100 print:text-ink print:shadow-none">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 print:bg-gray-200">
              <Users size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold truncate">
                {analysisData.driver_info?.driver_name || selectedDriver.name}
              </p>
              <p className="text-xs opacity-80">
                {locale === 'de' ? 'Kartennr.' : 'Nr karty'}: {analysisData.driver_info?.card_number || selectedDriver.card_number}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">KW {weekNumber}</p>
              <p className="text-xs opacity-80">{toISO(weekMonday).slice(0, 4)}</p>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 print:gap-2">
            {(['DRIVING', 'WORK', 'REST', 'AVAILABILITY'] as const).map(type => {
              const cfg = TYPE_CONFIG[type];
              return (
                <span key={type} className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <span className={`h-3 w-3 rounded-sm ${cfg.bg}`} />
                  {locale === 'de' ? cfg.label : cfg.labelPl}
                </span>
              );
            })}
          </div>

          {/* Expand/collapse controls */}
          {weekShifts.length > 0 && (
            <div className="flex gap-2 print:hidden">
              <button
                onClick={expandAll}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-surface hover:text-ink"
              >
                {locale === 'de' ? 'Alle aufklappen' : 'Rozwiń wszystkie'}
              </button>
              <button
                onClick={collapseAll}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-surface hover:text-ink"
              >
                {locale === 'de' ? 'Alle zuklappen' : 'Zwiń wszystkie'}
              </button>
            </div>
          )}

          {/* Day timelines */}
          <div className="space-y-2">
            {weekDays.map((d, i) => {
              const dateStr = toISO(d);
              const dd = dayData.get(dateStr);
              return (
                <DayTimeline
                  key={dateStr}
                  date={dateStr}
                  weekdayLabel={weekdayNames[i]}
                  activities={dd?.activities || []}
                  locale={locale}
                  expanded={expandedDays.has(dateStr)}
                  onToggle={() => toggleDay(dateStr)}
                />
              );
            })}
          </div>

          {/* Weekly summary */}
          {weekShifts.length > 0 ? (
            <WeeklySummary shifts={weekShifts} locale={locale} />
          ) : (
            <Card className="py-10">
              <p className="text-center text-sm text-muted">
                {locale === 'de'
                  ? 'Keine Schichten in dieser Woche'
                  : 'Brak zmian w tym tygodniu'}
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

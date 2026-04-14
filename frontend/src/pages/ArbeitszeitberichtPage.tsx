import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, AlertCircle, Users, Calendar,
  Clock, Printer,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchDrivers, analyzeDropboxFile } from '../lib/api';
import type { Driver, AnalysisResult, ShiftDetail } from '../types';
import { Spinner } from '../components/Spinner';

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
// Samsara color scheme — DRIVING=green, WORK=orange, REST=blue, AVAIL=gray
// ---------------------------------------------------------------------------
const TYPE_COLORS: Record<string, { color: string; label: string; labelPl: string; labelDe: string }> = {
  DRIVING:      { color: '#4ade80', label: 'W trakcie jazdy', labelPl: 'W trakcie jazdy', labelDe: 'Lenkzeit' },
  WORK:         { color: '#f59e0b', label: 'Pracujący',       labelPl: 'Pracujący',       labelDe: 'Arbeitszeit' },
  REST:         { color: '#3b82f6', label: 'Odpoczywający',   labelPl: 'Odpoczywający',   labelDe: 'Ruhezeit' },
  AVAILABILITY: { color: '#9ca3af', label: 'Dostępny',        labelPl: 'Dostępny',        labelDe: 'Bereitschaft' },
  UNKNOWN:      { color: '#e5e7eb', label: 'Nieznany',        labelPl: 'Nieznany',        labelDe: 'Unbekannt' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtHm(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

function fmtTime(s: string) {
  return s?.slice(11, 16) || '';
}

/** Parse "YYYY-MM-DD HH:MM" → total minutes from midnight */
function timeToMin(s: string): number {
  const h = parseInt(s.slice(11, 13) || '0', 10);
  const m = parseInt(s.slice(14, 16) || '0', 10);
  return h * 60 + m;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Short Polish date: "13 kwi" */
const MONTHS_SHORT_PL = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MONTHS_SHORT_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTHS_FULL_PL = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_FULL_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function fmtShortDate(iso: string, locale: string) {
  const d = parseInt(iso.slice(8, 10), 10);
  const m = parseInt(iso.slice(5, 7), 10) - 1;
  const months = locale === 'de' ? MONTHS_SHORT_DE : MONTHS_SHORT_PL;
  return `${d} ${months[m]}`;
}

function fmtDDMM(iso: string) {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

const CAL_DAYS_PL = ['ndz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
const CAL_DAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

// ---------------------------------------------------------------------------
// TimeAxisTimeline — the Samsara-style horizontal bar with hour markers
// ---------------------------------------------------------------------------
function TimeAxisTimeline({ activities, shiftStart, shiftEnd }: {
  activities: Activity[];
  shiftStart: string; // "YYYY-MM-DD HH:MM"
  shiftEnd: string;
}) {
  const startMin = timeToMin(shiftStart);
  let endMin = timeToMin(shiftEnd);
  // Handle overnight shifts
  if (endMin <= startMin) endMin += 24 * 60;
  const totalSpan = endMin - startMin || 1;

  // Hour markers — every full hour within range
  const firstHour = Math.ceil(startMin / 60);
  const lastHour = Math.floor(endMin / 60);
  const hours: number[] = [];
  for (let h = firstHour; h <= lastHour; h++) hours.push(h);

  return (
    <div className="w-full">
      {/* Timeline bar */}
      <div className="relative h-[52px] w-full bg-gray-50 dark:bg-gray-800/50">
        {/* Activity blocks */}
        {activities.map((a, i) => {
          let aStart = timeToMin(a.start);
          let aEnd = timeToMin(a.end);
          if (aStart < startMin && aEnd <= startMin) { aStart += 24 * 60; aEnd += 24 * 60; }
          if (aEnd <= aStart) aEnd += 24 * 60;
          const left = ((aStart - startMin) / totalSpan) * 100;
          const width = ((aEnd - aStart) / totalSpan) * 100;
          const cfg = TYPE_COLORS[a.type] || TYPE_COLORS.UNKNOWN;
          return (
            <div
              key={i}
              className="absolute top-0 h-full transition-opacity hover:opacity-80"
              style={{
                left: `${Math.max(0, left)}%`,
                width: `${Math.min(width, 100 - left)}%`,
                backgroundColor: cfg.color,
              }}
              title={`${cfg.label}: ${fmtTime(a.start)} – ${fmtTime(a.end)} (${a.duration_minutes} min)`}
            />
          );
        })}
        {/* Hour grid lines */}
        {hours.map(h => {
          const pos = ((h * 60 - startMin) / totalSpan) * 100;
          if (pos <= 0 || pos >= 100) return null;
          return (
            <div
              key={h}
              className="absolute top-0 h-full border-l border-white/30 dark:border-gray-600/40"
              style={{ left: `${pos}%` }}
            />
          );
        })}
      </div>
      {/* Hour labels */}
      <div className="relative h-5 w-full">
        {/* Start label */}
        <span className="absolute left-0 top-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {shiftStart.slice(0, 10).split('-').reverse().join('.')}
        </span>
        {hours.map(h => {
          const pos = ((h * 60 - startMin) / totalSpan) * 100;
          if (pos < 5 || pos > 97) return null;
          return (
            <span
              key={h}
              className="absolute top-0.5 -translate-x-1/2 text-[11px] text-gray-500 dark:text-gray-400"
              style={{ left: `${pos}%` }}
            >
              {String(h % 24).padStart(2, '0')}:00
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShiftSummary — "Podsumowanie zmiany" exactly like Samsara
// ---------------------------------------------------------------------------
function ShiftSummary({ activities, locale }: { activities: Activity[]; locale: string }) {
  const summary: Record<string, number> = {};
  for (const a of activities) {
    summary[a.type] = (summary[a.type] || 0) + a.duration_minutes;
  }

  const types = ['DRIVING', 'WORK', 'REST', 'AVAILABILITY'] as const;

  return (
    <div className="flex flex-col sm:flex-row border-t border-gray-200 dark:border-gray-700">
      {/* Left: Podsumowanie zmiany */}
      <div className="flex-1 p-4 sm:border-r border-gray-200 dark:border-gray-700">
        <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {locale === 'de' ? 'Schichtzusammenfassung' : 'Podsumowanie zmiany'}
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {types.map(type => {
            const cfg = TYPE_COLORS[type];
            const min = summary[type] || 0;
            return (
              <div key={type} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: cfg.color }}
                />
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {locale === 'de' ? cfg.labelDe : cfg.labelPl}
                </span>
                <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                  {fmtHm(min)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DaySection — one collapsible day entry (matching Samsara layout)
// ---------------------------------------------------------------------------
function DaySection({
  shift,
  activities,
  expanded,
  onToggle,
  locale,
}: {
  shift: ShiftDetail;
  activities: Activity[];
  expanded: boolean;
  onToggle: () => void;
  locale: string;
}) {
  const totalMin = shift.duration_minutes || activities.reduce((s, a) => s + a.duration_minutes, 0);

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
      {/* Clickable header row */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
      >
        {expanded
          ? <ChevronUp size={16} className="text-gray-400 shrink-0" />
          : <ChevronDown size={16} className="text-gray-400 shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {fmtShortDate(shift.shift_date || shift.grid_date, locale)} {fmtTime(shift.shift_start)} CEST
          </span>
          <span className="text-sm text-gray-400 mx-1">-</span>
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 shrink-0">
          {fmtHm(totalMin)}
        </span>
      </button>

      {/* Expanded content — Samsara layout */}
      {expanded && (
        <div className="pb-0">
          {/* Driver name + date range header */}
          <div className="px-4 pb-2">
            <p className="text-[13px] text-gray-500 dark:text-gray-400">
              {fmtShortDate(shift.shift_date || shift.grid_date, locale)} {fmtTime(shift.shift_start)} – {fmtTime(shift.shift_end)}
            </p>
          </div>

          {/* Time-axis timeline */}
          <div className="px-4 pb-1">
            <TimeAxisTimeline
              activities={activities}
              shiftStart={shift.shift_start}
              shiftEnd={shift.shift_end}
            />
          </div>

          {/* Shift summary */}
          <ShiftSummary activities={activities} locale={locale} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalendarPicker — dual-month popover like Samsara
// ---------------------------------------------------------------------------
type PeriodMode = 'day' | 'week' | 'month';

function CalendarPicker({
  open,
  onClose,
  locale,
  mode,
  onModeChange,
  selectedMonday,
  onSelectWeek,
  onSelectDay,
  onSelectMonth,
}: {
  open: boolean;
  onClose: () => void;
  locale: string;
  mode: PeriodMode;
  onModeChange: (m: PeriodMode) => void;
  selectedMonday: Date;
  onSelectWeek: (monday: Date) => void;
  onSelectDay: (d: Date) => void;
  onSelectMonth: (year: number, month: number) => void;
}) {
  const [viewDate, setViewDate] = useState(() => new Date(selectedMonday));
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  if (!open) return null;

  const month1 = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const month2 = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
  const monthsFull = locale === 'de' ? MONTHS_FULL_DE : MONTHS_FULL_PL;
  const calDays = locale === 'de' ? CAL_DAYS_DE : CAL_DAYS_PL;

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));

  const selMondayISO = toISO(selectedMonday);
  const selSundayISO = toISO((() => { const d = new Date(selectedMonday); d.setDate(d.getDate() + 6); return d; })());

  function renderMonth(firstDay: Date) {
    const y = firstDay.getFullYear();
    const m = firstDay.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const startDow = firstDay.getDay(); // 0=Sun
    const cells: (number | null)[] = [];
    // Fill leading empty
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    // Fill trailing
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

    return (
      <div className="w-[260px]">
        <p className="text-center text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
          {monthsFull[m]} {y}
        </p>
        <div className="grid grid-cols-7 gap-0 text-center">
          {calDays.map(d => (
            <div key={d} className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 py-1">{d}</div>
          ))}
          {rows.flatMap((row, ri) =>
            row.map((day, ci) => {
              if (day === null) return <div key={`${ri}-${ci}`} />;
              const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isInWeek = mode === 'week' && iso >= selMondayISO && iso <= selSundayISO;
              const isToday = iso === toISO(new Date());
              return (
                <button
                  key={iso}
                  onClick={() => {
                    const dt = new Date(y, m, day);
                    if (mode === 'week') onSelectWeek(getMonday(dt));
                    else if (mode === 'day') onSelectDay(dt);
                    else onSelectMonth(y, m);
                    onClose();
                  }}
                  className={`
                    py-1.5 text-sm rounded transition
                    ${isInWeek ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-semibold' : ''}
                    ${isToday && !isInWeek ? 'font-bold text-blue-600 dark:text-blue-400' : ''}
                    ${!isInWeek && !isToday ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800' : ''}
                  `}
                >
                  {day}
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-2 z-50 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex overflow-hidden animate-slide-up"
    >
      {/* Left panel: mode selector */}
      <div className="w-[130px] border-r border-gray-200 dark:border-gray-700 py-3">
        {[
          { key: 'day' as PeriodMode, label: locale === 'de' ? 'Tag' : 'Dzień' },
          { key: 'week' as PeriodMode, label: locale === 'de' ? 'Woche' : 'Tydzień' },
          { key: 'month' as PeriodMode, label: locale === 'de' ? 'Monat' : 'Miesiąc' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onModeChange(key)}
            className={`w-full text-left px-4 py-2 text-sm transition ${
              mode === key
                ? 'font-bold text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-800'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Right panel: dual month calendars */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <ChevronLeft size={16} />
          </button>
          <div className="flex-1" />
          <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex gap-6">
          {renderMonth(month1)}
          {renderMonth(month2)}
        </div>
      </div>
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

  // Period
  const [periodMode, setPeriodMode] = useState<PeriodMode>('week');
  const [weekMonday, setWeekMonday] = useState<Date>(() => getMonday(new Date()));
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Analysis
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // UI
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [showDetails, setShowDetails] = useState(true);

  // Load drivers
  useEffect(() => {
    fetchDrivers()
      .then((data) => {
        const withFiles = data.drivers.filter((d) => d.files.length > 0);
        setDrivers(withFiles);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingDrivers(false));
  }, []);

  const selectedDriver = selectedDriverIdx >= 0 ? drivers[selectedDriverIdx] : null;

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
  const prevPeriod = () => {
    setWeekMonday((m) => { const d = new Date(m); d.setDate(d.getDate() - 7); return d; });
    setExpandedDays(new Set());
  };
  const nextPeriod = () => {
    setWeekMonday((m) => { const d = new Date(m); d.setDate(d.getDate() + 7); return d; });
    setExpandedDays(new Set());
  };

  // Week range
  const weekDays = useMemo(() => getWeekDays(weekMonday), [weekMonday]);
  const weekSunday = weekDays[6];

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

  // Map shifts by date
  const dayData = useMemo(() => {
    const map = new Map<string, { shift: ShiftDetail; activities: Activity[] }>();
    for (const sh of weekShifts) {
      const dateKey = sh.shift_date || sh.grid_date;
      const activities: Activity[] = (sh as any).activity_timeline || [];
      map.set(dateKey, { shift: sh, activities });
    }
    return map;
  }, [weekShifts]);

  // Weekly totals
  const weekTotals = useMemo(() => {
    const t = { driving: 0, work: 0, rest: 0, avail: 0, total: 0 };
    for (const sh of weekShifts) {
      t.driving += sh.driving_minutes || 0;
      t.work += sh.work_minutes || 0;
      t.rest += sh.break_minutes || 0;
      t.avail += sh.avail_minutes || 0;
      t.total += sh.duration_minutes || 0;
    }
    return t;
  }, [weekShifts]);

  const toggleDay = (date: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedDays(new Set(weekShifts.map(sh => sh.shift_date || sh.grid_date)));
  };
  const collapseAll = () => setExpandedDays(new Set());

  const driverName = analysisData?.driver_info?.driver_name || selectedDriver?.name || '';

  return (
    <div className="animate-slide-up">
      {/* ====== TOP TOOLBAR — Samsara style ====== */}
      <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-t-xl">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-4">
          <button className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 border-b-2 border-blue-600">
            {locale === 'de' ? 'Zusammenfassung' : 'Streszczenie'}
          </button>
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          {/* Driver selector */}
          <div className="flex items-center gap-2">
            <Users size={16} className="text-gray-400" />
            {loadingDrivers ? (
              <Spinner size="sm" />
            ) : (
              <select
                value={selectedDriverIdx}
                onChange={(e) => handleDriverChange(Number(e.target.value))}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
              >
                <option value={-1}>
                  {locale === 'de' ? '— Fahrer auswählen —' : '— Wybierz kierowcę —'}
                </option>
                {drivers.map((d, i) => (
                  <option key={d.card_number || i} value={i}>{d.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Separator */}
          <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block" />

          {/* Week navigator — "< Week >" */}
          <div className="relative flex items-center gap-1">
            <button
              onClick={prevPeriod}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => setCalendarOpen(!calendarOpen)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              <Calendar size={14} className="text-gray-400" />
              {locale === 'de' ? 'Woche' : 'Week'}
            </button>
            <button
              onClick={nextPeriod}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              <ChevronRight size={18} />
            </button>

            {/* Calendar popover */}
            <CalendarPicker
              open={calendarOpen}
              onClose={() => setCalendarOpen(false)}
              locale={locale}
              mode={periodMode}
              onModeChange={setPeriodMode}
              selectedMonday={weekMonday}
              onSelectWeek={(m) => { setWeekMonday(m); setExpandedDays(new Set()); }}
              onSelectDay={(d) => { setWeekMonday(getMonday(d)); setExpandedDays(new Set()); }}
              onSelectMonth={(y, m) => { setWeekMonday(getMonday(new Date(y, m, 1))); setExpandedDays(new Set()); }}
            />
          </div>

          {/* Toggle "Pokaż szczegóły statusu" */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
          >
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${showDetails ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${showDetails ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
            {locale === 'de' ? 'Statusdetails anzeigen' : 'Pokaż szczegóły statusu'}
          </button>

          {/* Separator */}
          <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block" />

          {/* Expand/Collapse */}
          <button
            onClick={expandAll}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
          >
            {locale === 'de' ? 'Alle aufklappen' : 'Rozwiń wszystkie'}
          </button>
          <button
            onClick={collapseAll}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
          >
            {locale === 'de' ? 'Alle zuklappen' : 'Zwinąć wszystkie'}
          </button>

          <div className="flex-1" />

          {/* Print */}
          <button
            onClick={() => window.print()}
            className="rounded-lg border border-gray-300 dark:border-gray-600 p-2 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition print:hidden"
          >
            <Printer size={16} />
          </button>
        </div>
      </div>

      {/* ====== CONTENT AREA ====== */}
      <div className="bg-white dark:bg-gray-900 rounded-b-xl border-x border-b border-gray-200 dark:border-gray-700">

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex flex-col items-center gap-2 py-12 text-red-500">
            <AlertCircle size={28} />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* No driver selected */}
        {!loading && !error && !selectedDriver && (
          <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
            <Users size={36} className="opacity-40" />
            <p className="text-sm">
              {locale === 'de'
                ? 'Fahrer auswählen, um den Bericht anzuzeigen'
                : 'Wybierz kierowcę, aby wyświetlić raport'}
            </p>
          </div>
        )}

        {/* Report */}
        {!loading && !error && selectedDriver && analysisData && (
          <>
            {/* Per-day sections */}
            {weekShifts.length > 0 ? (
              <div>
                {weekShifts.map((sh) => {
                  const dateKey = sh.shift_date || sh.grid_date;
                  const dd = dayData.get(dateKey);
                  return (
                    <DaySection
                      key={dateKey}
                      shift={sh}
                      activities={dd?.activities || []}
                      expanded={expandedDays.has(dateKey)}
                      onToggle={() => toggleDay(dateKey)}
                      locale={locale}
                    />
                  );
                })}

                {/* ====== WEEKLY TOTALS — "Podsumowanie godzin" ====== */}
                <div className="border-t-2 border-gray-300 dark:border-gray-600 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                        {locale === 'de' ? 'Wochensumme' : 'Podsumowanie tygodnia'}
                      </p>
                      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {fmtHm(weekTotals.total)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      {([
                        { key: 'DRIVING', min: weekTotals.driving },
                        { key: 'WORK', min: weekTotals.work },
                        { key: 'REST', min: weekTotals.rest },
                        { key: 'AVAILABILITY', min: weekTotals.avail },
                      ] as const).map(({ key, min }) => {
                        const cfg = TYPE_COLORS[key];
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-full"
                              style={{ backgroundColor: cfg.color }}
                            />
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {locale === 'de' ? cfg.labelDe : cfg.labelPl}
                            </span>
                            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                              {fmtHm(min)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
                <Calendar size={32} className="opacity-40" />
                <p className="text-sm">
                  {locale === 'de'
                    ? 'Keine Schichten in dieser Woche'
                    : 'Brak zmian w tym tygodniu'}
                </p>
                <p className="text-xs text-gray-400">
                  {fmtShortDate(toISO(weekMonday), locale)} – {fmtShortDate(toISO(weekSunday), locale)}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

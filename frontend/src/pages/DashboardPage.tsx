import { useEffect, useState, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  RefreshCw, AlertCircle, ArrowRight,
  Cloud, Truck, Clock, CreditCard, AlertTriangle,
  Sun, Moon, Sunrise, Sunset, CheckCircle, Gauge,
  MapPin, ExternalLink,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../hooks/useAuth';
import { fetchDashboard, fetchConnectionStatus, scanCardExpiry, fetchPayrollStatus, fetchDrivers, fetchLiveStatus, fetchVehicleLocations } from '../lib/api';
import type { StaleDriver, ExpiringCard, PayrollStatusValue, LiveDriverStatus, VehicleLocation } from '../lib/api';
import type { Driver } from '../types';
import { formatDateTime, formatDate } from '../lib/format';
import { StatCard, Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { DashboardSkeleton } from '../components/Skeleton';
import { useStaggerIn } from '../hooks/useStaggerIn';

const REFRESH_INTERVAL = 60_000; // 60 seconds

function getTimeOfDay(t: (key: any) => string) {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { greeting: t('greetMorning'), Icon: Sunrise, color: 'text-amber-500' };
  if (h >= 12 && h < 17) return { greeting: t('greetAfternoon'), Icon: Sun, color: 'text-amber-400' };
  if (h >= 17 && h < 21) return { greeting: t('greetEvening'), Icon: Sunset, color: 'text-orange-500' };
  return { greeting: t('greetNight'), Icon: Moon, color: 'text-indigo-400' };
}

const MAX_VISIBLE = 10;

function daysColor(days: number | null): string {
  if (days === null) return 'text-danger';
  if (days > 30) return 'text-danger';
  if (days > 14) return 'text-warning';
  if (days > 7) return 'text-amber-500';
  return 'text-success';
}

function daysBg(days: number | null): string {
  if (days === null) return 'bg-danger/[0.03]';
  if (days > 30) return 'bg-danger/[0.03]';
  if (days > 14) return 'bg-warning/[0.03]';
  return '';
}

function expiryColor(daysLeft: number): string {
  if (daysLeft < 0) return 'text-danger';
  if (daysLeft <= 30) return 'text-danger';
  if (daysLeft <= 90) return 'text-warning';
  return 'text-success';
}

function expiryBg(daysLeft: number): string {
  if (daysLeft < 0) return 'bg-danger/[0.03]';
  if (daysLeft <= 30) return 'bg-danger/[0.03]';
  if (daysLeft <= 90) return 'bg-warning/[0.03]';
  return '';
}

interface DashboardData {
  driver_count: number;
  total_files: number;
  last_sync: string;
  synced_count: number;
  last_sync_status: string;
  last_sync_errors: number;
  last_sync_uploaded: number;
  stale_drivers: StaleDriver[];
  expiring_cards: ExpiringCard[];
}

// Cache the last payload so re-visits render instantly and refresh silently
// in the background (no skeleton flicker on every navigation).
const DASH_CACHE = 'dash-cache-v1';
function readDashCache(): DashboardData | null {
  try {
    const raw = sessionStorage.getItem(DASH_CACHE);
    return raw ? (JSON.parse(raw) as DashboardData) : null;
  } catch {
    return null;
  }
}
function writeDashCache(d: DashboardData) {
  try {
    sessionStorage.setItem(DASH_CACHE, JSON.stringify(d));
  } catch {
    /* quota / private mode — non-critical */
  }
}

export function DashboardPage() {
  const { t, locale } = useI18n();
  const { role } = useAuth();
  const [data, setData] = useState<DashboardData | null>(readDashCache);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState<{ dropbox: boolean; samsara: boolean } | null>(null);
  const [showAllStale, setShowAllStale] = useState(false);
  const [showAllExpiring, setShowAllExpiring] = useState(false);
  const [scanning, setScanning] = useState(false);
  const navigate = useNavigate();

  // Payroll summary for current period
  const currentPeriod = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const [payrollStatuses, setPayrollStatuses] = useState<Record<string, PayrollStatusValue>>({});
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [liveDrivers, setLiveDrivers] = useState<LiveDriverStatus[]>([]);
  const [fleet, setFleet] = useState<VehicleLocation[]>([]);
  const [fleetShowAll, setFleetShowAll] = useState(false);

  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tiles and panels lift into place once the first payload is rendered.
  const pageRef = useStaggerIn([data === null, fleet.length > 0, liveDrivers.length > 0], { y: 10, stagger: 0.05 });

  const loadDashboard = () => {
    fetchDashboard()
      .then((d) => { setData(d); writeDashCache(d); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    loadDashboard();
    fetchConnectionStatus()
      .then(setConnections)
      .catch(() => {});
    // Load payroll
    fetchPayrollStatus(currentPeriod)
      .then(r => setPayrollStatuses(r.statuses || {}))
      .catch(() => {});
    fetchDrivers()
      .then(r => setDrivers(r.drivers || []))
      .catch(() => {});
    fetchLiveStatus()
      .then(r => setLiveDrivers(r.drivers || []))
      .catch(() => {});
    // Live fleet positions — hidden silently for users without permission
    fetchVehicleLocations()
      .then(r => setFleet(r.vehicles || []))
      .catch(() => {});

    // Auto-refresh every 60s
    refreshRef.current = setInterval(() => {
      fetchDashboard().then((d) => { setData(d); writeDashCache(d); }).catch(() => {});
      fetchConnectionStatus().then(setConnections).catch(() => {});
      fetchVehicleLocations().then(r => setFleet(r.vehicles || [])).catch(() => {});
    }, REFRESH_INTERVAL);

    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, []);

  const handleScanExpiry = async () => {
    setScanning(true);
    try {
      await scanCardExpiry();
      loadDashboard();
    } catch {
      // ignore
    } finally {
      setScanning(false);
    }
  };

  if (error && !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-danger animate-fade-in">
        <AlertCircle size={32} />
        <p>{error}</p>
        <button
          onClick={() => { setError(''); loadDashboard(); }}
          className="btn-press mt-2 rounded-xl bg-primary-600 px-4 py-2 min-h-[44px] text-sm font-semibold text-white transition hover:bg-primary-700"
        >
          {t('tryAgain')}
        </button>
      </div>
    );
  }

  if (!data) {
    return <DashboardSkeleton />;
  }

  const syncBadge = data.last_sync_status === 'ok'
    ? <Badge variant="green" dot>{t('syncOk')}</Badge>
    : data.last_sync_status === 'error'
    ? <Badge variant="red" dot>{t('syncErrorLabel')}</Badge>
    : data.last_sync_status === 'partial'
    ? <Badge variant="orange" dot>{t('syncPartial')}</Badge>
    : <Badge variant="gray">-</Badge>;

  const staleDrivers = data.stale_drivers || [];
  const expiringCards = data.expiring_cards || [];
  const visibleStale = showAllStale ? staleDrivers : staleDrivers.slice(0, MAX_VISIBLE);
  const visibleExpiring = showAllExpiring ? expiringCards : expiringCards.slice(0, MAX_VISIBLE);

  const overdueCount = staleDrivers.filter(d => d.days_since === null || d.days_since > 28).length;
  const expiringCritical = expiringCards.filter(c => c.days_left <= 90).length;

  // Payroll progress for the current month — shared by the KPI strip, the
  // to-do list and the payroll card below.
  const payroll = (() => {
    const [y, m] = currentPeriod.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const sinceDate = `${next}-01`;
    const withNewFiles = drivers.filter(d => d.files.some(f => f.modified >= sinceDate));
    const total = withNewFiles.length;
    const done = withNewFiles.filter(d => payrollStatuses[d.card_number || d.name] === 'policzony').length;
    const stz = withNewFiles.filter(d => payrollStatuses[d.card_number || d.name] === 'stundenzettel').length;
    return { total, done, stz, remaining: total - done - stz };
  })();

  const movingCount = fleet.filter(v => v.speed_kmh > 5).length;
  const stoppedLong = (() => {
    const now = new Date();
    const working = now.getDay() >= 1 && now.getDay() <= 5 && now.getHours() >= 6 && now.getHours() < 20;
    if (!working) return [] as VehicleLocation[];
    return fleet.filter(v => v.speed_kmh <= 5 && v.stopped_minutes != null && v.stopped_minutes >= 180);
  })();
  const longestOverdue = staleDrivers.reduce((max, d) => Math.max(max, d.days_since ?? 0), 0);
  const nextExpiry = expiringCards.filter(c => c.days_left >= 0).sort((a, b) => a.days_left - b.days_left)[0];

  // Everything that needs a decision today, most urgent first. Each row
  // links to the page where the work happens.
  type Todo = { id: string; tone: 'crit' | 'warn' | 'ok'; count: number; text: string; detail: string; to: string };
  const todos: Todo[] = [];
  if (overdueCount > 0) {
    const names = staleDrivers.filter(d => d.days_since === null || d.days_since > 28).map(d => d.name);
    todos.push({ id: 'download', tone: 'crit', count: overdueCount, text: t('dashTodoDownload'),
      detail: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : ''), to: '/drivers' });
  }
  if (data.last_sync_errors > 0) {
    todos.push({ id: 'sync', tone: 'crit', count: data.last_sync_errors, text: t('dashTodoSync'),
      detail: formatDateTime(data.last_sync, locale), to: '/sync' });
  }
  if (expiringCritical > 0) {
    todos.push({ id: 'expiring', tone: expiringCards.some(c => c.days_left <= 30) ? 'crit' : 'warn', count: expiringCritical, text: t('dashTodoExpiring'),
      detail: nextExpiry ? `${nextExpiry.driver_name || nextExpiry.card_number} · ${formatDate(nextExpiry.card_expiry_date, locale)}` : '', to: '/config' });
  }
  if (payroll.remaining > 0) {
    todos.push({ id: 'payroll', tone: 'warn', count: payroll.remaining, text: t('dashTodoPayroll'),
      detail: `${payroll.done + payroll.stz}/${payroll.total} · ${currentPeriod}`, to: '/payroll' });
  }
  if (stoppedLong.length > 0) {
    todos.push({ id: 'stopped', tone: 'warn', count: stoppedLong.length, text: t('dashTodoStopped'),
      detail: stoppedLong.slice(0, 3).map(v => v.vehicle_name).join(', '), to: '/map' });
  }
  const toneDot: Record<Todo['tone'], string> = { crit: 'bg-danger', warn: 'bg-warning', ok: 'bg-success' };

  return (
    <div ref={pageRef}>
      {(() => {
        const { greeting } = getTimeOfDay(t);
        const roleName = t(`role${role.charAt(0).toUpperCase()}${role.slice(1)}` as any);
        const todayStr = new Date().toLocaleDateString(locale === 'de' ? 'de-DE' : 'pl-PL', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        return (
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h1 className="text-[22px] font-extrabold tracking-tight text-ink">
              {greeting}, {roleName}
            </h1>
            <p className="text-sm text-muted">
              <span className="capitalize">{todayStr}</span>
              <span className="hidden sm:inline"> · {t('dashDrivers')}: <span className="tabular-nums">{data.driver_count}</span> · {t('dashFiles')}: <span className="tabular-nums">{data.total_files}</span></span>
            </p>
          </div>
        );
      })()}

      {/* KPI strip — the stripe says the state, the number says how much */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('dashKpiOverdue')}
          value={overdueCount}
          color={overdueCount > 0 ? 'red' : 'green'}
          detail={overdueCount > 0
            ? (locale === 'de' ? `am längsten ${longestOverdue} Tage` : `najdłużej ${longestOverdue} dni`)
            : (locale === 'de' ? `${staleDrivers.length} Fahrer aktuell` : `${staleDrivers.length} kierowców aktualnych`)}
        />
        <StatCard
          label={t('dashKpiExpiring')}
          value={expiringCritical}
          color={expiringCritical > 0 ? 'orange' : 'green'}
          detail={nextExpiry
            ? (locale === 'de' ? `nächste ${formatDate(nextExpiry.card_expiry_date, locale)}` : `najbliższa ${formatDate(nextExpiry.card_expiry_date, locale)}`)
            : (locale === 'de' ? 'in 90 Tagen keine' : 'w 90 dni żadna')}
        />
        {fleet.length > 0 ? (
          <StatCard
            label={t('dashKpiFleet')}
            value={`${movingCount} / ${fleet.length}`}
            color={stoppedLong.length > 0 ? 'orange' : 'green'}
            detail={stoppedLong.length > 0
              ? (locale === 'de' ? `${stoppedLong.length} steht > 3 Std.` : `${stoppedLong.length} stoi > 3 h`)
              : (locale === 'de' ? 'keine Stillstände > 3 Std.' : 'brak postojów > 3 h')}
          />
        ) : (
          <StatCard label={t('dashNewFiles')} value={data.last_sync_uploaded} color="blue" detail={formatDateTime(data.last_sync, locale)} />
        )}
        <StatCard
          label={t('dashKpiPayroll')}
          value={payroll.remaining}
          color={payroll.remaining > 0 ? 'orange' : 'green'}
          detail={`${payroll.done + payroll.stz} / ${payroll.total} · ${currentPeriod}`}
        />
      </div>

      {/* To-do: the day starts with decisions, not with statistics */}
      <Card className="mb-5 overflow-hidden p-0" data-animate>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="text-sm font-bold text-ink">{t('dashTodo')}</h3>
          <span className="text-xs text-muted tabular-nums">{todos.length}</span>
        </div>
        {todos.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-5 text-sm text-muted">
            <CheckCircle size={16} className="text-success" />
            {t('dashTodoEmpty')}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {todos.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3" data-animate>
                <span className={`h-2 w-2 shrink-0 rounded-full ${toneDot[item.tone]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    <span className="tabular-nums">{item.count}</span> {item.text}
                  </p>
                  {item.detail && <p className="truncate text-xs text-muted">{item.detail}</p>}
                </div>
                <Link
                  to={item.to}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    item.tone === 'crit' ? 'btn-primary' : 'btn-secondary'
                  }`}
                >
                  {t('dashOpen')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Distribution: days since the last card download */}
      {staleDrivers.length > 0 && (() => {
        const buckets = [
          { label: locale === 'de' ? '≤ 7 Tage' : '≤ 7 dni', color: 'var(--color-success)', count: staleDrivers.filter(d => d.days_since != null && d.days_since <= 7).length },
          { label: '8–14', color: 'var(--color-primary-400)', count: staleDrivers.filter(d => d.days_since != null && d.days_since > 7 && d.days_since <= 14).length },
          { label: '15–28', color: 'var(--color-warning)', count: staleDrivers.filter(d => d.days_since != null && d.days_since > 14 && d.days_since <= 28).length },
          { label: locale === 'de' ? '> 28 / keine' : '> 28 / brak', color: 'var(--color-danger)', count: staleDrivers.filter(d => d.days_since == null || d.days_since > 28).length },
        ];
        const max = Math.max(1, ...buckets.map(b => b.count));
        return (
          <div className="mb-5">
            <Card className="p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.06em] text-muted">
                {locale === 'de' ? 'Fahrer nach Tagen seit Download' : 'Kierowcy wg dni od pobrania'}
              </h3>
              <div className="space-y-2">
                {buckets.map((b) => (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs font-semibold text-muted sm:w-28">{b.label}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-surface-2">
                      <div
                        className="h-full rounded-sm transition-all duration-500"
                        style={{ width: `${(b.count / max) * 100}%`, background: b.color, minWidth: b.count > 0 ? '0.5rem' : 0 }}
                      />
                    </div>
                    <span className="w-7 shrink-0 text-right text-sm font-bold tabular-nums text-ink">{b.count}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      })()}

      {/* Main content: 2 columns */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Stale drivers */}
        <Card className="p-0 overflow-hidden" data-animate>
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <Clock size={16} />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
              {t('dashStaleDrivers')}
            </h3>
            {overdueCount > 0 && (
              <Badge variant="red">{overdueCount}</Badge>
            )}
          </div>
          {staleDrivers.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t('dashNoStale')}</p>
          ) : (
            <div>
              <div className="divide-y divide-border">
                {visibleStale.map((d) => {
                  const analysisUrl = d.latest_file_path
                    ? `/analysis?${new URLSearchParams({ path: d.latest_file_path, name: d.latest_file_name || d.name, driver: d.name })}`
                    : '/drivers';
                  return (
                  <Link
                    key={d.card_number || d.name}
                    to={analysisUrl}
                    className={`flex items-center gap-3 px-5 py-3 min-h-[44px] transition-colors hover:bg-primary-50 ${daysBg(d.days_since)}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{d.name}</p>
                      {d.card_number && (
                        <p className="truncate text-xs text-muted">{d.card_number}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`text-sm font-bold tabular-nums ${daysColor(d.days_since)}`}>
                        {d.days_since === null ? '—' : d.days_since}
                      </span>
                      <p className="text-xs text-muted">{t('dashDaysSince')}</p>
                    </div>
                  </Link>
                  );
                })}
              </div>
              {staleDrivers.length > MAX_VISIBLE && (
                <div className="border-t border-border px-5 py-3">
                  <button
                    onClick={() => setShowAllStale(!showAllStale)}
                    className="flex w-full items-center justify-center gap-1 min-h-[44px] text-xs font-semibold text-primary-600 transition hover:text-primary-700"
                  >
                    {showAllStale
                      ? t('close')
                      : `${t('dashShowAll')} (${staleDrivers.length})`
                    }
                    <ArrowRight size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Expiring cards */}
        <Card className="p-0 overflow-hidden" data-animate>
          <div className="flex items-center gap-2 border-b border-border px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-danger/10 text-danger">
              <CreditCard size={16} />
            </div>
            <h3 className="flex-1 text-sm font-semibold uppercase tracking-wider text-muted">
              {t('dashExpiringCards')}
            </h3>
            {expiringCritical > 0 && (
              <Badge variant="red">{expiringCritical}</Badge>
            )}
            <button
              onClick={handleScanExpiry}
              disabled={scanning}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 min-h-[44px] text-xs font-medium text-muted transition hover:border-primary-300 hover:text-ink disabled:opacity-50"
            >
              {scanning ? <Spinner size="sm" /> : <RefreshCw size={12} />}
              {scanning ? t('loading') : t('dashScanCards')}
            </button>
          </div>
          {expiringCards.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-muted">{t('dashNoExpiring')}</p>
            </div>
          ) : (
            <div>
              <div className="divide-y divide-border">
                {visibleExpiring.map((c) => (
                  <div
                    key={c.card_number}
                    className={`flex items-center gap-3 px-5 py-3 min-h-[44px] ${expiryBg(c.days_left)}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {c.driver_name || c.card_number}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {t('dashCardExpiry')}: {formatDate(c.card_expiry_date, locale)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {c.days_left < 0 ? (
                        <div className="flex items-center gap-1">
                          <AlertTriangle size={14} className="text-danger" />
                          <span className="text-sm font-bold text-danger">
                            {t('dashExpired')}
                          </span>
                        </div>
                      ) : (
                        <>
                          <span className={`text-sm font-bold tabular-nums ${expiryColor(c.days_left)}`}>
                            {c.days_left}
                          </span>
                          <p className="text-xs text-muted">{t('dashDaysLeft')}</p>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {expiringCards.length > MAX_VISIBLE && (
                <div className="border-t border-border px-5 py-3">
                  <button
                    onClick={() => setShowAllExpiring(!showAllExpiring)}
                    className="flex w-full items-center justify-center gap-1 min-h-[44px] text-xs font-semibold text-primary-600 transition hover:text-primary-700"
                  >
                    {showAllExpiring
                      ? t('close')
                      : `${t('dashShowAll')} (${expiringCards.length})`
                    }
                    <ArrowRight size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Live HOS status */}
      {liveDrivers.length > 0 && (
        <div className="mt-6">
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-light text-accent">
                <Gauge size={16} />
              </div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                {locale === 'de' ? 'Live Fahrerstatus' : 'Status kierowców na żywo'}
              </h3>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-success">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                Live
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 dark:bg-surface-2 text-left">
                    <th className="px-5 py-3 font-medium text-muted">{locale === 'de' ? 'Fahrer' : 'Kierowca'}</th>
                    <th className="px-3 py-3 font-medium text-muted">Status</th>
                    <th className="px-3 py-3 font-medium text-muted">{locale === 'de' ? 'Fahrzeug' : 'Pojazd'}</th>
                    <th className="px-3 py-3 font-medium text-muted text-right">{locale === 'de' ? 'Fahrzeit übrig' : 'Jazda pozostała'}</th>
                    <th className="px-3 py-3 font-medium text-muted text-right">{locale === 'de' ? 'Schicht übrig' : 'Zmiana pozostała'}</th>
                    <th className="px-3 py-3 font-medium text-muted text-right">{locale === 'de' ? 'Bis Pause' : 'Do przerwy'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border dark:divide-border">
                  {liveDrivers.filter(d => d.status !== 'unknown').map(d => {
                    const fmtMin = (m: number) => m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : '—';
                    const statusCfg: Record<string, { label: string; bg: string; text: string }> = {
                      driving: { label: locale === 'de' ? 'Fährt' : 'Jazda', bg: 'bg-success-soft', text: 'text-success' },
                      work: { label: locale === 'de' ? 'Arbeit' : 'Praca', bg: 'bg-warning-soft', text: 'text-warning' },
                      rest: { label: locale === 'de' ? 'Ruhe' : 'Odpoczynek', bg: 'bg-info-soft', text: 'text-accent' },
                    };
                    const st = statusCfg[d.status] || { label: d.status, bg: 'bg-surface-2', text: 'text-muted' };
                    const driveWarn = d.drive_remaining_min > 0 && d.drive_remaining_min <= 60;
                    const breakWarn = d.break_in_min > 0 && d.break_in_min <= 30;
                    return (
                      <tr key={d.id} className="hover:bg-surface-2">
                        <td className="px-5 py-3 font-medium text-ink dark:text-white">{d.name}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${st.bg} ${st.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${d.status === 'driving' ? 'bg-success' : d.status === 'work' ? 'bg-warning' : 'bg-accent'}`} />
                            {st.label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-muted">{d.vehicle || '—'}</td>
                        <td className={`px-3 py-3 text-right tabular-nums font-medium ${driveWarn ? 'text-danger' : 'text-ink dark:text-white'}`}>
                          {fmtMin(d.drive_remaining_min)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted">
                          {fmtMin(d.shift_remaining_min)}
                        </td>
                        <td className={`px-3 py-3 text-right tabular-nums font-medium ${breakWarn ? 'text-danger' : 'text-muted'}`}>
                          {fmtMin(d.break_in_min)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Live fleet map-less tracker */}
      {fleet.length > 0 && (() => {
        const driverByVehicle = new Map<string, string>();
        for (const d of liveDrivers) {
          if (d.vehicle) driverByVehicle.set(d.vehicle, d.name);
        }
        const timeAgo = (ts: string) => {
          if (!ts) return '—';
          const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
          if (mins < 1) return locale === 'de' ? 'jetzt' : 'teraz';
          if (mins < 60) return `${mins} min`;
          return `${Math.floor(mins / 60)} h ${mins % 60} min`;
        };
        const sorted = [...fleet].sort((a, b) => (b.speed_kmh - a.speed_kmh) || a.vehicle_name.localeCompare(b.vehicle_name));
        const visible = fleetShowAll ? sorted : sorted.slice(0, 8);
        return (
          <div className="mt-6">
            <Card className="p-0 overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success-soft text-success">
                  <MapPin size={16} />
                </div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                  {locale === 'de' ? 'Live-Flotte' : 'Flota na żywo'}
                </h3>
                <Badge variant="green">{movingCount} {locale === 'de' ? 'fährt' : 'w trasie'}</Badge>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-success">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  Live
                </span>
              </div>
              <div className="divide-y divide-border">
                {visible.map((v) => {
                  const moving = v.speed_kmh > 5;
                  const driver = v.driver_name || driverByVehicle.get(v.vehicle_name);
                  const stopLabel = (() => {
                    if (moving) return `${v.speed_kmh} km/h`;
                    const m = v.stopped_minutes;
                    if (m == null || m <= 0) return locale === 'de' ? 'Steht' : 'Postój';
                    const txt = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
                    return `${v.stopped_is_min ? '> ' : ''}${txt}`;
                  })();
                  const mapsUrl = v.latitude != null && v.longitude != null
                    ? `https://maps.google.com/?q=${v.latitude},${v.longitude}`
                    : '';
                  return (
                    <div key={v.vehicle_id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${moving ? 'bg-success animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <div className="w-28 shrink-0 sm:w-36">
                        <p className="truncate font-mono text-sm font-semibold text-ink">{v.vehicle_name}</p>
                        {driver && <p className="truncate text-[11px] text-muted">{driver}</p>}
                      </div>
                      <span
                        className={`hidden w-24 shrink-0 text-right font-mono text-xs sm:block ${moving ? 'font-bold text-success' : 'text-muted'}`}
                        title={moving ? undefined : (locale === 'de' ? 'Steht seit' : 'Czas postoju')}
                      >
                        {stopLabel}
                      </span>
                      <p className="min-w-0 flex-1 truncate text-xs text-muted" title={v.location}>
                        {v.location || '—'}
                      </p>
                      <span className="hidden shrink-0 text-[11px] tabular-nums text-muted md:block">{timeAgo(v.updated_at)}</span>
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-primary-50 hover:text-primary-600"
                          title="Google Maps"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
              {sorted.length > 8 && (
                <div className="border-t border-border px-5 py-2.5">
                  <button
                    onClick={() => setFleetShowAll(!fleetShowAll)}
                    className="flex w-full items-center justify-center gap-1 text-xs font-semibold text-primary-600 transition hover:text-primary-700"
                  >
                    {fleetShowAll ? t('close') : `${t('dashShowAll')} (${sorted.length})`}
                    <ArrowRight size={12} />
                  </button>
                </div>
              )}
            </Card>
          </div>
        );
      })()}

      {/* Bottom row: sync */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Sync info */}
        <Card className="p-4 sm:p-6" data-animate>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
            {t('dashSyncStatus')}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">{t('syncStatus')}</span>
              {syncBadge}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">{t('dashLastSync')}</span>
              <span className="text-sm font-medium text-ink">{formatDateTime(data.last_sync, locale)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">{t('dashTotalSynced')}</span>
              <span className="text-sm font-medium text-ink">{data.synced_count}</span>
            </div>
          </div>

          {/* Connection status */}
          {connections && (
            <div className="mt-4 border-t border-border pt-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3 py-1">
                  <Cloud size={18} className={connections.dropbox ? 'text-success' : 'text-danger'} />
                  <span className="flex-1 text-sm text-ink">{connections.dropbox ? t('dropboxConnected') : t('dropboxDisconnected')}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${connections.dropbox ? 'bg-success' : 'bg-danger'}`} />
                </div>
                <div className="flex items-center gap-3 py-1">
                  <Truck size={18} className={connections.samsara ? 'text-success' : 'text-danger'} />
                  <span className="flex-1 text-sm text-ink">{connections.samsara ? t('samsaraConnected') : t('samsaraDisconnected')}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${connections.samsara ? 'bg-success' : 'bg-danger'}`} />
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Payroll overview */}
        <Card className="p-4 sm:p-6" data-animate>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
              {locale === 'de' ? 'Lohnabrechnung' : 'Wypłaty'} — {currentPeriod}
            </h3>
            <Link to="/payroll" className="text-xs font-medium text-accent hover:underline">
              {locale === 'de' ? 'Öffnen' : 'Otwórz'} →
            </Link>
          </div>
          {(() => {
            const { total: totalToProcess, done, stz, remaining } = payroll;

            return (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-success-soft p-3 text-center">
                    <p className="text-2xl font-bold text-success">{done}</p>
                    <p className="text-[11px] text-muted">{locale === 'de' ? 'Geprüft' : 'Policzony'}</p>
                  </div>
                  <div className="rounded-lg bg-accent-light p-3 text-center">
                    <p className="text-2xl font-bold text-accent">{stz}</p>
                    <p className="text-[11px] text-muted">Stundenzettel</p>
                  </div>
                  <div className="rounded-lg bg-warning-soft p-3 text-center">
                    <p className="text-2xl font-bold text-warning">{remaining}</p>
                    <p className="text-[11px] text-muted">{locale === 'de' ? 'Offen' : 'Do zrobienia'}</p>
                  </div>
                </div>
                {totalToProcess > 0 && (
                  <div>
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2 dark:bg-surface-2">
                      {done > 0 && <div className="bg-success transition-all" style={{ width: `${(done / totalToProcess) * 100}%` }} />}
                      {stz > 0 && <div className="bg-accent transition-all" style={{ width: `${(stz / totalToProcess) * 100}%` }} />}
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {done + stz}/{totalToProcess} ({Math.round(((done + stz) / totalToProcess) * 100)}%)
                    </p>
                  </div>
                )}
                {remaining > 0 && (
                  <button
                    onClick={() => navigate('/payroll')}
                    className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-dark"
                  >
                    {locale === 'de' ? `${remaining} Fahrer offen — jetzt prüfen` : `${remaining} kierowców do policzenia`}
                  </button>
                )}
              </div>
            );
          })()}
        </Card>
      </div>
    </div>
  );
}

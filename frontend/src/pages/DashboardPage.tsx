import { useEffect, useState, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users, FileText, RefreshCw, AlertCircle, ArrowRight, Upload,
  Cloud, Truck, Clock, CreditCard, AlertTriangle,
  Sun, Moon, Sunrise, Sunset, ClipboardCheck, CheckCircle, Coins, Gauge,
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

  return (
    <div className="animate-slide-up">
      {(() => {
        const { greeting, Icon, color } = getTimeOfDay(t);
        const roleName = t(`role${role.charAt(0).toUpperCase()}${role.slice(1)}` as any);
        const todayStr = new Date().toLocaleDateString(locale === 'de' ? 'de-DE' : 'pl-PL', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        return (
          <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[rgba(87,80,241,0.10)] via-[rgba(87,80,241,0.04)] to-transparent p-5 sm:p-6">
            <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-primary-500/10 blur-3xl" />
            <div className="relative flex items-center gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm dark:bg-white/10 ${color}`}>
                <Icon size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold tracking-tight text-ink">
                  {greeting}, {roleName}
                </h1>
                <p className="text-sm text-muted">{t('dashTitle')}</p>
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold capitalize text-ink">{todayStr}</p>
                <p className="text-xs text-muted">{t('dashDrivers')}: {data.driver_count} · {t('dashFiles')}: {data.total_files}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('dashDrivers')}
          value={data.driver_count}
          icon={<Users size={20} />}
          color="primary"
        />
        <StatCard
          label={t('dashFiles')}
          value={data.total_files}
          icon={<FileText size={20} />}
          color="green"
        />
        <StatCard
          label={t('dashNewFiles')}
          value={data.last_sync_uploaded}
          icon={<Upload size={20} />}
          color="orange"
        />
        <StatCard
          label={t('dashSyncErrors')}
          value={data.last_sync_errors}
          icon={<AlertCircle size={20} />}
          color={data.last_sync_errors > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Distribution chart */}
      {staleDrivers.length > 0 && (() => {
        const buckets = [
          { label: locale === 'de' ? '≤ 7 Tage' : '≤ 7 dni', color: '#22ad5c', count: staleDrivers.filter(d => d.days_since != null && d.days_since <= 7).length },
          { label: '8–14', color: '#f59e0b', count: staleDrivers.filter(d => d.days_since != null && d.days_since > 7 && d.days_since <= 14).length },
          { label: '15–28', color: '#fb923c', count: staleDrivers.filter(d => d.days_since != null && d.days_since > 14 && d.days_since <= 28).length },
          { label: locale === 'de' ? '> 28 / keine' : '> 28 / brak', color: '#f23030', count: staleDrivers.filter(d => d.days_since == null || d.days_since > 28).length },
        ];
        const max = Math.max(1, ...buckets.map(b => b.count));
        return (
          <div className="mb-6">
            <Card className="p-4 sm:p-6">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
                {locale === 'de' ? 'Fahrer nach Tagen seit Download' : 'Kierowcy wg dni od pobrania'}
              </h3>
              <div className="space-y-2.5">
                {buckets.map((b) => (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs font-medium text-muted sm:w-28">{b.label}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(b.count / max) * 100}%`, background: b.color, minWidth: b.count > 0 ? '1.5rem' : 0 }}
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
        <Card className="p-0 overflow-hidden">
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
        <Card className="p-0 overflow-hidden">
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
            <div className="flex items-center gap-3 border-b border-[#e6ebf1] dark:border-[#374151] px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(87,80,241,0.08)] text-[#5750f1]">
                <Gauge size={16} />
              </div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-[#6b7280]">
                {locale === 'de' ? 'Live Fahrerstatus' : 'Status kierowców na żywo'}
              </h3>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-[#22ad5c]">
                <span className="h-2 w-2 rounded-full bg-[#22ad5c] animate-pulse" />
                Live
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f7f9fc] dark:bg-[#1f2a37] text-left">
                    <th className="px-5 py-3 font-medium text-[#6b7280]">{locale === 'de' ? 'Fahrer' : 'Kierowca'}</th>
                    <th className="px-3 py-3 font-medium text-[#6b7280]">Status</th>
                    <th className="px-3 py-3 font-medium text-[#6b7280]">{locale === 'de' ? 'Fahrzeug' : 'Pojazd'}</th>
                    <th className="px-3 py-3 font-medium text-[#6b7280] text-right">{locale === 'de' ? 'Fahrzeit übrig' : 'Jazda pozostała'}</th>
                    <th className="px-3 py-3 font-medium text-[#6b7280] text-right">{locale === 'de' ? 'Schicht übrig' : 'Zmiana pozostała'}</th>
                    <th className="px-3 py-3 font-medium text-[#6b7280] text-right">{locale === 'de' ? 'Bis Pause' : 'Do przerwy'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6ebf1] dark:divide-[#374151]">
                  {liveDrivers.filter(d => d.status !== 'unknown').map(d => {
                    const fmtMin = (m: number) => m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : '—';
                    const statusCfg: Record<string, { label: string; bg: string; text: string }> = {
                      driving: { label: locale === 'de' ? 'Fährt' : 'Jazda', bg: 'bg-[#21965314]', text: 'text-[#219653]' },
                      work: { label: locale === 'de' ? 'Arbeit' : 'Praca', bg: 'bg-[#FFA70B14]', text: 'text-[#FFA70B]' },
                      rest: { label: locale === 'de' ? 'Ruhe' : 'Odpoczynek', bg: 'bg-[#3c50e014]', text: 'text-[#3c50e0]' },
                    };
                    const st = statusCfg[d.status] || { label: d.status, bg: 'bg-[#f3f4f6]', text: 'text-[#6b7280]' };
                    const driveWarn = d.drive_remaining_min > 0 && d.drive_remaining_min <= 60;
                    const breakWarn = d.break_in_min > 0 && d.break_in_min <= 30;
                    return (
                      <tr key={d.id} className="hover:bg-[rgba(87,80,241,0.02)]">
                        <td className="px-5 py-3 font-medium text-[#111928] dark:text-white">{d.name}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${st.bg} ${st.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${d.status === 'driving' ? 'bg-[#219653]' : d.status === 'work' ? 'bg-[#FFA70B]' : 'bg-[#3c50e0]'}`} />
                            {st.label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-[#6b7280]">{d.vehicle || '—'}</td>
                        <td className={`px-3 py-3 text-right tabular-nums font-medium ${driveWarn ? 'text-[#f23030]' : 'text-[#111928] dark:text-white'}`}>
                          {fmtMin(d.drive_remaining_min)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-[#6b7280]">
                          {fmtMin(d.shift_remaining_min)}
                        </td>
                        <td className={`px-3 py-3 text-right tabular-nums font-medium ${breakWarn ? 'text-[#f23030]' : 'text-[#6b7280]'}`}>
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
        const movingCount = fleet.filter(v => v.speed_kmh > 5).length;
        const visible = fleetShowAll ? sorted : sorted.slice(0, 8);
        return (
          <div className="mt-6">
            <Card className="p-0 overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#34d399] to-[#16a34a] text-white">
                  <MapPin size={16} />
                </div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                  {locale === 'de' ? 'Live-Flotte' : 'Flota na żywo'}
                </h3>
                <Badge variant="green">{movingCount} {locale === 'de' ? 'fährt' : 'w trasie'}</Badge>
                <span className="ml-auto flex items-center gap-1.5 text-xs text-[#22ad5c]">
                  <span className="h-2 w-2 rounded-full bg-[#22ad5c] animate-pulse" />
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
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${moving ? 'bg-[#22ad5c] animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <div className="w-28 shrink-0 sm:w-36">
                        <p className="truncate font-mono text-sm font-semibold text-ink">{v.vehicle_name}</p>
                        {driver && <p className="truncate text-[11px] text-muted">{driver}</p>}
                      </div>
                      <span
                        className={`hidden w-24 shrink-0 text-right font-mono text-xs sm:block ${moving ? 'font-bold text-[#22ad5c]' : 'text-muted'}`}
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
        <Card className="p-4 sm:p-6">
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
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
              {locale === 'de' ? 'Lohnabrechnung' : 'Wypłaty'} — {currentPeriod}
            </h3>
            <Link to="/payroll" className="text-xs font-medium text-[#5750f1] hover:underline">
              {locale === 'de' ? 'Öffnen' : 'Otwórz'} →
            </Link>
          </div>
          {(() => {
            const sinceDate = (() => {
              const [y, m] = currentPeriod.split('-').map(Number);
              const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
              return `${next}-01`;
            })();
            const driversWithNewFiles = drivers.filter(d =>
              d.files.some(f => f.modified >= sinceDate)
            );
            const totalToProcess = driversWithNewFiles.length;
            const done = driversWithNewFiles.filter(d => {
              const key = d.card_number || d.name;
              return payrollStatuses[key] === 'policzony';
            }).length;
            const stz = driversWithNewFiles.filter(d => {
              const key = d.card_number || d.name;
              return payrollStatuses[key] === 'stundenzettel';
            }).length;
            const remaining = totalToProcess - done - stz;

            return (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-[rgba(34,173,92,0.06)] p-3 text-center">
                    <p className="text-2xl font-bold text-[#22ad5c]">{done}</p>
                    <p className="text-[11px] text-[#6b7280]">{locale === 'de' ? 'Geprüft' : 'Policzony'}</p>
                  </div>
                  <div className="rounded-lg bg-[rgba(60,80,224,0.06)] p-3 text-center">
                    <p className="text-2xl font-bold text-[#3c50e0]">{stz}</p>
                    <p className="text-[11px] text-[#6b7280]">Stundenzettel</p>
                  </div>
                  <div className="rounded-lg bg-[rgba(245,158,11,0.06)] p-3 text-center">
                    <p className="text-2xl font-bold text-[#f59e0b]">{remaining}</p>
                    <p className="text-[11px] text-[#6b7280]">{locale === 'de' ? 'Offen' : 'Do zrobienia'}</p>
                  </div>
                </div>
                {totalToProcess > 0 && (
                  <div>
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#f3f4f6] dark:bg-[#1f2a37]">
                      {done > 0 && <div className="bg-[#22ad5c] transition-all" style={{ width: `${(done / totalToProcess) * 100}%` }} />}
                      {stz > 0 && <div className="bg-[#3c50e0] transition-all" style={{ width: `${(stz / totalToProcess) * 100}%` }} />}
                    </div>
                    <p className="mt-1.5 text-xs text-[#6b7280]">
                      {done + stz}/{totalToProcess} ({Math.round(((done + stz) / totalToProcess) * 100)}%)
                    </p>
                  </div>
                )}
                {remaining > 0 && (
                  <button
                    onClick={() => navigate('/payroll')}
                    className="w-full rounded-lg bg-[#5750f1] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#4a44d4]"
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

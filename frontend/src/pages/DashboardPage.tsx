import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, FileText, RefreshCw, AlertCircle, ArrowRight, Upload,
  Cloud, Truck, Clock, CreditCard, AlertTriangle,
  Sun, Moon, Sunrise, Sunset,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../hooks/useAuth';
import { fetchDashboard, fetchConnectionStatus, scanCardExpiry } from '../lib/api';
import type { StaleDriver, ExpiringCard } from '../lib/api';
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

export function DashboardPage() {
  const { t, locale } = useI18n();
  const { role } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState<{ dropbox: boolean; samsara: boolean } | null>(null);
  const [showAllStale, setShowAllStale] = useState(false);
  const [showAllExpiring, setShowAllExpiring] = useState(false);
  const [scanning, setScanning] = useState(false);

  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDashboard = () => {
    fetchDashboard()
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    loadDashboard();
    fetchConnectionStatus()
      .then(setConnections)
      .catch(() => {});

    // Auto-refresh every 60s
    refreshRef.current = setInterval(() => {
      fetchDashboard().then(setData).catch(() => {});
      fetchConnectionStatus().then(setConnections).catch(() => {});
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

  if (error) {
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
        return (
          <div className="mb-6 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-surface ${color} transition-colors`}>
              <Icon size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">
                {greeting}, {roleName}
              </h1>
              <p className="text-sm text-muted">{t('dashTitle')}</p>
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
                {visibleStale.map((d) => (
                  <Link
                    key={d.card_number || d.name}
                    to="/drivers"
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
                ))}
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

      {/* Bottom row: sync + quick actions */}
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

        {/* Quick actions */}
        <Card className="p-4 sm:p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
            {t('dashQuickActions')}
          </h3>
          <div className="space-y-1">
            {[
              { to: '/drivers', label: t('dashViewDrivers'), icon: Users, bg: 'bg-primary-50 text-primary-600' },
              { to: '/reader', label: t('dashOpenReader'), icon: FileText, bg: 'bg-accent-light text-accent-dark' },
              { to: '/sync', label: t('dashViewSync'), icon: RefreshCw, bg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' },
            ].map(({ to, label, icon: Icon, bg }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 rounded-xl px-4 py-3 min-h-[44px] text-sm font-medium transition-all hover:bg-surface"
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
                  <Icon size={16} />
                </div>
                <span className="flex-1 text-ink">{label}</span>
                <ArrowRight size={16} className="text-muted" />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, FileText, RefreshCw, AlertCircle, ArrowRight, Upload, Cloud, Truck } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchDashboard, fetchConnectionStatus } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { StatCard, Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import type { DashboardData } from '../types';

export function DashboardPage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState<{ dropbox: boolean; samsara: boolean } | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch((e) => setError(e.message));
    fetchConnectionStatus()
      .then(setConnections)
      .catch(() => {});
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-red-500">
        <AlertCircle size={32} />
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
        <Spinner size="lg" />
        <p>{t('loading')}</p>
      </div>
    );
  }

  const syncBadge = data.last_sync_status === 'ok'
    ? <Badge variant="green" dot>{t('syncOk')}</Badge>
    : data.last_sync_status === 'error'
    ? <Badge variant="red" dot>{t('syncErrorLabel')}</Badge>
    : data.last_sync_status === 'partial'
    ? <Badge variant="orange" dot>{t('syncPartial')}</Badge>
    : <Badge variant="gray">-</Badge>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('dashTitle')}</h1>

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sync info */}
        <Card className="p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('dashSyncStatus')}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">{t('syncStatus')}</span>
              {syncBadge}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">{t('dashLastSync')}</span>
              <span className="text-sm font-medium">{formatDateTime(data.last_sync, locale)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">{t('dashTotalSynced')}</span>
              <span className="text-sm font-medium">{data.synced_count}</span>
            </div>
          </div>
        </Card>

        {/* Quick actions + connections */}
        <Card className="p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('dashQuickActions')}
          </h3>
          <div className="space-y-2">
            {[
              { to: '/drivers', label: t('dashViewDrivers'), icon: Users },
              { to: '/reader', label: t('dashOpenReader'), icon: FileText },
              { to: '/sync', label: t('dashViewSync'), icon: RefreshCw },
            ].map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Icon size={18} className="text-primary-500" />
                <span className="flex-1">{label}</span>
                <ArrowRight size={16} className="text-gray-400" />
              </Link>
            ))}
          </div>

          {/* Connection status */}
          {connections && (
            <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
              <div className="space-y-2">
                <div className="flex items-center gap-3 px-4 py-2">
                  <Cloud size={18} className={connections.dropbox ? 'text-green-500' : 'text-red-400'} />
                  <span className="flex-1 text-sm">{connections.dropbox ? t('dropboxConnected') : t('dropboxDisconnected')}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${connections.dropbox ? 'bg-green-500' : 'bg-red-400'}`} />
                </div>
                <div className="flex items-center gap-3 px-4 py-2">
                  <Truck size={18} className={connections.samsara ? 'text-green-500' : 'text-red-400'} />
                  <span className="flex-1 text-sm">{connections.samsara ? t('samsaraConnected') : t('samsaraDisconnected')}</span>
                  <span className={`h-2.5 w-2.5 rounded-full ${connections.samsara ? 'bg-green-500' : 'bg-red-400'}`} />
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

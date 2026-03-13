import { useEffect, useState, Fragment } from 'react';
import { AlertCircle, CheckCircle, XCircle, MinusCircle, ChevronDown, ChevronUp, Clock, Shield, History } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchSyncLog, fetchLoginHistory, type LoginHistoryEntry } from '../lib/api';
import { formatDateTime, formatBytes } from '../lib/format';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import type { SyncHistoryEntry } from '../types';

function LoginHistorySection() {
  const { t, locale } = useI18n();
  const [history, setHistory] = useState<LoginHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchLoginHistory()
      .then((data) => { setHistory(data.history); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <Spinner />;
  if (error) return <p className="text-sm text-red-500">{error}</p>;

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <History size={18} className="text-primary-500" />
        <h2 className="text-lg font-bold">{t('adminLoginHistory')}</h2>
      </div>
      {history.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('noData')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncDate')}</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminRole')}</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">IP</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminBrowser')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {history.slice(0, 100).map((entry, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500 dark:text-gray-400">{formatDateTime(entry.timestamp, locale)}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <Badge variant={entry.role === 'admin' ? 'red' : 'gray'}>{entry.role}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-gray-500">{entry.ip}</td>
                  <td className="max-w-[300px] truncate px-4 py-2 text-xs text-gray-400">{entry.user_agent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SyncMonitorSection() {
  const { t, locale } = useI18n();
  const [history, setHistory] = useState<SyncHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    fetchSyncLog()
      .then((data) => { setHistory(data.history); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <Spinner />;
  if (error) return <p className="text-sm text-red-500">{error}</p>;

  const last = history[0];
  const totalUploaded = history.reduce((s, h) => s + h.uploaded, 0);
  const totalRuns = history.length;

  const statusIcon = (status: string) => {
    if (status === 'ok') return <CheckCircle size={16} className="text-green-500" />;
    if (status === 'error') return <XCircle size={16} className="text-red-500" />;
    return <MinusCircle size={16} className="text-orange-500" />;
  };

  const statusBadge = (status: string) => {
    if (status === 'ok') return <Badge variant="green" dot>{t('syncOk')}</Badge>;
    if (status === 'error') return <Badge variant="red" dot>{t('syncErrorLabel')}</Badge>;
    if (status === 'partial') return <Badge variant="orange" dot>{t('syncPartial')}</Badge>;
    return <Badge variant="gray">-</Badge>;
  };

  return (
    <div>
      {history.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('syncNoHistory')}</p>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t('syncLastStatus')}
              value={last?.status === 'ok' ? t('syncOk') : last?.status === 'error' ? t('syncErrorLabel') : t('syncPartial')}
              icon={statusIcon(last?.status || '')}
              color={last?.status === 'ok' ? 'green' : last?.status === 'error' ? 'red' : 'orange'}
            />
            <StatCard
              label={t('syncLastRun')}
              value={formatDateTime(last?.timestamp, locale)}
              icon={<Clock size={20} />}
              color="primary"
            />
            <StatCard
              label={t('syncTotalUploaded')}
              value={totalUploaded}
              icon={<CheckCircle size={20} />}
              color="green"
            />
            <StatCard
              label={t('syncTotalRuns')}
              value={totalRuns}
              icon={<AlertCircle size={20} />}
              color="primary"
            />
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncDate')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncStatus')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncFound')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncUploaded')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncErrors')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncFiles')}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {history.map((h, i) => (
                    <Fragment key={i}>
                      <tr
                        onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                        className="cursor-pointer transition hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{formatDateTime(h.timestamp, locale)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{statusBadge(h.status)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{h.found}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold">{h.uploaded}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={h.errors ? 'text-red-500' : 'text-gray-300 dark:text-gray-600'}>{h.errors}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {h.files.length > 0 ? <Badge variant="gray">{h.files.length}</Badge> : '-'}
                        </td>
                        <td className="px-4 py-3">
                          {h.files.length > 0 && (
                            expandedIdx === i ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />
                          )}
                        </td>
                      </tr>
                      {expandedIdx === i && h.files.length > 0 && (
                        <tr key={`${i}-detail`}>
                          <td colSpan={7} className="bg-gray-50 px-6 py-3 dark:bg-gray-800/30">
                            <div className="space-y-1.5">
                              {h.files.map((f, fi) => (
                                <div key={fi} className="flex items-center gap-3 text-xs">
                                  {f.status === 'ok'
                                    ? <CheckCircle size={14} className="flex-shrink-0 text-green-500" />
                                    : <XCircle size={14} className="flex-shrink-0 text-red-500" />}
                                  <span className="min-w-[120px] font-medium text-gray-500">{f.driver}</span>
                                  <span className="flex-1 font-medium">{f.file}</span>
                                  {f.size && <span className="text-gray-400">{formatBytes(f.size)}</span>}
                                  {f.error && <span className="text-red-500">{f.error}</span>}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export function AdminPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Shield size={24} className="text-red-500" />
        <h1 className="text-2xl font-bold tracking-tight">{t('adminTitle')}</h1>
      </div>

      {/* Login history */}
      <LoginHistorySection />

      {/* Sync monitor */}
      <div>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
          <Clock size={18} className="text-primary-500" />
          {t('syncTitle')}
        </h2>
        <SyncMonitorSection />
      </div>
    </div>
  );
}

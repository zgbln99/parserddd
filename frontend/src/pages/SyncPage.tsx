import { useEffect, useState, Fragment } from 'react';
import { AlertCircle, CheckCircle, XCircle, MinusCircle, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchSyncLog } from '../lib/api';
import { formatDateTime, formatBytes } from '../lib/format';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import type { SyncHistoryEntry } from '../types';

export function SyncPage() {
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

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
        <Spinner size="lg" />
        <p>{t('loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-red-500">
        <AlertCircle size={32} />
        <p>{error}</p>
      </div>
    );
  }

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
    <div className="animate-slide-up">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('syncTitle')}</h1>

      {history.length === 0 ? (
        <p className="py-20 text-center text-gray-400">{t('syncNoHistory')}</p>
      ) : (
        <>
          {/* Stats */}
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

          {/* History table */}
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

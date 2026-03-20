import { useEffect, useState, Fragment } from 'react';
import { AlertCircle, CheckCircle, XCircle, MinusCircle, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchSyncLog } from '../lib/api';
import { formatDateTime, formatBytes } from '../lib/format';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { MobileCard, CardField } from '../components/MobileCards';
import type { SyncHistoryEntry } from '../types';

export function SyncPage() {
  const { t, locale } = useI18n();
  const [history, setHistory] = useState<SyncHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const loadSyncLog = () => {
    setLoading(true);
    setError('');
    fetchSyncLog()
      .then((data) => { setHistory(data.history); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  useEffect(() => {
    loadSyncLog();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-muted">
        <Spinner size="lg" />
        <p>{t('loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-danger animate-fade-in">
        <AlertCircle size={32} />
        <p>{error}</p>
        <button
          onClick={() => { setError(''); loadSyncLog(); }}
          className="btn-press mt-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700"
        >
          {t('tryAgain')}
        </button>
      </div>
    );
  }

  const last = history[0];
  const totalUploaded = history.reduce((s, h) => s + h.uploaded, 0);
  const totalRuns = history.length;

  const statusIcon = (status: string) => {
    if (status === 'ok') return <CheckCircle size={20} className="text-success" />;
    if (status === 'error') return <XCircle size={20} className="text-danger" />;
    return <MinusCircle size={20} className="text-warning" />;
  };

  const statusBadge = (status: string) => {
    if (status === 'ok') return <Badge variant="green" dot>{t('syncOk')}</Badge>;
    if (status === 'error') return <Badge variant="red" dot>{t('syncErrorLabel')}</Badge>;
    if (status === 'partial') return <Badge variant="orange" dot>{t('syncPartial')}</Badge>;
    return <Badge variant="gray">-</Badge>;
  };

  return (
    <div className="animate-slide-up">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-ink">{t('syncTitle')}</h1>

      {history.length === 0 ? (
        <p className="py-20 text-center text-muted">{t('syncNoHistory')}</p>
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

          {/* History - mobile cards */}
          <div className="block sm:hidden space-y-3 p-4">
            {history.map((h, i) => (
              <MobileCard key={i} onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}>
                <CardField label={t('syncDate')} value={formatDateTime(h.timestamp, locale)} />
                <CardField label={t('syncStatus')} value={statusBadge(h.status)} />
                <CardField label={t('syncFound')} value={h.found} />
                <CardField label={t('syncUploaded')} value={<span className="font-bold">{h.uploaded}</span>} />
                <CardField label={t('syncErrors')} value={<span className={h.errors ? 'text-danger' : 'text-muted/30/30'}>{h.errors}</span>} />
                {expandedIdx === i && h.files.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                    {h.files.map((f, fi) => (
                      <div key={fi} className="flex items-center gap-2 text-xs">
                        {f.status === 'ok'
                          ? <CheckCircle size={14} className="flex-shrink-0 text-success" />
                          : <XCircle size={14} className="flex-shrink-0 text-danger" />}
                        <span className="font-medium text-muted">{f.driver}</span>
                        <span className="flex-1 truncate font-medium text-ink">{f.file}</span>
                      </div>
                    ))}
                  </div>
                )}
              </MobileCard>
            ))}
          </div>

          {/* History - desktop table */}
          <Card className="hidden sm:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('syncDate')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('syncStatus')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('syncFound')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('syncUploaded')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('syncErrors')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('syncFiles')}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((h, i) => (
                    <Fragment key={i}>
                      <tr
                        onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                        className="cursor-pointer transition hover:bg-primary-50"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(h.timestamp, locale)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{statusBadge(h.status)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink">{h.found}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-ink">{h.uploaded}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={h.errors ? 'text-danger' : 'text-muted/30/30'}>{h.errors}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {h.files.length > 0 ? <Badge variant="gray">{h.files.length}</Badge> : '-'}
                        </td>
                        <td className="px-4 py-3">
                          {h.files.length > 0 && (
                            expandedIdx === i ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />
                          )}
                        </td>
                      </tr>
                      {expandedIdx === i && h.files.length > 0 && (
                        <tr key={`${i}-detail`}>
                          <td colSpan={7} className="bg-surface px-6 py-3">
                            <div className="space-y-1.5">
                              {h.files.map((f, fi) => (
                                <div key={fi} className="flex items-center gap-3 text-xs">
                                  {f.status === 'ok'
                                    ? <CheckCircle size={14} className="flex-shrink-0 text-success" />
                                    : <XCircle size={14} className="flex-shrink-0 text-danger" />}
                                  <span className="min-w-[120px] font-medium text-muted">{f.driver}</span>
                                  <span className="flex-1 font-medium text-ink">{f.file}</span>
                                  {f.size && <span className="text-muted">{formatBytes(f.size)}</span>}
                                  {f.error && <span className="text-danger">{f.error}</span>}
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

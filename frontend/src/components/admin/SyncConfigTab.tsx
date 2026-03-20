import { useEffect, useState, Fragment } from 'react';
import {
  AlertCircle, CheckCircle, XCircle, MinusCircle, ChevronDown, ChevronUp,
  Clock, Settings,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { fetchSyncLog, fetchConfig, updateConfig, type SyncConfig } from '../../lib/api';
import { formatDateTime, formatBytes } from '../../lib/format';
import { Card, StatCard } from '../Card';
import { Badge } from '../Badge';
import { Spinner } from '../Spinner';
import { MobileCard, CardField } from '../MobileCards';
import type { SyncHistoryEntry } from '../../types';

function SyncConfigSection() {
  const { t } = useI18n();
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [samsaraToken, setSamsaraToken] = useState('');
  const [dropboxToken, setDropboxToken] = useState('');
  const [syncFolder, setSyncFolder] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        setConfig(cfg);
        setSyncFolder(cfg.sync_dest_folder || '/Samsara-DDD');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const data: Record<string, string> = {};
      if (samsaraToken) data.samsara_api_token = samsaraToken;
      if (dropboxToken) data.dropbox_refresh_token = dropboxToken;
      if (syncFolder) data.sync_dest_folder = syncFolder;
      await updateConfig(data);
      setMsg('OK!');
      setSamsaraToken('');
      setDropboxToken('');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: unknown) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Settings size={18} className="text-muted dark:text-muted-dark" />
        <h2 className="text-lg font-bold">{t('adminSyncConfig')}</h2>
      </div>
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <label className="text-xs font-semibold text-muted dark:text-muted-dark sm:w-40 shrink-0">Samsara API Token</label>
          <div className="flex items-center gap-2">
            {config?.samsara_api_token_set
              ? <Badge variant="green" dot>{t('adminConfigSet')}</Badge>
              : <Badge variant="red" dot>{t('adminConfigNotSet')}</Badge>}
            <input
              type="password"
              value={samsaraToken}
              onChange={(e) => setSamsaraToken(e.target.value)}
              placeholder={t('adminNewToken')}
              className="input w-full rounded-xl px-3 py-1.5 text-sm outline-none"
            />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <label className="text-xs font-semibold text-muted dark:text-muted-dark sm:w-40 shrink-0">Dropbox Refresh Token</label>
          <div className="flex items-center gap-2">
            {config?.dropbox_refresh_token_set
              ? <Badge variant="green" dot>{t('adminConfigSet')}</Badge>
              : <Badge variant="red" dot>{t('adminConfigNotSet')}</Badge>}
            <input
              type="password"
              value={dropboxToken}
              onChange={(e) => setDropboxToken(e.target.value)}
              placeholder={t('adminNewToken')}
              className="input w-full rounded-xl px-3 py-1.5 text-sm outline-none"
            />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <label className="text-xs font-semibold text-muted dark:text-muted-dark sm:w-40 shrink-0">{t('adminSyncFolder')}</label>
          <input
            type="text"
            value={syncFolder}
            onChange={(e) => setSyncFolder(e.target.value)}
            className="input w-full rounded-xl px-3 py-1.5 text-sm outline-none"
          />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? '...' : t('save')}
          </button>
          {msg && <span className={`text-sm font-medium ${msg === 'OK!' ? 'text-emerald-600' : 'text-danger'}`}>{msg}</span>}
        </div>
      </div>
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
  if (error) return <p className="text-sm text-danger">{error}</p>;

  const last = history[0];
  const totalUploaded = history.reduce((s, h) => s + h.uploaded, 0);
  const totalRuns = history.length;

  const statusIcon = (status: string) => {
    if (status === 'ok') return <CheckCircle size={16} className="text-success" />;
    if (status === 'error') return <XCircle size={16} className="text-danger" />;
    return <MinusCircle size={16} className="text-amber-500" />;
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
        <p className="py-8 text-center text-sm text-muted dark:text-muted-dark">{t('syncNoHistory')}</p>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t('syncLastStatus')} value={last?.status === 'ok' ? t('syncOk') : last?.status === 'error' ? t('syncErrorLabel') : t('syncPartial')} icon={statusIcon(last?.status || '')} color={last?.status === 'ok' ? 'green' : last?.status === 'error' ? 'red' : 'orange'} />
            <StatCard label={t('syncLastRun')} value={formatDateTime(last?.timestamp, locale)} icon={<Clock size={20} />} color="primary" />
            <StatCard label={t('syncTotalUploaded')} value={totalUploaded} icon={<CheckCircle size={20} />} color="green" />
            <StatCard label={t('syncTotalRuns')} value={totalRuns} icon={<AlertCircle size={20} />} color="primary" />
          </div>
          <div className="block sm:hidden space-y-3 p-4">
            {history.map((h, i) => (
              <MobileCard key={i} onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}>
                <CardField label={t('syncDate')} value={formatDateTime(h.timestamp, locale)} />
                <CardField label={t('syncStatus')} value={statusBadge(h.status)} />
                <CardField label={t('syncFound')} value={h.found} />
                <CardField label={t('syncUploaded')} value={<span className="font-bold">{h.uploaded}</span>} />
                <CardField label={t('syncErrors')} value={<span className={h.errors ? 'text-danger' : 'text-gray-300 dark:text-gray-600'}>{h.errors}</span>} />
                {expandedIdx === i && h.files.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
                    {h.files.map((f, fi) => (
                      <div key={fi} className="flex items-center gap-2 text-xs">
                        {f.status === 'ok' ? <CheckCircle size={14} className="flex-shrink-0 text-success" /> : <XCircle size={14} className="flex-shrink-0 text-danger" />}
                        <span className="font-medium text-muted dark:text-muted-dark">{f.driver}</span>
                        <span className="flex-1 truncate font-medium">{f.file}</span>
                      </div>
                    ))}
                  </div>
                )}
              </MobileCard>
            ))}
          </div>
          <Card className="hidden sm:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-border dark:border-border-dark">
                    {[t('syncDate'), t('syncStatus'), t('syncFound'), t('syncUploaded'), t('syncErrors'), t('syncFiles')].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted dark:text-muted-dark">{h}</th>
                    ))}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border dark:divide-border-dark">
                  {history.map((h, i) => (
                    <Fragment key={i}>
                      <tr onClick={() => setExpandedIdx(expandedIdx === i ? null : i)} className="cursor-pointer transition hover:bg-surface dark:hover:bg-surface-dark">
                        <td className="whitespace-nowrap px-4 py-3 text-muted dark:text-muted-dark">{formatDateTime(h.timestamp, locale)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{statusBadge(h.status)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{h.found}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold">{h.uploaded}</td>
                        <td className="whitespace-nowrap px-4 py-3"><span className={h.errors ? 'text-danger' : 'text-gray-300 dark:text-gray-600'}>{h.errors}</span></td>
                        <td className="whitespace-nowrap px-4 py-3">{h.files.length > 0 ? <Badge variant="gray">{h.files.length}</Badge> : '-'}</td>
                        <td className="px-4 py-3">{h.files.length > 0 && (expandedIdx === i ? <ChevronUp size={14} className="text-muted dark:text-muted-dark" /> : <ChevronDown size={14} className="text-muted dark:text-muted-dark" />)}</td>
                      </tr>
                      {expandedIdx === i && h.files.length > 0 && (
                        <tr key={`${i}-d`}>
                          <td colSpan={7} className="bg-black/[0.02] px-6 py-3 dark:bg-white/5">
                            <div className="space-y-1.5">
                              {h.files.map((f, fi) => (
                                <div key={fi} className="flex items-center gap-3 text-xs">
                                  {f.status === 'ok' ? <CheckCircle size={14} className="flex-shrink-0 text-success" /> : <XCircle size={14} className="flex-shrink-0 text-danger" />}
                                  <span className="min-w-[120px] font-medium text-muted dark:text-muted-dark">{f.driver}</span>
                                  <span className="flex-1 font-medium">{f.file}</span>
                                  {f.size && <span className="text-muted dark:text-muted-dark">{formatBytes(f.size)}</span>}
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

export function SyncConfigTab() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <SyncConfigSection />
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

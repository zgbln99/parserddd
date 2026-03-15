import { useEffect, useState, useMemo } from 'react';
import { Activity, History, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { useI18n } from '../../i18n';
import { fetchLoginHistory, fetchActivityLog, type LoginHistoryEntry, type ActivityLogEntry } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Card } from '../Card';
import { Badge } from '../Badge';
import { Spinner } from '../Spinner';
import { MobileCard, CardField } from '../MobileCards';
import { SkeletonTable } from '../Skeleton';

const ACTIVITY_PAGE_SIZE = 25;

function ActivityLogSection() {
  const { t, locale } = useI18n();
  const [log, setLog] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [filterDate, setFilterDate] = useState('');
  const [filterAction, setFilterAction] = useState('');

  useEffect(() => {
    fetchActivityLog()
      .then((data) => { setLog(data.log); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  // Unique actions for filter dropdown
  const uniqueActions = useMemo(() => {
    const actions = new Set(log.map((e) => e.action));
    return Array.from(actions).sort();
  }, [log]);

  // Filtered log
  const filteredLog = useMemo(() => {
    let result = log;
    if (filterDate) {
      result = result.filter((e) => e.timestamp.startsWith(filterDate));
    }
    if (filterAction) {
      result = result.filter((e) => e.action === filterAction);
    }
    return result;
  }, [log, filterDate, filterAction]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [filterDate, filterAction]);

  if (loading) return <Card className="p-4 sm:p-6"><SkeletonTable rows={5} cols={4} /></Card>;
  if (error) return <p className="text-sm text-rose-500">{error}</p>;

  const totalPages = Math.max(1, Math.ceil(filteredLog.length / ACTIVITY_PAGE_SIZE));
  const pageItems = filteredLog.slice(page * ACTIVITY_PAGE_SIZE, (page + 1) * ACTIVITY_PAGE_SIZE);

  const actionBadge = (action: string) => {
    if (action.startsWith('analyze')) return <Badge variant="blue">{action}</Badge>;
    if (action.startsWith('export')) return <Badge variant="green">{action}</Badge>;
    if (action.startsWith('create') || action.startsWith('delete')) return <Badge variant="red">{action}</Badge>;
    return <Badge variant="gray">{action}</Badge>;
  };

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Activity size={18} className="text-violet-500" />
        <h2 className="text-lg font-bold">{t('adminActivityLog')}</h2>
        <span className="ml-auto text-xs text-gray-400">{filteredLog.length} / {log.length}</span>
      </div>

      {/* Filters */}
      {log.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-black/[0.02] px-3 py-2 dark:bg-white/5">
          <Filter size={14} className="text-gray-400 shrink-0" />
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="glass-input rounded-lg px-2 py-1 text-xs outline-none dark:[color-scheme:dark]"
          />
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="glass-input rounded-lg px-2 py-1 text-xs outline-none"
          >
            <option value="">{t('adminAction')} — {t('dashShowAll')}</option>
            {uniqueActions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          {(filterDate || filterAction) && (
            <button
              onClick={() => { setFilterDate(''); setFilterAction(''); }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-rose-500 transition hover:bg-rose-500/10"
            >
              {t('clear')}
            </button>
          )}
        </div>
      )}

      {filteredLog.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('noData')}</p>
      ) : (
        <>
          <div className="block sm:hidden space-y-3 p-4">
            {pageItems.map((entry, i) => (
              <MobileCard key={page * ACTIVITY_PAGE_SIZE + i}>
                <CardField label={t('adminUser')} value={<span className="font-medium">{entry.username || entry.role}</span>} />
                <CardField label={t('adminAction')} value={actionBadge(entry.action)} />
                <CardField label={t('adminDetail')} value={<span className="text-xs text-gray-500 truncate max-w-[200px] inline-block">{entry.detail}</span>} />
                <CardField label={t('syncDate')} value={formatDateTime(entry.timestamp, locale)} />
              </MobileCard>
            ))}
          </div>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-white/20 dark:border-white/5">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncDate')}</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminUser')}</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminAction')}</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminDetail')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.03] dark:divide-white/[0.03]">
                {pageItems.map((entry, i) => (
                  <tr key={page * ACTIVITY_PAGE_SIZE + i} className="hover:bg-black/[0.03] dark:hover:bg-white/5">
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500 dark:text-gray-400">{formatDateTime(entry.timestamp, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="font-medium">{entry.username || entry.role}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{actionBadge(entry.action)}</td>
                    <td className="max-w-[400px] truncate px-4 py-2 text-xs text-gray-500">{entry.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-black/5 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-white/5"
              >
                <ChevronLeft size={14} />
                {t('pagePrev')}
              </button>
              <span className="text-xs text-gray-500">
                {page + 1} {t('pageOf')} {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-black/5 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-white/5"
              >
                {t('pageNext')}
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

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

  if (loading) return <Card className="p-4 sm:p-6"><SkeletonTable rows={5} cols={5} /></Card>;
  if (error) return <p className="text-sm text-rose-500">{error}</p>;

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <History size={18} className="text-primary-500" />
        <h2 className="text-lg font-bold">{t('adminLoginHistory')}</h2>
      </div>
      {history.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('noData')}</p>
      ) : (
        <>
        <div className="block sm:hidden space-y-3 p-4">
          {history.slice(0, 50).map((entry, i) => (
            <MobileCard key={i}>
              <CardField label={t('adminUser')} value={<span className="font-medium">{entry.username || entry.role}</span>} />
              <CardField label={t('adminRole')} value={<Badge variant={entry.role === 'admin' ? 'red' : 'gray'}>{entry.role}</Badge>} />
              <CardField label={t('adminBrowser')} value={<span className="text-xs text-gray-400 truncate max-w-[200px] inline-block">{entry.user_agent}</span>} />
              <CardField label={t('syncDate')} value={formatDateTime(entry.timestamp, locale)} />
            </MobileCard>
          ))}
        </div>
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-white/20 dark:border-white/5">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncDate')}</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminUser')}</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminRole')}</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">IP</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminBrowser')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.03] dark:divide-white/[0.03]">
              {history.slice(0, 50).map((entry, i) => (
                <tr key={i} className="hover:bg-black/[0.03] dark:hover:bg-white/5">
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500 dark:text-gray-400">{formatDateTime(entry.timestamp, locale)}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-medium">{entry.username || entry.role}</td>
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
        </>
      )}
    </Card>
  );
}

export function LogsTab() {
  return (
    <div className="space-y-6">
      <ActivityLogSection />
      <LoginHistorySection />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Activity, History, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import { fetchLoginHistory, fetchActivityLog, type LoginHistoryEntry, type ActivityLogEntry } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Card } from '../Card';
import { Badge } from '../Badge';
import { Spinner } from '../Spinner';

const ACTIVITY_PAGE_SIZE = 25;

function ActivityLogSection() {
  const { t, locale } = useI18n();
  const [log, setLog] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetchActivityLog()
      .then((data) => { setLog(data.log); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <Spinner />;
  if (error) return <p className="text-sm text-rose-500">{error}</p>;

  const totalPages = Math.max(1, Math.ceil(log.length / ACTIVITY_PAGE_SIZE));
  const pageItems = log.slice(page * ACTIVITY_PAGE_SIZE, (page + 1) * ACTIVITY_PAGE_SIZE);

  const actionBadge = (action: string) => {
    if (action.startsWith('analyze')) return <Badge variant="blue">{action}</Badge>;
    if (action.startsWith('export')) return <Badge variant="green">{action}</Badge>;
    if (action.startsWith('create') || action.startsWith('delete')) return <Badge variant="red">{action}</Badge>;
    return <Badge variant="gray">{action}</Badge>;
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Activity size={18} className="text-violet-500" />
        <h2 className="text-lg font-bold">{t('adminActivityLog')}</h2>
        <span className="ml-auto text-xs text-gray-400">{log.length} total</span>
      </div>
      {log.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('noData')}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
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

  if (loading) return <Spinner />;
  if (error) return <p className="text-sm text-rose-500">{error}</p>;

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <History size={18} className="text-primary-500" />
        <h2 className="text-lg font-bold">{t('adminLoginHistory')}</h2>
      </div>
      {history.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('noData')}</p>
      ) : (
        <div className="overflow-x-auto">
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

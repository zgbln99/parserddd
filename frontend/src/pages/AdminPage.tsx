import { useEffect, useState, Fragment, useCallback } from 'react';
import {
  AlertCircle, CheckCircle, XCircle, MinusCircle, ChevronDown, ChevronUp,
  Clock, Shield, History, Users, Key, Settings, Activity, Trash2, Plus,
  ChevronLeft, ChevronRight, Truck, Radio,
} from 'lucide-react';
import { useI18n } from '../i18n';
import {
  fetchSyncLog, fetchLoginHistory, fetchActivityLog, fetchUsers,
  createUser, deleteUser, changePassword, fetchConfig, updateConfig,
  fetchSamsaraVehicleStats, fetchSamsaraTachographActivity,
  type LoginHistoryEntry, type ActivityLogEntry, type UserEntry, type SyncConfig,
  type SamsaraVehicleStat, type SamsaraDriverActivity,
} from '../lib/api';
import { formatDateTime, formatBytes } from '../lib/format';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import type { SyncHistoryEntry } from '../types';

/* ------------------------------------------------------------------ */
/*  Login History                                                      */
/* ------------------------------------------------------------------ */

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
    <Card className="p-6">
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
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminUser')}</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminRole')}</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">IP</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminBrowser')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {history.slice(0, 50).map((entry, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
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

/* ------------------------------------------------------------------ */
/*  Activity Log                                                       */
/* ------------------------------------------------------------------ */

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
  if (error) return <p className="text-sm text-red-500">{error}</p>;

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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('syncDate')}</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminUser')}</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminAction')}</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('adminDetail')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {pageItems.map((entry, i) => (
                  <tr key={page * ACTIVITY_PAGE_SIZE + i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
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
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800"
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
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800"
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

/* ------------------------------------------------------------------ */
/*  User Management                                                    */
/* ------------------------------------------------------------------ */

function UserManagementSection() {
  const { t } = useI18n();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(() => {
    fetchUsers()
      .then((data) => { setUsers(data.users); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleCreate = async () => {
    if (!newName.trim() || !newPassword) return;
    setSaving(true);
    try {
      await createUser(newName.trim(), newPassword, newRole);
      setNewName('');
      setNewPassword('');
      setNewRole('user');
      setShowForm(false);
      loadUsers();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`${t('adminDeleteUser')}: ${name}?`)) return;
    try {
      await deleteUser(id);
      loadUsers();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  if (loading) return <Spinner />;

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-blue-500" />
          <h2 className="text-lg font-bold">{t('adminUsers')}</h2>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-700"
        >
          <Plus size={14} />
          {t('adminAddUser')}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {showForm && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">{t('adminUserName')}</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              placeholder="Jan Kowalski"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">{t('password')}</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">{t('adminRole')}</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? '...' : t('save')}
          </button>
        </div>
      )}

      {users.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">{t('adminNoUsers')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">ID</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('adminUserName')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('adminRole')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('syncDate')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-400">{u.id}</td>
                  <td className="px-4 py-2 font-medium">{u.name}</td>
                  <td className="px-4 py-2">
                    <Badge variant={u.role === 'admin' ? 'red' : 'gray'}>{u.role}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{u.created ? new Date(u.created).toLocaleDateString() : ''}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleDelete(u.id, u.name)}
                      className="rounded p-1 text-red-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Password Change                                                    */
/* ------------------------------------------------------------------ */

function PasswordChangeSection() {
  const { t } = useI18n();
  const [target, setTarget] = useState<'portal' | 'admin'>('portal');
  const [pw, setPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSubmit = async () => {
    if (!pw) return;
    setSaving(true);
    setMsg('');
    try {
      await changePassword(target, pw);
      setMsg('OK!');
      setPw('');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: unknown) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Key size={18} className="text-orange-500" />
        <h2 className="text-lg font-bold">{t('adminChangePassword')}</h2>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPasswordTarget')}</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as 'portal' | 'admin')}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <option value="portal">{t('adminPortalPassword')}</option>
            <option value="admin">{t('adminAdminPassword')}</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500">{t('adminNewPassword')}</label>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={saving || !pw}
          className="rounded-lg bg-orange-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50"
        >
          {saving ? '...' : t('save')}
        </button>
        {msg && <span className={`text-sm font-medium ${msg === 'OK!' ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Sync Config                                                        */
/* ------------------------------------------------------------------ */

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
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Settings size={18} className="text-gray-500" />
        <h2 className="text-lg font-bold">{t('adminSyncConfig')}</h2>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <label className="w-40 text-xs font-semibold text-gray-500">Samsara API Token</label>
          <div className="flex items-center gap-2">
            {config?.samsara_api_token_set
              ? <Badge variant="green" dot>{t('adminConfigSet')}</Badge>
              : <Badge variant="red" dot>{t('adminConfigNotSet')}</Badge>}
            <input
              type="password"
              value={samsaraToken}
              onChange={(e) => setSamsaraToken(e.target.value)}
              placeholder={t('adminNewToken')}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="w-40 text-xs font-semibold text-gray-500">Dropbox Refresh Token</label>
          <div className="flex items-center gap-2">
            {config?.dropbox_refresh_token_set
              ? <Badge variant="green" dot>{t('adminConfigSet')}</Badge>
              : <Badge variant="red" dot>{t('adminConfigNotSet')}</Badge>}
            <input
              type="password"
              value={dropboxToken}
              onChange={(e) => setDropboxToken(e.target.value)}
              placeholder={t('adminNewToken')}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="w-40 text-xs font-semibold text-gray-500">{t('adminSyncFolder')}</label>
          <input
            type="text"
            value={syncFolder}
            onChange={(e) => setSyncFolder(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gray-700 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-600 dark:hover:bg-gray-500"
          >
            {saving ? '...' : t('save')}
          </button>
          {msg && <span className={`text-sm font-medium ${msg === 'OK!' ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Sync Monitor                                                       */
/* ------------------------------------------------------------------ */

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
            <StatCard label={t('syncLastStatus')} value={last?.status === 'ok' ? t('syncOk') : last?.status === 'error' ? t('syncErrorLabel') : t('syncPartial')} icon={statusIcon(last?.status || '')} color={last?.status === 'ok' ? 'green' : last?.status === 'error' ? 'red' : 'orange'} />
            <StatCard label={t('syncLastRun')} value={formatDateTime(last?.timestamp, locale)} icon={<Clock size={20} />} color="primary" />
            <StatCard label={t('syncTotalUploaded')} value={totalUploaded} icon={<CheckCircle size={20} />} color="green" />
            <StatCard label={t('syncTotalRuns')} value={totalRuns} icon={<AlertCircle size={20} />} color="primary" />
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                    {[t('syncDate'), t('syncStatus'), t('syncFound'), t('syncUploaded'), t('syncErrors'), t('syncFiles')].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{h}</th>
                    ))}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {history.map((h, i) => (
                    <Fragment key={i}>
                      <tr onClick={() => setExpandedIdx(expandedIdx === i ? null : i)} className="cursor-pointer transition hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{formatDateTime(h.timestamp, locale)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{statusBadge(h.status)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{h.found}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold">{h.uploaded}</td>
                        <td className="whitespace-nowrap px-4 py-3"><span className={h.errors ? 'text-red-500' : 'text-gray-300 dark:text-gray-600'}>{h.errors}</span></td>
                        <td className="whitespace-nowrap px-4 py-3">{h.files.length > 0 ? <Badge variant="gray">{h.files.length}</Badge> : '-'}</td>
                        <td className="px-4 py-3">{h.files.length > 0 && (expandedIdx === i ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />)}</td>
                      </tr>
                      {expandedIdx === i && h.files.length > 0 && (
                        <tr key={`${i}-d`}>
                          <td colSpan={7} className="bg-gray-50 px-6 py-3 dark:bg-gray-800/30">
                            <div className="space-y-1.5">
                              {h.files.map((f, fi) => (
                                <div key={fi} className="flex items-center gap-3 text-xs">
                                  {f.status === 'ok' ? <CheckCircle size={14} className="flex-shrink-0 text-green-500" /> : <XCircle size={14} className="flex-shrink-0 text-red-500" />}
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

/* ------------------------------------------------------------------ */
/*  Samsara — Vehicle Stats                                            */
/* ------------------------------------------------------------------ */

function SamsaraVehicleStatsSection() {
  const { t, locale } = useI18n();
  const [vehicles, setVehicles] = useState<SamsaraVehicleStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSamsaraVehicleStats()
      .then((data) => { setVehicles(data.vehicles); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <Spinner />;
  if (error) return <p className="text-sm text-red-500">{error}</p>;

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Truck size={18} className="text-blue-500" />
        <h2 className="text-lg font-bold">{t('samsaraVehicleStats')}</h2>
        <span className="ml-auto text-xs text-gray-400">{vehicles.length} total</span>
      </div>
      {vehicles.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('samsaraNoVehicles')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('samsaraVehicle')}</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('samsaraOdometer')}</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('samsaraFuel')}</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('samsaraEngine')}</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('samsaraLastUpdate')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {vehicles.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="whitespace-nowrap px-4 py-2 font-medium">{v.name}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-sm">
                    {v.odometerKm != null ? v.odometerKm.toLocaleString(locale === 'de' ? 'de-DE' : 'pl-PL') : '-'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {v.fuelPercent != null ? (
                      <span className={`font-semibold ${v.fuelPercent < 20 ? 'text-red-500' : v.fuelPercent < 40 ? 'text-orange-500' : 'text-green-600'}`}>
                        {v.fuelPercent}%
                      </span>
                    ) : '-'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-center">
                    {v.engineState != null ? (
                      <Badge variant={v.engineState === 'On' ? 'green' : 'gray'} dot>
                        {v.engineState === 'On' ? t('samsaraEngineOn') : t('samsaraEngineOff')}
                      </Badge>
                    ) : '-'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">
                    {formatDateTime(v.odometerTime || v.fuelTime || v.engineTime || '', locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Samsara — Tachograph Activity                                      */
/* ------------------------------------------------------------------ */

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function SamsaraTachographActivitySection() {
  const { t, locale } = useI18n();
  const [drivers, setDrivers] = useState<SamsaraDriverActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);

  // Default: last 7 days
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const [startDate, setStartDate] = useState(weekAgo.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(today.toISOString().slice(0, 10));

  const loadActivity = useCallback(() => {
    setLoading(true);
    setError('');
    const startTime = `${startDate}T00:00:00Z`;
    const endTime = `${endDate}T23:59:59Z`;
    fetchSamsaraTachographActivity(startTime, endTime)
      .then((data) => { setDrivers(data.drivers); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [startDate, endDate]);

  const stateLabel = (state: string) => {
    if (state === 'DRIVING') return t('samsaraDriving');
    if (state === 'WORK') return t('samsaraWork');
    if (state === 'BREAK/REST') return t('samsaraBreakRest');
    if (state === 'AVAILABILITY') return t('samsaraAvailability');
    return state;
  };

  const stateBadgeVariant = (state: string): 'blue' | 'green' | 'orange' | 'gray' | 'red' => {
    if (state === 'DRIVING') return 'blue';
    if (state === 'WORK') return 'green';
    if (state === 'BREAK/REST') return 'orange';
    if (state === 'AVAILABILITY') return 'gray';
    return 'gray';
  };

  const driverSummary = (activities: SamsaraDriverActivity['activity']) => {
    let driving = 0, work = 0, breakRest = 0;
    for (const a of activities) {
      if (!a.startTime || !a.endTime) continue;
      const mins = (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60000;
      if (a.state === 'DRIVING') driving += mins;
      else if (a.state === 'WORK') work += mins;
      else if (a.state === 'BREAK/REST') breakRest += mins;
    }
    return { driving, work, breakRest };
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Radio size={18} className="text-emerald-500" />
        <h2 className="text-lg font-bold">{t('samsaraTachoActivity')}</h2>
      </div>

      {/* Date filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500">{t('detailFrom')}</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500">{t('detailTo')}</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          />
        </div>
        <button
          onClick={loadActivity}
          disabled={loading}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? '...' : t('samsaraLoadActivity')}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {loading ? (
        <Spinner />
      ) : drivers.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('samsaraNoActivity')}</p>
      ) : (
        <div className="space-y-3">
          {drivers.map((d) => {
            const summary = driverSummary(d.activity);
            const isExpanded = expandedDriver === d.driverId;
            return (
              <div key={d.driverId} className="rounded-lg border border-gray-100 dark:border-gray-800">
                {/* Driver header with summary */}
                <button
                  onClick={() => setExpandedDriver(isExpanded ? null : d.driverId)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <span className="font-semibold">{d.driverName}</span>
                  <span className="ml-auto flex items-center gap-4 text-xs">
                    <span className="text-blue-600" title={t('samsaraTotalDriving')}>
                      {t('samsaraDriving')}: <strong>{formatMinutes(summary.driving)}</strong>
                    </span>
                    <span className="text-green-600" title={t('samsaraTotalWork')}>
                      {t('samsaraWork')}: <strong>{formatMinutes(summary.work)}</strong>
                    </span>
                    <span className="text-orange-500" title={t('samsaraTotalBreak')}>
                      {t('samsaraBreakRest')}: <strong>{formatMinutes(summary.breakRest)}</strong>
                    </span>
                    <Badge variant="gray">{d.activity.length}</Badge>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>

                {/* Expanded activity list */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800">
                    <div className="max-h-[400px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50/80 dark:bg-gray-900/50">
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-gray-500">{t('samsaraState')}</th>
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-gray-500">{t('samsaraStart')}</th>
                            <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-gray-500">{t('samsaraEnd')}</th>
                            <th className="px-3 py-2 text-right font-semibold uppercase tracking-wider text-gray-500">{t('samsaraDuration')}</th>
                            <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-gray-500">{t('samsaraManual')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                          {d.activity.map((a, i) => {
                            const mins = a.startTime && a.endTime
                              ? (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60000
                              : 0;
                            return (
                              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <td className="whitespace-nowrap px-3 py-1.5">
                                  <Badge variant={stateBadgeVariant(a.state)}>{stateLabel(a.state)}</Badge>
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-gray-500">{formatDateTime(a.startTime, locale)}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-gray-500">{formatDateTime(a.endTime, locale)}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono">{formatMinutes(mins)}</td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-center">
                                  {a.isManualEntry && <Badge variant="orange">M</Badge>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin Page — tabbed layout                                         */
/* ------------------------------------------------------------------ */

type AdminTab = 'users' | 'security' | 'sync' | 'logs' | 'samsara';

const tabs: { key: AdminTab; icon: typeof Users; labelKey: string; color: string }[] = [
  { key: 'users', icon: Users, labelKey: 'adminUsers', color: 'text-blue-500' },
  { key: 'security', icon: Key, labelKey: 'adminChangePassword', color: 'text-orange-500' },
  { key: 'sync', icon: Settings, labelKey: 'adminSyncConfig', color: 'text-gray-500' },
  { key: 'logs', icon: Activity, labelKey: 'adminActivityLog', color: 'text-violet-500' },
  { key: 'samsara', icon: Truck, labelKey: 'samsaraTab', color: 'text-emerald-500' },
];

export function AdminPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/20">
          <Shield size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('adminTitle')}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">System & Security</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
        {tabs.map(({ key, icon: Icon, labelKey, color }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              activeTab === key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            <Icon size={16} className={activeTab === key ? color : ''} />
            <span className="hidden sm:inline">{t(labelKey as never)}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'users' && <UserManagementSection />}
        {activeTab === 'security' && <PasswordChangeSection />}
        {activeTab === 'sync' && (
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
        )}
        {activeTab === 'logs' && (
          <div className="space-y-6">
            <ActivityLogSection />
            <LoginHistorySection />
          </div>
        )}
        {activeTab === 'samsara' && (
          <div className="space-y-6">
            <SamsaraVehicleStatsSection />
            <SamsaraTachographActivitySection />
          </div>
        )}
      </div>
    </div>
  );
}

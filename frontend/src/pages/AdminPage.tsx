import { useEffect, useState, Fragment, useCallback } from 'react';
import {
  AlertCircle, CheckCircle, XCircle, MinusCircle, ChevronDown, ChevronUp,
  Clock, Shield, History, Users, Key, Settings, Activity, Trash2, Plus,
} from 'lucide-react';
import { useI18n } from '../i18n';
import {
  fetchSyncLog, fetchLoginHistory, fetchActivityLog, fetchUsers,
  createUser, deleteUser, changePassword, fetchConfig, updateConfig,
  fetchDriverConfigs, deleteDriverConfig,
  type LoginHistoryEntry, type ActivityLogEntry, type UserEntry, type SyncConfig,
  type DriverConfig,
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
              {history.slice(0, 50).map((entry, i) => (
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

/* ------------------------------------------------------------------ */
/*  Activity Log                                                       */
/* ------------------------------------------------------------------ */

function ActivityLogSection() {
  const { t, locale } = useI18n();
  const [log, setLog] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchActivityLog()
      .then((data) => { setLog(data.log); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <Spinner />;
  if (error) return <p className="text-sm text-red-500">{error}</p>;

  const actionBadge = (action: string) => {
    if (action.startsWith('analyze')) return <Badge variant="blue">{action}</Badge>;
    if (action.startsWith('export')) return <Badge variant="green">{action}</Badge>;
    if (action.startsWith('create') || action.startsWith('delete')) return <Badge variant="red">{action}</Badge>;
    return <Badge variant="gray">{action}</Badge>;
  };

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Activity size={18} className="text-violet-500" />
        <h2 className="text-lg font-bold">{t('adminActivityLog')}</h2>
      </div>
      {log.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('noData')}</p>
      ) : (
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
              {log.slice(0, 100).map((entry, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
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
    <Card>
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
    <Card>
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
    <Card>
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
/*  Driver Config Management                                           */
/* ------------------------------------------------------------------ */

function DriverConfigSection() {
  const { t } = useI18n();
  const [configs, setConfigs] = useState<DriverConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchDriverConfigs()
      .then((data) => { setConfigs(data.configs); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`${t('adminDeleteUser')}: ${name}?`)) return;
    try {
      await deleteDriverConfig(id);
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  if (loading) return <Spinner />;

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Settings size={18} className="text-green-500" />
        <h2 className="text-lg font-bold">{t('driverConfigs')}</h2>
        <Badge variant="gray">{configs.length}</Badge>
      </div>
      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
      {configs.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">{t('driverNoConfigs')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('driversName')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('driversCardNumber')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('driverPersonalNr')}</th>
                <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">{t('driverDoubleDiet')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('driverDietRate')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">{t('driverNotes')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {configs.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-2 font-medium">{c.driver_name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{c.card_number}</td>
                  <td className="px-4 py-2">{c.personal_nr || '—'}</td>
                  <td className="px-4 py-2 text-center">
                    {c.double_diet ? <Badge variant="green">{t('yes')}</Badge> : <span className="text-gray-300 dark:text-gray-600">{t('no')}</span>}
                  </td>
                  <td className="px-4 py-2">{c.diet_rate} EUR</td>
                  <td className="max-w-[200px] truncate px-4 py-2 text-xs text-gray-500">{c.notes || '—'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleDelete(c.id!, c.driver_name)}
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
/*  Admin Page                                                         */
/* ------------------------------------------------------------------ */

export function AdminPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Shield size={24} className="text-red-500" />
        <h1 className="text-2xl font-bold tracking-tight">{t('adminTitle')}</h1>
      </div>

      {/* User management */}
      <UserManagementSection />

      {/* Password change */}
      <PasswordChangeSection />

      {/* Sync config */}
      <SyncConfigSection />

      {/* Driver configs */}
      <DriverConfigSection />

      {/* Activity log */}
      <ActivityLogSection />

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

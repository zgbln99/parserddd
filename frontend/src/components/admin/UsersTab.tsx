import { useEffect, useState, useCallback, Fragment } from 'react';
import { Users, Trash2, Plus, Pencil, Save, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import {
  fetchUsers, createUser, deleteUser, updateUser, fetchRoles,
  type UserEntry,
} from '../../lib/api';
import { Card } from '../Card';
import { Badge } from '../Badge';
import { Spinner } from '../Spinner';
import { MobileCard } from '../MobileCards';
import { ConfirmDialog } from '../ConfirmDialog';
import { useToast } from '../Toast';

const FEATURE_LABELS_PL: Record<string, string> = {
  dashboard: 'Dashboard',
  drivers: 'Kierowcy',
  reader: 'Czytnik (upload DDD)',
  analysis: 'Analiza',
  compare: 'Porównanie kierowców',
  settlement: 'Rozliczenie',
  vehicles: 'Pojazdy',
  driver_km: 'KM kierowców',
  toll: 'Toll Collect (Maut)',
  samsara_km: 'Samsara KM',
  config: 'Ustawienia globalne',
  night_sim: 'Symulator nocnych',
  admin: 'Panel admina',
  sync: 'Synchronizacja',
  verstosse: 'Wykroczenia',
  export: 'Eksporty',
  ddd_preview: 'Podgląd DDD',
};
const FEATURE_LABELS_DE: Record<string, string> = {
  dashboard: 'Dashboard',
  drivers: 'Fahrer',
  reader: 'DDD-Leser (Upload)',
  analysis: 'Analyse',
  compare: 'Fahrer-Vergleich',
  settlement: 'Abrechnung',
  vehicles: 'Fahrzeuge',
  driver_km: 'Fahrer-KM',
  toll: 'Toll Collect (Maut)',
  samsara_km: 'Samsara KM',
  config: 'Globale Einstellungen',
  night_sim: 'Nacht-Simulator',
  admin: 'Admin-Panel',
  sync: 'Synchronisation',
  verstosse: 'Verstöße',
  export: 'Exporte',
  ddd_preview: 'DDD-Vorschau',
};

const ROLE_OPTIONS = ['driver', 'user', 'dispatcher', 'admin'] as const;

export function UsersTab() {
  const { t, locale } = useI18n();
  const FEATURE_LABELS = locale === 'de' ? FEATURE_LABELS_DE : FEATURE_LABELS_PL;
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);

  // Inline edit state for a single user.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState('user');
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [editPassword, setEditPassword] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const { toast } = useToast();

  const loadUsers = useCallback(() => {
    fetchUsers()
      .then((data) => { setUsers(data.users); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => {
    fetchRoles().then((r) => setRolePerms(r.roles || {})).catch(() => {});
  }, []);

  const allFeatures = Object.keys(FEATURE_LABELS);

  const startEdit = (u: UserEntry) => {
    setEditingId(u.id);
    setEditRole(u.role || 'user');
    setEditPerms([...(u.permissions || [])]);
    setEditPassword('');
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (editingId == null) return;
    setEditSaving(true);
    try {
      const patch: { role: string; permissions: string[]; password?: string } = {
        role: editRole,
        permissions: editPerms,
      };
      if (editPassword) patch.password = editPassword;
      await updateUser(editingId, patch);
      toast(t('save'), 'success');
      setEditingId(null);
      loadUsers();
    } catch (e: unknown) {
      toast((e as Error).message, 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const togglePerm = (key: string) => {
    setEditPerms((cur) => cur.includes(key) ? cur.filter((p) => p !== key) : [...cur, key]);
  };

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
      toast(t('monthlySaved'), 'success');
    } catch (e: unknown) {
      setError((e as Error).message);
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: number, name: string) => setConfirmDelete({ id, name });

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteUser(confirmDelete.id);
      loadUsers();
      toast(`${confirmDelete.name} — ${t('adminDeleteUser')}`, 'success');
    } catch (e: unknown) {
      setError((e as Error).message);
      toast((e as Error).message, 'error');
    } finally {
      setConfirmDelete(null);
    }
  };

  if (loading) return <Spinner />;

  const editForm = (
    <div className="space-y-3 rounded-lg bg-[#f7f9fc] p-4 dark:bg-[#1f2a37]">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">{t('adminRole')}</label>
          <select
            value={editRole}
            onChange={(e) => setEditRole(e.target.value)}
            className="input rounded-lg px-3 py-1.5 text-sm outline-none"
          >
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs font-semibold text-muted">
            {t('adminNewPassword')}
          </label>
          <input
            type="password"
            value={editPassword}
            onChange={(e) => setEditPassword(e.target.value)}
            placeholder={t('adminLeaveBlankUnchanged')}
            className="input w-full rounded-lg px-3 py-1.5 text-sm outline-none"
          />
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-muted">{t('adminPermissions')}</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {allFeatures.map((key) => {
            const fromRole = (rolePerms[editRole] || []).includes(key);
            const checked = fromRole || editPerms.includes(key);
            return (
              <label
                key={key}
                className={`flex items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer hover:bg-surface ${fromRole ? 'opacity-70' : ''}`}
                title={fromRole ? t('adminFromRole') : ''}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={fromRole}
                  onChange={() => togglePerm(key)}
                  className="rounded border-gray-300"
                />
                <span className={checked ? 'font-medium' : ''}>{FEATURE_LABELS[key] || key}</span>
                {fromRole && <span className="text-[9px] uppercase tracking-wider text-muted">role</span>}
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={saveEdit}
          disabled={editSaving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
        >
          <Save size={14} />
          {editSaving ? '...' : t('save')}
        </button>
        <button
          onClick={cancelEdit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface"
        >
          <X size={14} />
          {t('cancel')}
        </button>
      </div>
    </div>
  );

  return (
    <Card className="p-4 sm:p-6">
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

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {showForm && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-[#f7f9fc] p-4 dark:bg-[#1f2a37]">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('adminUserName')}</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="input rounded-xl px-3 py-1.5 text-sm outline-none"
              placeholder="Jan Kowalski"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('password')}</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input rounded-xl px-3 py-1.5 text-sm outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">{t('adminRole')}</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="input rounded-xl px-3 py-1.5 text-sm outline-none"
            >
              <option value="driver">{t('roleDriver')}</option>
              <option value="user">User</option>
              <option value="dispatcher">{t('roleDispatcher')}</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="rounded-lg bg-[#30d158] px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '...' : t('save')}
          </button>
        </div>
      )}

      {users.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('adminNoUsers')}</p>
      ) : (
        <>
        <div className="block sm:hidden space-y-3 p-4">
          {users.map((u) => (
            <MobileCard key={u.id}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{u.name}</span>
                  <span className="ml-2">
                    <Badge variant={u.role === 'admin' ? 'red' : u.role === 'dispatcher' ? 'blue' : u.role === 'driver' ? 'green' : 'gray'}>{u.role}</Badge>
                  </span>
                  {(u.permissions || []).length > 0 && (
                    <span className="ml-2 text-[10px] text-muted">+{u.permissions.length}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(u)}
                    className="rounded p-1 text-primary-600 transition hover:bg-primary-500/10"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(u.id, u.name)}
                    className="rounded p-1 text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:bg-rose-500/10"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {editingId === u.id && <div className="mt-3">{editForm}</div>}
            </MobileCard>
          ))}
        </div>
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">ID</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('adminUserName')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('adminRole')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('adminPermissions')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('syncDate')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <Fragment key={u.id}>
                  <tr className="hover:bg-surface">
                    <td className="px-4 py-2 font-mono text-xs text-muted">{u.id}</td>
                    <td className="px-4 py-2 font-medium">{u.name}</td>
                    <td className="px-4 py-2">
                      <Badge variant={u.role === 'admin' ? 'red' : u.role === 'dispatcher' ? 'blue' : u.role === 'driver' ? 'green' : 'gray'}>{u.role}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {(u.permissions || []).length === 0
                        ? <span className="opacity-50">—</span>
                        : (u.permissions || []).map((p) => (
                            <Badge key={p} variant="gray">{FEATURE_LABELS[p] || p}</Badge>
                          ))}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">{u.created ? new Date(u.created).toLocaleDateString() : ''}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => editingId === u.id ? cancelEdit() : startEdit(u)}
                          className="rounded p-1 text-primary-600 transition hover:bg-primary-500/10"
                          title={t('adminEditUser')}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(u.id, u.name)}
                          className="rounded p-1 text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:bg-rose-500/10"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === u.id && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3">{editForm}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('adminDeleteUser')}
        message={`${t('confirmDelete')} ${confirmDelete?.name}?`}
        confirmLabel={t('adminDeleteUser')}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </Card>
  );
}

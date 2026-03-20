import { useEffect, useState, useCallback } from 'react';
import { Users, Trash2, Plus } from 'lucide-react';
import { useI18n } from '../../i18n';
import { fetchUsers, createUser, deleteUser, type UserEntry } from '../../lib/api';
import { Card } from '../Card';
import { Badge } from '../Badge';
import { Spinner } from '../Spinner';
import { MobileCard, CardField } from '../MobileCards';
import { ConfirmDialog } from '../ConfirmDialog';
import { useToast } from '../Toast';

export function UsersTab() {
  const { t } = useI18n();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const { toast } = useToast();

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
      toast(t('monthlySaved'), 'success');
    } catch (e: unknown) {
      setError((e as Error).message);
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    setConfirmDelete({ id, name });
  };

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
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-black/[0.02] p-4 dark:bg-white/5">
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
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-primary-700 disabled:opacity-50"
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
                  <span className="ml-2"><Badge variant={u.role === 'admin' ? 'red' : 'gray'}>{u.role}</Badge></span>
                </div>
                <button
                  onClick={() => handleDelete(u.id, u.name)}
                  className="rounded p-1 text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:bg-rose-500/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>
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
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('syncDate')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface">
                  <td className="px-4 py-2 font-mono text-xs text-muted">{u.id}</td>
                  <td className="px-4 py-2 font-medium">{u.name}</td>
                  <td className="px-4 py-2">
                    <Badge variant={u.role === 'admin' ? 'red' : 'gray'}>{u.role}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{u.created ? new Date(u.created).toLocaleDateString() : ''}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleDelete(u.id, u.name)}
                      className="rounded p-1 text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:bg-rose-500/10"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
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

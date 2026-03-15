import { useState } from 'react';
import { Key } from 'lucide-react';
import { useI18n } from '../../i18n';
import { changePassword } from '../../lib/api';
import { Card } from '../Card';

export function SecurityTab() {
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
        <Key size={18} className="text-amber-500" />
        <h2 className="text-lg font-bold">{t('adminChangePassword')}</h2>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500">{t('adminPasswordTarget')}</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as 'portal' | 'admin')}
            className="glass-input rounded-xl px-3 py-1.5 text-sm outline-none"
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
            className="glass-input rounded-xl px-3 py-1.5 text-sm outline-none"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={saving || !pw}
          className="rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-1.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 transition hover:brightness-110 disabled:opacity-50"
        >
          {saving ? '...' : t('save')}
        </button>
        {msg && <span className={`text-sm font-medium ${msg === 'OK!' ? 'text-emerald-600' : 'text-rose-500'}`}>{msg}</span>}
      </div>
    </Card>
  );
}

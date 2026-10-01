import { useState } from 'react';
import { Key } from 'lucide-react';
import { useI18n } from '../../i18n';
import { changeOwnPassword } from '../../lib/api';
import { Card } from '../Card';

export function SecurityTab() {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSubmit = async () => {
    if (!current || !pw) return;
    if (pw !== pw2) {
      setMsg(t('adminPasswordMismatch'));
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      await changeOwnPassword(current, pw);
      setMsg('OK!');
      setCurrent('');
      setPw('');
      setPw2('');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: unknown) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'input rounded-xl px-3 py-1.5 text-sm outline-none';

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <Key size={18} className="text-amber-500" />
        <h2 className="text-lg font-bold">{t('adminChangePassword')}</h2>
      </div>
      <p className="mb-4 text-xs text-muted">{t('adminChangePasswordHint')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">{t('adminCurrentPassword')}</label>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">{t('adminNewPassword')}</label>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">{t('adminRepeatPassword')}</label>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputCls} />
        </div>
        <button
          onClick={handleSubmit}
          disabled={saving || !current || !pw}
          className="rounded-lg bg-warning px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? '...' : t('save')}
        </button>
        {msg && <span className={`text-sm font-medium ${msg === 'OK!' ? 'text-emerald-600' : 'text-danger'}`}>{msg}</span>}
      </div>
    </Card>
  );
}

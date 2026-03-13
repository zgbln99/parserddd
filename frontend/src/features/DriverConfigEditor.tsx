import { useState, useEffect, useCallback } from 'react';
import { Settings, Save, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchDriverConfig, saveDriverConfig, type DriverConfig } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Spinner } from '../components/Spinner';

interface Props {
  cardNumber: string;
  driverName: string;
  onClose?: () => void;
  onSaved?: () => void;
}

export function DriverConfigEditor({ cardNumber, driverName, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [personalNr, setPersonalNr] = useState('');
  const [doubleDiet, setDoubleDiet] = useState(false);
  const [dietRate, setDietRate] = useState('14.00');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!cardNumber) return;
    fetchDriverConfig(cardNumber)
      .then((cfg) => {
        setPersonalNr(cfg.personal_nr || '');
        setDoubleDiet(!!cfg.double_diet);
        setDietRate(String(cfg.diet_rate || 14.0));
        setNotes(cfg.notes || '');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [cardNumber]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMsg('');
    try {
      await saveDriverConfig({
        card_number: cardNumber,
        driver_name: driverName,
        personal_nr: personalNr,
        double_diet: doubleDiet ? 1 : 0,
        diet_rate: parseFloat(dietRate) || 14.0,
        notes,
      });
      setMsg('OK!');
      onSaved?.();
      setTimeout(() => setMsg(''), 3000);
    } catch (e: unknown) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [cardNumber, driverName, personalNr, doubleDiet, dietRate, notes, onSaved]);

  if (loading) return <Spinner />;

  const inputCls = 'rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
  const labelCls = 'text-xs font-semibold text-gray-500 dark:text-gray-400';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-primary-500" />
          <h3 className="font-bold">{t('driverConfig')}</h3>
          <span className="text-xs text-gray-400">{cardNumber}</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>{t('driverPersonalNr')}</label>
          <input
            type="text"
            value={personalNr}
            onChange={(e) => setPersonalNr(e.target.value)}
            placeholder="z.B. 1001"
            className={`mt-1 block w-full ${inputCls}`}
            disabled={!isAdmin}
          />
        </div>
        <div>
          <label className={labelCls}>{t('driverDietRate')} (EUR)</label>
          <input
            type="number"
            step="0.01"
            value={dietRate}
            onChange={(e) => setDietRate(e.target.value)}
            className={`mt-1 block w-full ${inputCls}`}
            disabled={!isAdmin}
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={doubleDiet}
              onChange={(e) => setDoubleDiet(e.target.checked)}
              className="peer sr-only"
              disabled={!isAdmin}
            />
            <div className="h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-green-500 peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-gray-700" />
          </label>
          <span className={labelCls}>{t('driverDoubleDiet')}</span>
        </div>
        <div>
          <label className={labelCls}>{t('driverNotes')}</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('driverNotesPlaceholder')}
            className={`mt-1 block w-full ${inputCls}`}
            disabled={!isAdmin}
          />
        </div>
      </div>

      {isAdmin && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? '...' : t('save')}
          </button>
          {msg && (
            <span className={`text-sm font-medium ${msg === 'OK!' ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>
          )}
        </div>
      )}
    </div>
  );
}

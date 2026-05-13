import { useState, useEffect, useCallback } from 'react';
import { Settings, Save, X, History } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchDriverConfig, saveDriverConfig, fetchConfigHistory, type DriverConfig, type ConfigAuditEntry } from '../lib/api';
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
  const [monthlyGross, setMonthlyGross] = useState('0');
  const [night40Enabled, setNight40Enabled] = useState(true);
  const [charterEnabled, setCharterEnabled] = useState(false);
  const [notes, setNotes] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ConfigAuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!cardNumber) return;
    fetchDriverConfig(cardNumber)
      .then((cfg) => {
        setPersonalNr(cfg.personal_nr || '');
        setDoubleDiet(!!cfg.double_diet);
        setDietRate(String(cfg.diet_rate || 14.0));
        setMonthlyGross(String(cfg.monthly_gross_eur ?? 0));
        setNight40Enabled(cfg.night_40_enabled !== 0);
        setCharterEnabled(cfg.charter_enabled === 1);
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
        monthly_gross_eur: parseFloat(monthlyGross) || 0,
        night_40_enabled: night40Enabled ? 1 : 0,
        charter_enabled: charterEnabled ? 1 : 0,
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
  }, [cardNumber, driverName, personalNr, doubleDiet, dietRate, monthlyGross, night40Enabled, charterEnabled, notes, onSaved]);

  if (loading) return <Spinner />;

  const inputCls = 'rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
  const labelCls = 'text-xs font-semibold text-muted';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-primary-500" />
          <h3 className="font-bold">{t('driverConfig')}</h3>
          <span className="text-xs text-muted">{cardNumber}</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-gray-100 dark:hover:bg-gray-800">
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
        <div>
          <label className={labelCls}>{t('driverMonthlyGross')}</label>
          <input
            type="number"
            step="50"
            min="0"
            value={monthlyGross}
            onChange={(e) => setMonthlyGross(e.target.value)}
            className={`mt-1 block w-full ${inputCls}`}
            disabled={!isAdmin}
          />
          <p className="mt-1 text-[10px] text-muted">{t('driverMonthlyGrossHint')}</p>
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
        <div className="flex items-center gap-3">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={night40Enabled}
              onChange={(e) => setNight40Enabled(e.target.checked)}
              className="peer sr-only"
              disabled={!isAdmin}
            />
            <div className="h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-green-500 peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-gray-700" />
          </label>
          <span className={labelCls}>{t('driverNight40')}</span>
        </div>
        <div className="flex items-start gap-3">
          <label className="relative inline-flex cursor-pointer items-center mt-0.5">
            <input
              type="checkbox"
              checked={charterEnabled}
              onChange={(e) => setCharterEnabled(e.target.checked)}
              className="peer sr-only"
              disabled={!isAdmin}
            />
            <div className="h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-green-500 peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-gray-700" />
          </label>
          <div className="leading-tight">
            <p className={labelCls}>{t('driverCharter')}</p>
            <p className="text-[10px] text-muted">{t('driverCharterHint')}</p>
          </div>
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
          <button
            onClick={() => {
              if (!showHistory && history.length === 0) {
                setHistoryLoading(true);
                fetchConfigHistory(cardNumber)
                  .then((data) => setHistory(data.entries))
                  .catch(() => {})
                  .finally(() => setHistoryLoading(false));
              }
              setShowHistory(!showHistory);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            <History size={13} />
            {t('configHistory')}
          </button>
          {msg && (
            <span className={`text-sm font-medium ${msg === 'OK!' ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>
          )}
        </div>
      )}

      {showHistory && (
        <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="border-b border-gray-200 px-4 py-2 dark:border-gray-700">
            <h4 className="text-xs font-bold text-muted">{t('configHistory')}</h4>
          </div>
          {historyLoading ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : history.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted">{t('configHistoryEmpty')}</p>
          ) : (
            <div className="max-h-[200px] overflow-y-auto">
              {history.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 border-b border-gray-100 px-4 py-2 last:border-b-0 dark:border-gray-800">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {entry.field_name === '*' ? 'Created' : entry.field_name}
                      {entry.field_name !== '*' && (
                        <span className="ml-1 text-muted">
                          {entry.old_value} → {entry.new_value}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-muted">
                      {t('configChangedBy')}: {entry.changed_by} · {new Date(entry.changed_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

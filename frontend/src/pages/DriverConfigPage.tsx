import { useEffect, useState, useMemo, useCallback, Fragment } from 'react';
import {
  Search, Users, CheckCircle, AlertCircle, Settings,
  ChevronDown, ChevronUp, Save, X, Check,
} from 'lucide-react';
import { useI18n } from '../i18n';
import {
  fetchDrivers, fetchDriverConfigs, saveDriverConfig, bulkUpdateDriverConfig,
  type DriverConfig,
} from '../lib/api';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import type { Driver } from '../types';

interface MergedDriver {
  name: string;
  card_number: string;
  file_count: number;
  config: DriverConfig | null;
}

export function DriverConfigPage() {
  const { t } = useI18n();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [configs, setConfigs] = useState<DriverConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  // Bulk action state
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDietRate, setBulkDietRate] = useState('14.00');
  const [bulkSaving, setBulkSaving] = useState(false);

  // Inline edit state
  const [editPersonalNr, setEditPersonalNr] = useState('');
  const [editDoubleDiet, setEditDoubleDiet] = useState(false);
  const [editDietRate, setEditDietRate] = useState('14.00');
  const [editNotes, setEditNotes] = useState('');

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([fetchDrivers(), fetchDriverConfigs()])
      .then(([dData, cData]) => {
        setDrivers(dData.drivers);
        setConfigs(cData.configs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Merge drivers + configs
  const merged = useMemo<MergedDriver[]>(() => {
    const configMap = new Map<string, DriverConfig>();
    for (const c of configs) configMap.set(c.card_number, c);

    return drivers.map((d) => ({
      name: d.name,
      card_number: d.card_number,
      file_count: d.file_count,
      config: configMap.get(d.card_number) || null,
    }));
  }, [drivers, configs]);

  // Filter
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return merged;
    return merged.filter(
      (d) => d.name.toLowerCase().includes(q) || d.card_number.toLowerCase().includes(q),
    );
  }, [merged, search]);

  // Stats
  const configuredCount = merged.filter((d) => d.config).length;
  const missingCount = merged.length - configuredCount;

  const toggleSelect = (cardNumber: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardNumber)) next.delete(cardNumber);
      else next.add(cardNumber);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d) => d.card_number)));
    }
  };

  const openEditor = (d: MergedDriver) => {
    if (expandedCard === d.card_number) {
      setExpandedCard(null);
      return;
    }
    setExpandedCard(d.card_number);
    setEditPersonalNr(d.config?.personal_nr || '');
    setEditDoubleDiet(!!d.config?.double_diet);
    setEditDietRate(String(d.config?.diet_rate || 14.0));
    setEditNotes(d.config?.notes || '');
    setMsg('');
  };

  const handleSave = async (d: MergedDriver) => {
    setSaving(true);
    setMsg('');
    try {
      await saveDriverConfig({
        card_number: d.card_number,
        driver_name: d.name,
        personal_nr: editPersonalNr,
        double_diet: editDoubleDiet ? 1 : 0,
        diet_rate: parseFloat(editDietRate) || 14.0,
        notes: editNotes,
      });
      setMsg('OK!');
      loadData();
      setTimeout(() => setMsg(''), 2000);
    } catch (e: unknown) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleBulkApply = async () => {
    if (selected.size === 0 || !bulkAction) return;
    setBulkSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (bulkAction === 'double_diet_on') updates.double_diet = 1;
      if (bulkAction === 'double_diet_off') updates.double_diet = 0;
      if (bulkAction === 'set_diet_rate') updates.diet_rate = parseFloat(bulkDietRate) || 14.0;
      await bulkUpdateDriverConfig(Array.from(selected), updates);
      loadData();
      setSelected(new Set());
      setBulkAction('');
    } catch (e: unknown) {
      setMsg((e as Error).message);
    } finally {
      setBulkSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <Spinner size="lg" />
        <p className="text-sm text-gray-400">{t('loading')}</p>
      </div>
    );
  }

  const inputCls = 'rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:focus:ring-primary-900/40';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/20">
          <Users size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('driverConfigPage')}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('driverConfigs')}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t('driverTotalDrivers')}
          value={merged.length}
          icon={<Users size={20} />}
          color="primary"
        />
        <StatCard
          label={t('driverConfiguredCount')}
          value={configuredCount}
          icon={<CheckCircle size={20} />}
          color="green"
        />
        <StatCard
          label={t('driverMissingConfig')}
          value={missingCount}
          icon={<AlertCircle size={20} />}
          color={missingCount > 0 ? 'orange' : 'green'}
        />
      </div>

      {/* Toolbar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('driversSearch')}
              className={`w-full pl-9 ${inputCls}`}
            />
          </div>

          <div className="flex-1" />

          {/* Selection counter */}
          {selected.size > 0 && (
            <span className="rounded-full bg-primary-100 px-3 py-1 text-xs font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
              {selected.size} {t('driverSelected')}
            </span>
          )}

          {/* Bulk actions */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={bulkAction}
                onChange={(e) => setBulkAction(e.target.value)}
                className={`text-xs ${inputCls}`}
              >
                <option value="">{t('driverBulkAction')}...</option>
                <option value="double_diet_on">{t('driverBulkSetDoubleDiet')}</option>
                <option value="double_diet_off">{t('driverBulkRemoveDoubleDiet')}</option>
                <option value="set_diet_rate">{t('driverBulkSetDietRate')}</option>
              </select>
              {bulkAction === 'set_diet_rate' && (
                <input
                  type="number"
                  step="0.01"
                  value={bulkDietRate}
                  onChange={(e) => setBulkDietRate(e.target.value)}
                  className={`w-24 text-xs ${inputCls}`}
                />
              )}
              <button
                onClick={handleBulkApply}
                disabled={!bulkAction || bulkSaving}
                className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
              >
                <Check size={14} />
                {bulkSaving ? '...' : t('driverBulkApply')}
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Driver list */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('driversName')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('driversCardNumber')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('driverPersonalNr')}</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('driverDoubleDiet')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('driverDietRate')}</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('driverConfigStatus')}</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {filtered.map((d) => (
                <Fragment key={d.card_number}>
                  <tr
                    className={`transition hover:bg-gray-50 dark:hover:bg-gray-800/50 ${expandedCard === d.card_number ? 'bg-primary-50/50 dark:bg-primary-900/10' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(d.card_number)}
                        onChange={() => toggleSelect(d.card_number)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">{d.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{d.card_number}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {d.config?.personal_nr ? (
                        <span className="font-medium">{d.config.personal_nr}</span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">&mdash;</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      {d.config?.double_diet
                        ? <Badge variant="green">{t('yes')}</Badge>
                        : <span className="text-gray-300 dark:text-gray-600">{t('no')}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {d.config ? `${d.config.diet_rate.toFixed(2)} EUR` : '14.00 EUR'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      {d.config ? (
                        <Badge variant="green" dot>{t('driverConfigured')}</Badge>
                      ) : (
                        <Badge variant="orange" dot>{t('driverNotConfigured')}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEditor(d)}
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                      >
                        {expandedCard === d.card_number ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </td>
                  </tr>

                  {/* Inline editor */}
                  {expandedCard === d.card_number && (
                    <tr>
                      <td colSpan={8} className="bg-gray-50/80 px-6 py-4 dark:bg-gray-800/50">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">{t('driverPersonalNr')}</label>
                            <input
                              type="text"
                              value={editPersonalNr}
                              onChange={(e) => setEditPersonalNr(e.target.value)}
                              placeholder="z.B. 1001"
                              className={`block w-full ${inputCls}`}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">{t('driverDietRate')} (EUR)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={editDietRate}
                              onChange={(e) => setEditDietRate(e.target.value)}
                              className={`block w-full ${inputCls}`}
                            />
                          </div>
                          <div className="flex items-end gap-3">
                            <label className="relative inline-flex cursor-pointer items-center">
                              <input
                                type="checkbox"
                                checked={editDoubleDiet}
                                onChange={(e) => setEditDoubleDiet(e.target.checked)}
                                className="peer sr-only"
                              />
                              <div className="h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-green-500 peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-gray-700" />
                            </label>
                            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{t('driverDoubleDiet')}</span>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">{t('driverNotes')}</label>
                            <input
                              type="text"
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              placeholder={t('driverNotesPlaceholder')}
                              className={`block w-full ${inputCls}`}
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex items-center gap-3">
                          <button
                            onClick={() => handleSave(d)}
                            disabled={saving}
                            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                          >
                            <Save size={14} />
                            {saving ? '...' : t('save')}
                          </button>
                          <button
                            onClick={() => setExpandedCard(null)}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
                          >
                            <X size={14} />
                            {t('cancel')}
                          </button>
                          {msg && (
                            <span className={`text-sm font-medium ${msg === 'OK!' ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <p className="py-12 text-center text-sm text-gray-400">{t('noData')}</p>
        )}
      </Card>
    </div>
  );
}


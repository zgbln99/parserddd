import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Check, KeyRound, Trash2, Eye, EyeOff, UserPlus } from 'lucide-react';
import { useI18n } from '../../i18n';
import {
  fetchDrivers,
  listDriverProfiles,
  createDriverProfile,
  setDriverProfilePassword,
  toggleDriverProfile,
  deleteDriverProfile,
  type DriverProfileItem,
} from '../../lib/api';
import type { Driver } from '../../types';
import { Spinner } from '../Spinner';

export function DriverProfilesTab() {
  const { t } = useI18n();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [profiles, setProfiles] = useState<DriverProfileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // create form
  const [selectedCard, setSelectedCard] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dRes, pRes] = await Promise.all([fetchDrivers(), listDriverProfiles()]);
      setDrivers(dRes.drivers || []);
      setProfiles(pRes.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Drivers that have a card number and don't yet have a profile.
  const availableDrivers = useMemo(() => {
    const taken = new Set(profiles.map((p) => p.card_number));
    return drivers.filter((d) => d.card_number && !taken.has(d.card_number));
  }, [drivers, profiles]);

  const handleCreate = async () => {
    if (!selectedCard) return;
    const driver = drivers.find((d) => d.card_number === selectedCard);
    if (!driver) return;
    if (!driver.card_number) {
      setError(t('profileAdminNoCard'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createDriverProfile({
        card_number: driver.card_number,
        driver_name: driver.name,
        password: password || undefined,
      });
      setSelectedCard('');
      setPassword('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (url: string, card: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(card);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* clipboard may be blocked — ignore */
    }
  };

  const handleResetPw = async (card: string) => {
    const pw = window.prompt(t('profileAdminNewPassword'));
    if (!pw) return;
    try {
      await setDriverProfilePassword(card, pw);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleToggle = async (p: DriverProfileItem) => {
    try {
      await toggleDriverProfile(p.card_number, !p.enabled);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (card: string) => {
    if (!window.confirm(t('profileAdminDeleteConfirm'))) return;
    try {
      await deleteDriverProfile(card);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{t('profileAdminHint')}</p>

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Create / update form */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t('profileAdminSelectDriver')}
            </span>
            <select
              value={selectedCard}
              onChange={(e) => setSelectedCard(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-transparent px-3 text-sm"
            >
              <option value="">—</option>
              {availableDrivers.map((d) => (
                <option key={d.card_number} value={d.card_number}>
                  {d.name} ({d.card_number})
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t('profileAdminPassword')}
            </span>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••"
              className="h-10 w-full rounded-lg border border-border bg-transparent px-3 text-sm"
            />
          </label>
          <button
            onClick={handleCreate}
            disabled={saving || !selectedCard || !password}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0071e3] px-4 text-sm font-semibold text-white transition hover:bg-[#0077ed] disabled:opacity-50"
          >
            {saving ? <Spinner size="sm" /> : <UserPlus size={15} />}
            {t('profileAdminCreateBtn')}
          </button>
        </div>
      </div>

      {/* Existing profiles */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">{t('profileAdminExisting')}</h3>
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : profiles.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('profileAdminNoProfiles')}</p>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => (
              <div
                key={p.card_number}
                className="glass-card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.driver_name || p.card_number}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        p.enabled
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : 'bg-gray-400/20 text-muted'
                      }`}
                    >
                      {p.enabled ? t('profileAdminEnabled') : t('profileAdminDisabled')}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">{p.card_number}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted">{p.url}</div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    {t('profileAdminLastAccess')}: {p.last_access ? p.last_access.slice(0, 16).replace('T', ' ') : t('profileAdminNever')}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => handleCopy(p.url, p.card_number)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-surface"
                  >
                    {copied === p.card_number ? <Check size={13} /> : <Copy size={13} />}
                    {copied === p.card_number ? t('profileAdminCopied') : t('profileAdminCopy')}
                  </button>
                  <button
                    onClick={() => handleResetPw(p.card_number)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-surface"
                  >
                    <KeyRound size={13} />
                    {t('profileAdminResetPw')}
                  </button>
                  <button
                    onClick={() => handleToggle(p)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-surface"
                  >
                    {p.enabled ? <EyeOff size={13} /> : <Eye size={13} />}
                    {p.enabled ? t('profileAdminDisable') : t('profileAdminEnable')}
                  </button>
                  <button
                    onClick={() => handleDelete(p.card_number)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-500/10 dark:text-red-300"
                  >
                    <Trash2 size={13} />
                    {t('profileAdminDelete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

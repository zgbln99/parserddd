import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Check, KeyRound, Trash2, Eye, EyeOff, UserPlus, Search, X, ImagePlus } from 'lucide-react';
import { useI18n } from '../../i18n';
import {
  fetchDrivers,
  listDriverProfiles,
  createDriverProfile,
  setDriverProfilePassword,
  toggleDriverProfile,
  deleteDriverProfile,
  uploadDriverProfileAvatar,
  deleteDriverProfileAvatar,
  type DriverProfileItem,
} from '../../lib/api';
import type { Driver } from '../../types';
import { Spinner } from '../Spinner';
import { AvatarCropper } from '../AvatarCropper';

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

  // driver picker (searchable combobox)
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // filter over the existing-profiles list
  const [listFilter, setListFilter] = useState('');

  const [copied, setCopied] = useState('');
  // bumped after an avatar upload/delete to bust the <img> cache
  const [avatarBust, setAvatarBust] = useState(0);
  const [avatarBusy, setAvatarBusy] = useState('');
  // avatar cropper: which driver + the picked file
  const [cropCard, setCropCard] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);

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

  // Picker results filtered by the typed query (name or card number).
  const pickerResults = useMemo(() => {
    const q = pickerQuery.toLowerCase().trim();
    if (!q) return availableDrivers;
    return availableDrivers.filter(
      (d) =>
        d.name.toLowerCase().includes(q) || d.card_number.toLowerCase().includes(q),
    );
  }, [availableDrivers, pickerQuery]);

  // Existing profiles filtered by the list search box.
  const filteredProfiles = useMemo(() => {
    const q = listFilter.toLowerCase().trim();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.driver_name.toLowerCase().includes(q) ||
        p.card_number.toLowerCase().includes(q),
    );
  }, [profiles, listFilter]);

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
      setPickerQuery('');
      setPickerOpen(false);
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

  // Picking a file opens the cropper; the actual upload happens on confirm.
  const handleAvatarSelect = (card: string, file: File | null | undefined) => {
    if (!file) return;
    setError('');
    setCropCard(card);
    setCropFile(file);
  };

  const handleCropConfirm = async (blob: Blob) => {
    if (!cropCard) return;
    setAvatarBusy(cropCard);
    setError('');
    try {
      const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      await uploadDriverProfileAvatar(cropCard, cropped);
      setAvatarBust(Date.now());
      setCropFile(null);
      setCropCard('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAvatarBusy('');
    }
  };

  const handleAvatarRemove = async (card: string) => {
    setAvatarBusy(card);
    try {
      await deleteDriverProfileAvatar(card);
      setAvatarBust(Date.now());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAvatarBusy('');
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
          <div className="relative flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t('profileAdminSelectDriver')}
            </span>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={pickerQuery}
                onChange={(e) => {
                  setPickerQuery(e.target.value);
                  setSelectedCard('');
                  setPickerOpen(true);
                }}
                onFocus={() => setPickerOpen(true)}
                onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                placeholder={t('driversSearch')}
                className="h-10 w-full rounded-lg border border-border bg-transparent pl-9 pr-8 text-sm"
              />
              {(pickerQuery || selectedCard) && (
                <button
                  type="button"
                  onClick={() => {
                    setPickerQuery('');
                    setSelectedCard('');
                    setPickerOpen(false);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink"
                  aria-label="clear"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {pickerOpen && pickerResults.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-lg dark:bg-[#1f2a37]">
                {pickerResults.slice(0, 50).map((d) => (
                  <li key={d.card_number}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        // mouseDown fires before input blur, so the pick sticks
                        e.preventDefault();
                        setSelectedCard(d.card_number);
                        setPickerQuery(`${d.name} (${d.card_number})`);
                        setPickerOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface ${
                        selectedCard === d.card_number ? 'bg-surface' : ''
                      }`}
                    >
                      <span className="truncate font-medium">{d.name}</span>
                      <span className="shrink-0 font-mono text-xs text-muted">{d.card_number}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold">{t('profileAdminExisting')}</h3>
          {profiles.length > 0 && (
            <div className="relative w-full sm:max-w-xs">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder={t('driversSearch')}
                className="h-9 w-full rounded-lg border border-border bg-transparent pl-9 pr-3 text-sm"
              />
            </div>
          )}
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : profiles.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('profileAdminNoProfiles')}</p>
        ) : filteredProfiles.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('profileAdminNoProfiles')}</p>
        ) : (
          <div className="space-y-2">
            {filteredProfiles.map((p) => (
              <div
                key={p.card_number}
                className="glass-card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar p={p} bust={avatarBust} />
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
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-surface">
                    {avatarBusy === p.card_number ? <Spinner size="sm" /> : <ImagePlus size={13} />}
                    {t('profileAdminAvatar')}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        handleAvatarSelect(p.card_number, e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {p.has_avatar && (
                    <button
                      onClick={() => handleAvatarRemove(p.card_number)}
                      title={t('profileAdminAvatarRemove')}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface"
                    >
                      <X size={13} />
                    </button>
                  )}
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

      {cropFile && (
        <AvatarCropper
          file={cropFile}
          busy={avatarBusy === cropCard}
          onCancel={() => {
            setCropFile(null);
            setCropCard('');
          }}
          onConfirm={handleCropConfirm}
        />
      )}
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

function Avatar({ p, bust }: { p: DriverProfileItem; bust: number }) {
  if (p.has_avatar && p.avatar_url) {
    const sep = p.avatar_url.includes('?') ? '&' : '?';
    return (
      <img
        src={`${p.avatar_url}${sep}t=${bust}`}
        alt=""
        className="size-11 shrink-0 rounded-full object-cover ring-1 ring-border"
      />
    );
  }
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 text-sm font-bold text-white">
      {initials(p.driver_name || p.card_number)}
    </span>
  );
}

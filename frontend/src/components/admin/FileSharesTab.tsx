import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FolderLock, Plus, Copy, ExternalLink, Power, KeyRound, Trash2, Check, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import {
  fetchFileShares, createFileShare, updateFileShare, deleteFileShare, type FileShare,
} from '../../lib/api';
import { Card, CardHeader, CardBody } from '../Card';
import { Badge } from '../Badge';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from '../ConfirmDialog';
import { useToast } from '../Toast';

/**
 * Admin tab: password-protected links to the driver-card file archive
 * (`/share/<token>`), meant for people outside dispatch such as the
 * accountant. Create with a label + password (+ optional expiry), copy the
 * URL, and later disable, change the password or delete the link.
 */

const EXPIRY_OPTIONS = [0, 30, 90, 365];

function fmtDate(iso: string, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale === 'de' ? 'de-DE' : 'pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(iso: string, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(locale === 'de' ? 'de-DE' : 'pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function FileSharesTab() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [shares, setShares] = useState<FileShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // create form
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [expiryDays, setExpiryDays] = useState(0);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<FileShare | null>(null);

  // row actions
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [pwFor, setPwFor] = useState<FileShare | null>(null);
  const [newPw, setNewPw] = useState('');
  const [deleteFor, setDeleteFor] = useState<FileShare | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetchFileShares();
      setShares(r.shares);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const copy = async (s: FileShare) => {
    try {
      await navigator.clipboard.writeText(s.url);
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((v) => (v === s.id ? null : v)), 1800);
    } catch {
      toast(s.url, 'info');
    }
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim() || password.length < 6) return;
    setCreating(true);
    try {
      const s = await createFileShare({ label: label.trim(), password, expires_in_days: expiryDays || undefined });
      setCreated(s);
      setLabel('');
      setPassword('');
      toast(t('fsCreated'), 'success');
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (s: FileShare) => {
    setBusyId(s.id);
    try {
      const u = await updateFileShare(s.id, { enabled: !s.enabled });
      setShares((list) => list.map((x) => (x.id === u.id ? u : x)));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!pwFor || newPw.length < 6) return;
    setBusyId(pwFor.id);
    try {
      await updateFileShare(pwFor.id, { password: newPw });
      toast(t('fsPasswordChanged'), 'success');
      setPwFor(null);
      setNewPw('');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleteFor) return;
    const s = deleteFor;
    setDeleteFor(null);
    setBusyId(s.id);
    try {
      await deleteFileShare(s.id);
      setShares((list) => list.filter((x) => x.id !== s.id));
      if (created?.id === s.id) setCreated(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const statusOf = (s: FileShare) => {
    if (!s.enabled) return <Badge variant="gray" dot>{t('fsDisabled')}</Badge>;
    if (s.expired) return <Badge variant="red" dot>{t('fsExpired')}</Badge>;
    return <Badge variant="green" dot>{t('fsActive')}</Badge>;
  };

  return (
    <div className="space-y-5">
      <Card data-animate>
        <CardHeader>
          <span className="inline-flex items-center gap-2"><FolderLock size={16} className="text-sky-500" /> {t('fsCreate')}</span>
        </CardHeader>
        <CardBody>
          <p className="mb-4 text-sm text-muted">{t('fsIntro')}</p>
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <label className="text-xs font-semibold text-muted">
              {t('fsLabel')}
              <input
                id="fs-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('fsLabelPlaceholder')}
                className="input mt-1 w-full rounded-lg px-3 py-2 text-sm font-medium text-ink outline-none"
                required
              />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t('fsPassword')}
              <input
                id="fs-password"
                type="text"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input mt-1 w-full rounded-lg px-3 py-2 font-mono text-sm text-ink outline-none"
                minLength={6}
                required
              />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t('fsExpires')}
              <select
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                className="input mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink outline-none"
              >
                {EXPIRY_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d === 0 ? t('fsNoExpiry') : `${d} ${t('fsDays')}`}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={creating || !label.trim() || password.length < 6}
              className="btn-primary btn-press inline-flex h-[38px] items-center justify-center gap-2 px-4 text-sm disabled:opacity-50"
            >
              {creating ? <Spinner size="sm" /> : <Plus size={15} />}
              {t('fsCreate')}
            </button>
          </form>

          {created && (
            <div className="mt-4 rounded-xl border border-success/30 bg-success-soft p-3 text-sm" data-animate>
              <p className="font-semibold text-success">{t('fsCreated')}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-3 py-1.5 font-mono text-xs text-ink">{created.url}</code>
                <button type="button" onClick={() => copy(created)} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
                  {copiedId === created.id ? <Check size={13} /> : <Copy size={13} />}
                  {copiedId === created.id ? t('fsCopied') : t('fsCopy')}
                </button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card data-animate>
        <CardHeader>{t('fsList')}</CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex justify-center p-8"><Spinner /></div>
          ) : error ? (
            <p className="p-5 text-sm text-danger">{error}</p>
          ) : shares.length === 0 ? (
            <p className="p-5 text-sm text-muted">{t('fsNone')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {shares.map((s) => (
                <li key={s.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{s.label}</span>
                      {statusOf(s)}
                    </div>
                    <code className="mt-1 block truncate font-mono text-[11px] text-muted">{s.url}</code>
                    <p className="mt-1 text-[11px] text-muted">
                      {s.access_count} {t('fsOpens')} · {s.download_count} {t('fsDownloads')}
                      {s.last_access ? ` · ${t('fsLastAccess')} ${fmtDateTime(s.last_access, locale)}` : ''}
                      {s.expires_at ? ` · ${t('fsExpiresOn')} ${fmtDate(s.expires_at, locale)}` : ''}
                      {` · ${fmtDate(s.created_at, locale)}${s.created_by ? ` (${s.created_by})` : ''}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button type="button" onClick={() => copy(s)} title={t('fsCopy')} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
                      {copiedId === s.id ? <Check size={13} /> : <Copy size={13} />}
                      <span className="hidden sm:inline">{copiedId === s.id ? t('fsCopied') : t('fsCopy')}</span>
                    </button>
                    <a href={s.url} target="_blank" rel="noreferrer" title={t('fsOpen')} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
                      <ExternalLink size={13} />
                    </a>
                    <button type="button" onClick={() => { setPwFor(s); setNewPw(''); }} title={t('fsChangePassword')} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
                      <KeyRound size={13} />
                    </button>
                    <button type="button" onClick={() => toggle(s)} disabled={busyId === s.id} title={s.enabled ? t('fsDisable') : t('fsEnable')} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-50">
                      <Power size={13} className={s.enabled ? 'text-success' : 'text-muted'} />
                    </button>
                    <button type="button" onClick={() => setDeleteFor(s)} disabled={busyId === s.id} title={t('fsDelete')} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-danger disabled:opacity-50">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {pwFor && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 animate-fade-in">
          <div className="fixed inset-0 bg-black/30" onClick={() => setPwFor(null)} />
          <form onSubmit={changePassword} className="card relative w-full max-w-sm rounded-2xl p-6 shadow-xl animate-scale-in">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-ink">{t('fsChangePassword')} · {pwFor.label}</h3>
              <button type="button" onClick={() => setPwFor(null)} className="rounded-lg p-1 text-muted hover:text-ink"><X size={16} /></button>
            </div>
            <label className="text-xs font-semibold text-muted">
              {t('fsNewPassword')}
              <input
                id="fs-new-password"
                type="text"
                autoComplete="off"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="input mt-1 w-full rounded-lg px-3 py-2 font-mono text-sm text-ink outline-none"
                minLength={6}
                autoFocus
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPwFor(null)} className="btn-secondary btn-press px-4 py-2 text-sm">{t('cancel')}</button>
              <button type="submit" disabled={newPw.length < 6 || busyId === pwFor.id} className="btn-primary btn-press px-4 py-2 text-sm disabled:opacity-50">{t('save')}</button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteFor)}
        title={t('fsDelete')}
        message={t('fsDeleteConfirm')}
        confirmLabel={t('fsDelete')}
        onConfirm={remove}
        onCancel={() => setDeleteFor(null)}
      />
    </div>
  );
}

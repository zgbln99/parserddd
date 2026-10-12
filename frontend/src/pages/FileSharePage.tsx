import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, Globe, Sun, Moon, Search, Download, FolderArchive, RefreshCw, LogOut, FileText, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n, type Locale } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import {
  fetchFileShareInfo, unlockFileShare, lockFileShare, fetchFileShareFiles,
  fileShareDownloadUrl, fileShareZipUrl, type SharedDriver,
} from '../lib/api';
import { Spinner } from '../components/Spinner';

/**
 * Public, password-protected archive of driver-card (.ddd) files at
 * `/share/<token>`, for people outside dispatch such as the accountant.
 * No FleetView account: the password unlocks this link for the browser
 * session only. Drivers on the left, that driver's files on the right,
 * single downloads or a ZIP for a month / everything.
 */

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(iso: string, locale: string): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale === 'de' ? 'de-DE' : 'pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "1 plik / 2 pliki / 5 plików", "1 Datei / 2 Dateien". */
function plural(n: number, locale: string, forms: { pl: [string, string, string]; de: [string, string] }): string {
  if (locale === 'de') return `${n} ${n === 1 ? forms.de[0] : forms.de[1]}`;
  const [one, few, many] = forms.pl;
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = n === 1 ? one : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? few : many;
  return `${n} ${word}`;
}
const FILES = { pl: ['plik', 'pliki', 'plików'] as [string, string, string], de: ['Datei', 'Dateien'] as [string, string] };
const DRIVERS = { pl: ['kierowca', 'kierowców', 'kierowców'] as [string, string, string], de: ['Fahrer', 'Fahrer'] as [string, string] };

function monthLabel(ym: string, locale: string): string {
  const d = new Date(`${ym}-01T00:00:00`);
  return isNaN(d.getTime()) ? ym : d.toLocaleDateString(locale === 'de' ? 'de-DE' : 'pl-PL', { month: 'long', year: 'numeric' });
}

export function FileSharePage() {
  const { token = '' } = useParams();
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();

  const [phase, setPhase] = useState<'loading' | 'invalid' | 'locked' | 'open'>('loading');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const [drivers, setDrivers] = useState<SharedDriver[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [month, setMonth] = useState('');

  useEffect(() => {
    let alive = true;
    fetchFileShareInfo(token)
      .then((info) => {
        if (!alive) return;
        setLabel(info.label);
        setPhase(info.unlocked ? 'open' : 'locked');
      })
      .catch(() => { if (alive) setPhase('invalid'); });
    return () => { alive = false; };
  }, [token]);

  const loadFiles = async (refresh = false) => {
    setFilesLoading(true);
    setFilesError('');
    try {
      const r = await fetchFileShareFiles(token, refresh);
      setDrivers(r.drivers);
      if (r.label) setLabel(r.label);
    } catch (e) {
      const err = e as Error & { locked?: boolean; status?: number };
      if (err.locked) { setPhase('locked'); return; }
      if (err.status === 404) { setPhase('invalid'); return; }
      setFilesError(err.message);
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    if (phase === 'open') void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, token]);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');
    setUnlocking(true);
    try {
      await unlockFileShare(token, password);
      setPassword('');
      setPhase('open');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnlocking(false);
    }
  };

  const lock = async () => {
    try { await lockFileShare(token); } catch { /* ignore */ }
    setDrivers([]);
    setSelected('');
    setPhase('locked');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? drivers.filter((d) => d.name.toLowerCase().includes(q) || d.card_number.includes(q)) : drivers;
  }, [drivers, query]);

  const driver = drivers.find((d) => d.name === selected) || null;
  const months = useMemo(() => {
    if (!driver) return [];
    const set = new Set(driver.files.map((f) => f.file_date.slice(0, 7)).filter((m) => m.length === 7));
    return Array.from(set).sort().reverse();
  }, [driver]);
  const visibleFiles = useMemo(
    () => (driver ? driver.files.filter((f) => !month || f.file_date.startsWith(month)) : []),
    [driver, month],
  );

  const totalFiles = drivers.reduce((n, d) => n + d.file_count, 0);

  const controls = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setLocale((locale === 'pl' ? 'de' : 'pl') as Locale)}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-ink"
      >
        <Globe size={14} /> {locale === 'pl' ? 'DE' : 'PL'}
      </button>
      <button type="button" onClick={toggle} className="rounded-lg p-2 text-muted transition hover:bg-surface-2 hover:text-ink">
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </div>
  );

  // ---- gate screens ------------------------------------------------------
  if (phase !== 'open') {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-rail p-4">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-500/15 blur-[120px]" />
        </div>
        <div className="fixed right-4 top-4 z-10 flex items-center gap-1">
          <button type="button" onClick={() => setLocale((locale === 'pl' ? 'de' : 'pl') as Locale)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white">
            <Globe size={14} /> {locale === 'pl' ? 'DE' : 'PL'}
          </button>
        </div>

        <form
          onSubmit={unlock}
          className="relative w-[calc(100%-1rem)] max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur-xl animate-scale-in sm:w-full sm:p-8"
        >
          <div className="mb-6 text-center">
            <img src="/logo.png" alt="LTS" className="mx-auto mb-4 h-14" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <h1 className="text-xl font-bold tracking-tight text-white">{t('fsPageTitle')}</h1>
            <p className="mt-1.5 text-sm text-white/60">{label || t('fsPageSubtitle')}</p>
          </div>

          {phase === 'loading' && <div className="flex justify-center py-4"><Spinner /></div>}

          {phase === 'invalid' && (
            <p className="rounded-lg border border-red-400/20 bg-red-500/20 px-4 py-3 text-sm font-medium text-red-200">{t('fsLinkInvalid')}</p>
          )}

          {phase === 'locked' && (
            <>
              <p className="mb-4 text-sm text-white/70">{t('fsEnterPassword')}</p>
              {pwError && (
                <div className="mb-4 rounded-lg border border-red-400/20 bg-red-500/20 px-4 py-3 text-sm font-medium text-red-200">{pwError}</div>
              )}
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  id="fs-unlock-password"
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('loginPlaceholder')}
                  className="w-full rounded-xl border border-white/10 bg-white/10 py-3 pl-10 pr-4 text-sm text-white placeholder-white/40 outline-none transition focus:border-white/30 focus:bg-white/15"
                />
              </div>
              <button
                type="submit"
                disabled={unlocking || !password}
                className="btn-primary btn-press mt-4 flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
              >
                {unlocking ? <Spinner size="sm" /> : <Lock size={15} />}
                {t('fsUnlock')}
              </button>
            </>
          )}
        </form>
      </div>
    );
  }

  // ---- file browser ------------------------------------------------------
  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white">
            <FolderArchive size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold tracking-tight">{t('fsPageTitle')}</h1>
            <p className="truncate text-[11px] text-muted">
              {label ? `${label} · ` : ''}{plural(drivers.length, locale, DRIVERS)} · {plural(totalFiles, locale, FILES)}
            </p>
          </div>
          {controls}
          <button type="button" onClick={() => loadFiles(true)} disabled={filesLoading} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50" title={t('fsRefreshList')}>
            <RefreshCw size={13} className={filesLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{t('fsRefreshList')}</span>
          </button>
          <button type="button" onClick={lock} className="btn-secondary btn-press inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" title={t('fsLock')}>
            <LogOut size={13} />
            <span className="hidden sm:inline">{t('fsLock')}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-4 md:grid-cols-[300px_1fr]">
        {/* Drivers */}
        <aside className="card flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden" data-animate>
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="fs-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('fsSearchDrivers')}
                className="input w-full rounded-lg py-2 pl-9 pr-3 text-sm outline-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filesLoading && drivers.length === 0 ? (
              <div className="flex justify-center p-8"><Spinner /></div>
            ) : filesError ? (
              <p className="p-4 text-sm text-danger">{filesError}</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted">—</p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((d) => (
                  <li key={d.name}>
                    <button
                      type="button"
                      onClick={() => { setSelected(d.name); setMonth(''); }}
                      className={clsx(
                        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-surface-2',
                        selected === d.name && 'bg-accent-light',
                      )}
                    >
                      <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold', selected === d.name ? 'bg-accent text-white' : 'bg-surface-2 text-muted')}>
                        {d.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{d.name}</span>
                        <span className="block text-[11px] text-muted">
                          {plural(d.file_count, locale, FILES)}{d.latest_date ? ` · ${t('fsLastFile')} ${fmtDate(d.latest_date, locale)}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Files of the selected driver */}
        <section className="card min-h-[50vh] overflow-hidden" data-animate>
          {!driver ? (
            <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center text-muted">
              <Users size={36} className="opacity-40" />
              <p className="text-sm">{t('fsSelectDriver')}</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-bold">{driver.name}</h2>
                  <p className="text-[11px] text-muted">
                    {driver.card_number ? `${t('fsCard')} ${driver.card_number} · ` : ''}{plural(driver.file_count, locale, FILES)}
                  </p>
                </div>
                <select
                  id="fs-month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="input rounded-lg px-3 py-1.5 text-sm outline-none"
                >
                  <option value="">{t('fsAllMonths')}</option>
                  {months.map((m) => <option key={m} value={m}>{monthLabel(m, locale)}</option>)}
                </select>
                {visibleFiles.length > 0 && (
                  <a
                    href={fileShareZipUrl(token, driver.name, month || undefined)}
                    className="btn-primary btn-press inline-flex items-center gap-2 px-3 py-1.5 text-sm"
                  >
                    <FolderArchive size={15} /> {t('fsDownloadZip')} ({visibleFiles.length})
                  </a>
                )}
              </div>

              {visibleFiles.length === 0 ? (
                <p className="p-6 text-sm text-muted">{t('fsNoFiles')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                        <th className="whitespace-nowrap px-4 py-2.5">{t('fsFileDate')}</th>
                        <th className="px-4 py-2.5">{t('fsFileName')}</th>
                        <th className="px-4 py-2.5 text-right">{t('fsSize')}</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visibleFiles.map((f) => (
                        <tr key={f.path} className="hover:bg-surface-2">
                          <td className="whitespace-nowrap px-4 py-2.5 font-medium">{fmtDate(f.file_date || f.modified, locale)}</td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-2 font-mono text-xs text-muted">
                              <FileText size={14} className="shrink-0 text-accent" /> {f.name}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs text-muted">{fmtSize(f.size)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <a
                              href={fileShareDownloadUrl(token, f.path)}
                              className="btn-secondary btn-press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
                            >
                              <Download size={13} /> {t('fsDownload')}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

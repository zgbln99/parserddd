import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  Lock, Globe, Sun, Moon, Search, Download, FolderArchive, RefreshCw, LogOut, FileText,
  Users, Truck, ShieldCheck, CalendarDays, Files, Clock, ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { pl, type TranslationKey } from '../i18n/pl';
import { de } from '../i18n/de';
import type { Locale } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { matchesText } from '../lib/text';
import {
  fetchFileShareInfo, unlockFileShare, lockFileShare, fetchFileShareFiles,
  fileShareDownloadUrl, fileShareZipUrl, type SharedDriver,
} from '../lib/api';
import { Spinner } from '../components/Spinner';

/**
 * Public, password-protected archive of driver-card (.ddd) files at
 * `/share/<token>`, for people outside dispatch such as the accountant.
 * No FleetView account: the password unlocks this link for the browser
 * session only. German by default (the visitor can switch to Polish; the
 * choice is remembered for this page only and does not touch the app's
 * own language setting).
 */

const LOCALE_KEY = 'share-locale';
const DICT: Record<Locale, Record<TranslationKey, string>> = { pl, de };

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function intl(locale: Locale) {
  return locale === 'de' ? 'de-DE' : 'pl-PL';
}

function fmtDate(iso: string, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(intl(locale), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(d: Date, locale: Locale): string {
  return d.toLocaleString(intl(locale), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function monthLabel(ym: string, locale: Locale): string {
  const d = new Date(`${ym}-01T00:00:00`);
  return isNaN(d.getTime()) ? ym : d.toLocaleDateString(intl(locale), { month: 'long', year: 'numeric' });
}

/** "1 plik / 2 pliki / 5 plików", "1 Datei / 2 Dateien". */
function plural(n: number, locale: Locale, forms: { pl: [string, string, string]; de: [string, string] }): string {
  if (locale === 'de') return `${n} ${n === 1 ? forms.de[0] : forms.de[1]}`;
  const [one, few, many] = forms.pl;
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = n === 1 ? one : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? few : many;
  return `${n} ${word}`;
}
const FILES = { pl: ['plik', 'pliki', 'plików'] as [string, string, string], de: ['Datei', 'Dateien'] as [string, string] };

function daysSince(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? null : Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export function FileSharePage() {
  const { token = '' } = useParams();
  const { theme, toggle } = useTheme();

  const [locale, setLocaleState] = useState<Locale>(() => {
    try { return localStorage.getItem(LOCALE_KEY) === 'pl' ? 'pl' : 'de'; } catch { return 'de'; }
  });
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(LOCALE_KEY, l); } catch { /* ignore */ }
  };
  const t = (key: TranslationKey) => DICT[locale][key] ?? key;
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `${DICT[locale].fsPageTitle} · LTS Logistik`;
  }, [locale]);

  const [phase, setPhase] = useState<'loading' | 'invalid' | 'locked' | 'open'>('loading');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const [drivers, setDrivers] = useState<SharedDriver[]>([]);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'newest'>('name');
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
      setLoadedAt(new Date());
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
    const q = query.trim();
    const list = q ? drivers.filter((d) => matchesText(d.name, q) || matchesText(d.card_number, q)) : drivers.slice();
    if (sort === 'newest') list.sort((a, b) => (b.latest_date || '').localeCompare(a.latest_date || '') || a.name.localeCompare(b.name));
    else list.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    return list;
  }, [drivers, query, sort]);

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
  const visibleBytes = visibleFiles.reduce((n, f) => n + (f.size || 0), 0);

  const totalFiles = drivers.reduce((n, d) => n + d.file_count, 0);
  const latestOverall = drivers.reduce((m, d) => (d.latest_date > m ? d.latest_date : m), '');

  const langButton = (dark: boolean) => (
    <button
      type="button"
      onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl')}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition',
        dark ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-muted hover:bg-surface-2 hover:text-ink',
      )}
      title={locale === 'pl' ? 'Deutsch' : 'Polski'}
    >
      <Globe size={14} /> {locale === 'pl' ? 'DE' : 'PL'}
    </button>
  );

  // ---- gate screens ------------------------------------------------------
  if (phase !== 'open') {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-rail p-4">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-1/3 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-500/15 blur-[130px]" />
        </div>
        <div className="fixed right-4 top-4 z-10">{langButton(true)}</div>

        <div className="relative w-full max-w-md animate-scale-in">
          <div className="mb-5 flex items-center justify-center gap-3 text-white">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent shadow-lg shadow-primary-500/30">
              <Truck size={22} />
            </span>
            <span className="text-left leading-tight">
              <span className="block text-base font-bold tracking-tight">{t('fsBrand')}</span>
              <span className="block text-xs text-white/60">{t('fsPageTitle')}</span>
            </span>
          </div>

          <form onSubmit={unlock} className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 backdrop-blur-xl sm:p-8">
            <div className="mb-6">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/80">
                <Lock size={11} /> {label || t('fsPageTitle')}
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white">{t('fsPageTitle')}</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-white/60">{t('fsEnterPassword')}</p>
            </div>

            {phase === 'loading' && <div className="flex justify-center py-4"><Spinner /></div>}

            {phase === 'invalid' && (
              <p className="rounded-lg border border-red-400/20 bg-red-500/20 px-4 py-3 text-sm font-medium text-red-200">{t('fsLinkInvalid')}</p>
            )}

            {phase === 'locked' && (
              <>
                {pwError && (
                  <div className="mb-4 rounded-lg border border-red-400/20 bg-red-500/20 px-4 py-3 text-sm font-medium text-red-200">{pwError}</div>
                )}
                <label className="block text-xs font-semibold uppercase tracking-wide text-white/60">
                  {t('fsPasswordLabel')}
                  <div className="relative mt-1.5">
                    <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      id="fs-unlock-password"
                      type="password"
                      autoFocus
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/10 py-3 pl-10 pr-4 text-sm text-white placeholder-white/40 outline-none transition focus:border-white/30 focus:bg-white/15"
                    />
                  </div>
                </label>
                <button
                  type="submit"
                  disabled={unlocking || !password}
                  className="btn-primary btn-press mt-4 flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
                >
                  {unlocking ? <Spinner size="sm" /> : <ShieldCheck size={16} />}
                  {t('fsUnlock')}
                </button>
              </>
            )}
          </form>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-white/40">
            <ShieldCheck size={12} /> {t('fsConfidential')}
          </p>
        </div>
      </div>
    );
  }

  // ---- file browser ------------------------------------------------------
  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
            <Truck size={18} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="truncate text-[15px] font-bold tracking-tight">{t('fsPageTitle')}</h1>
            <p className="truncate text-[11px] text-muted">{t('fsBrand')}{label ? ` · ${label}` : ''}</p>
          </div>
          <div className="flex items-center gap-1">
            {langButton(false)}
            <button type="button" onClick={toggle} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink" title={theme === 'dark' ? 'Light' : 'Dark'}>
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button type="button" onClick={() => loadFiles(true)} disabled={filesLoading} className="btn-secondary btn-press inline-flex h-8 items-center gap-1.5 px-3 text-xs disabled:opacity-50" title={t('fsRefreshList')}>
              <RefreshCw size={13} className={filesLoading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{t('fsRefreshList')}</span>
            </button>
            <button type="button" onClick={lock} className="btn-secondary btn-press inline-flex h-8 items-center gap-1.5 px-3 text-xs" title={t('fsLock')}>
              <LogOut size={13} />
              <span className="hidden sm:inline">{t('fsLock')}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 p-4">
        {/* Summary strip */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-animate>
          <div className="card kpi kpi-accent px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Users size={12} /> {t('fsDrivers')}</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{drivers.length}</p>
          </div>
          <div className="card kpi kpi-accent px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Files size={12} /> {t('fsFiles')}</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{totalFiles}</p>
          </div>
          <div className="card kpi kpi-ok px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><CalendarDays size={12} /> {t('fsKpiLatest')}</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums sm:text-2xl">{fmtDate(latestOverall, locale)}</p>
          </div>
          <div className="card kpi px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted"><Clock size={12} /> {t('fsKpiAsOf')}</p>
            <p className="mt-1 font-mono text-sm font-semibold tabular-nums sm:text-base">{loadedAt ? fmtDateTime(loadedAt, locale) : '—'}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          {/* Drivers */}
          <aside className="card flex max-h-[calc(100vh-14rem)] min-h-[320px] flex-col overflow-hidden" data-animate>
            <div className="space-y-2 border-b border-border p-3">
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
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-muted">{t('fsSearchHint')}</span>
                <select
                  id="fs-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as 'name' | 'newest')}
                  className="input shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold outline-none"
                >
                  <option value="name">{t('fsSortName')}</option>
                  <option value="newest">{t('fsSortNewest')}</option>
                </select>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filesLoading && drivers.length === 0 ? (
                <div className="flex justify-center p-8"><Spinner /></div>
              ) : filesError ? (
                <p className="p-4 text-sm text-danger">{filesError}</p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-sm text-muted">{t('fsNoMatch')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((d) => {
                    const age = daysSince(d.latest_date);
                    const fresh = age !== null && age <= 28;
                    const active = selected === d.name;
                    return (
                      <li key={d.name}>
                        <button
                          type="button"
                          onClick={() => { setSelected(d.name); setMonth(''); }}
                          className={clsx(
                            'flex w-full items-center gap-3 px-3 py-2.5 text-left transition',
                            active ? 'bg-accent-light' : 'hover:bg-surface-2',
                          )}
                        >
                          <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold', active ? 'bg-accent text-white' : 'bg-surface-2 text-muted')}>
                            {initials(d.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{d.name}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                              <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', age === null ? 'bg-muted' : fresh ? 'bg-success' : 'bg-warning')} />
                              <span className="truncate" title={d.latest_date ? `${t('fsLastFile')}: ${fmtDate(d.latest_date, locale)}` : undefined}>
                                {plural(d.file_count, locale, FILES)}{d.latest_date ? ` · ${fmtDate(d.latest_date, locale)}` : ''}
                              </span>
                            </span>
                          </span>
                          <ChevronRight size={14} className={clsx('shrink-0', active ? 'text-accent' : 'text-muted/50')} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Files of the selected driver */}
          <section className="card flex min-h-[320px] flex-col overflow-hidden" data-animate>
            {!driver ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2"><FolderArchive size={26} className="opacity-60" /></span>
                <p className="max-w-xs text-sm">{t('fsSelectDriver')}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">{initials(driver.name)}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-bold tracking-tight">{driver.name}</h2>
                    <p className="truncate font-mono text-[11px] text-muted">
                      {driver.card_number ? `${t('fsCard')} ${driver.card_number} · ` : ''}
                      {driver.earliest_date && driver.latest_date ? `${fmtDate(driver.earliest_date, locale)} – ${fmtDate(driver.latest_date, locale)} · ` : ''}
                      {plural(driver.file_count, locale, FILES)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2/40 px-4 py-2.5 sm:px-5">
                  <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <span className="hidden sm:inline">{t('fsPeriod')}</span>
                    <select
                      id="fs-month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="input rounded-lg px-3 py-1.5 text-sm font-medium normal-case tracking-normal text-ink outline-none"
                    >
                      <option value="">{t('fsAllMonths')}</option>
                      {months.map((m) => <option key={m} value={m}>{monthLabel(m, locale)}</option>)}
                    </select>
                  </label>
                  <span className="hidden flex-1 text-[11px] text-muted sm:inline">{t('fsZipHint')}</span>
                  {visibleFiles.length > 0 && (
                    <a
                      href={fileShareZipUrl(token, driver.name, month || undefined)}
                      title={t('fsZipHint')}
                      className="btn-primary btn-press ml-auto inline-flex items-center gap-2 px-3.5 py-2 text-sm"
                    >
                      <FolderArchive size={15} /> {t('fsDownloadZip')}
                      <span className="rounded-md bg-white/20 px-1.5 font-mono text-[11px] tabular-nums">{visibleFiles.length} · {fmtSize(visibleBytes)}</span>
                    </a>
                  )}
                </div>

                {visibleFiles.length === 0 ? (
                  <p className="p-6 text-sm text-muted">{t('fsNoFiles')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-2/60">
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                          <th className="whitespace-nowrap px-4 py-2.5 sm:px-5">{t('fsFileDate')}</th>
                          <th className="px-4 py-2.5">{t('fsFileName')}</th>
                          <th className="px-4 py-2.5 text-right">{t('fsSize')}</th>
                          <th className="px-4 py-2.5 sm:px-5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {visibleFiles.map((f) => (
                          <tr key={f.path} className="transition hover:bg-surface-2/70">
                            <td className="whitespace-nowrap px-4 py-2.5 font-mono font-semibold tabular-nums sm:px-5">{fmtDate(f.file_date || f.modified, locale)}</td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center gap-2 font-mono text-xs text-muted">
                                <FileText size={14} className="shrink-0 text-accent" /> {f.name}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted">{fmtSize(f.size)}</td>
                            <td className="px-4 py-2.5 text-right sm:px-5">
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
        </div>
      </main>

      <footer className="border-t border-border py-3 text-center text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} /> {t('fsBrand')} · {t('fsConfidential')}</span>
      </footer>
    </div>
  );
}

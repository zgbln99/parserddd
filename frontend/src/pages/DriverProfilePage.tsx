import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, LogOut, Truck, UtensilsCrossed, CalendarDays, CalendarX, Clock } from 'lucide-react';
import { useI18n } from '../i18n';
import { Spinner } from '../components/Spinner';
import { ProfileShiftTable } from '../components/ProfileShiftTable';
import { DietReport } from '../features/analysis/DietReport';
import { getHolidayMap } from '../lib/holidays';
import type { ShiftDetail } from '../types';

/**
 * Public, password-gated driver profile (`/profil/:token`).
 *
 * A driver opens their stable link, types the password the admin set for
 * them, picks a month, and sees ONLY their shift table + diets. No app
 * chrome, no navigation, no compliance — "nic więcej".
 *
 * Auth is deliberately NOT the Flask session: the public endpoints take the
 * link token as bearer, and after the password check the backend hands out
 * a short-lived signed access token we keep in component state.
 */

const BASE = '';

interface LoginResponse {
  access_token: string;
  driver_name: string;
  months: string[];
  default_month: string;
  has_avatar: boolean;
}

interface DataResponse {
  driver_name: string;
  month: string;
  shifts: ShiftDetail[];
  summary: { diet_count: number; total_shifts: number };
  diet_rate: number;
  double_diet: boolean;
  diet_total_eur: number;
}

type Stage = 'loading' | 'locked' | 'invalid' | 'ready';

// Shared gradient palette for icon chips / accents — brand: black + red.
const GRADIENTS = {
  red: 'from-rose-500 to-red-600',
  dark: 'from-zinc-700 to-zinc-900',
} as const;
type Tone = keyof typeof GRADIENTS;

// The signature hero gradient — sleek near-black with a red glow.
const HERO_BG =
  'bg-gradient-to-br from-zinc-900 via-[#0c0c0e] to-[#2a0a0e]';

export function DriverProfilePage() {
  const { token = '' } = useParams<{ token: string }>();
  const { t, locale, setLocale } = useI18n();

  const [stage, setStage] = useState<Stage>('loading');
  const [driverName, setDriverName] = useState('');
  const [hasAvatar, setHasAvatar] = useState(false);
  const avatarUrl = hasAvatar ? `${BASE}/api/profile/${encodeURIComponent(token)}/avatar` : '';

  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [accessToken, setAccessToken] = useState('');
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState('');

  const [data, setData] = useState<DataResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');

  // --- initial metadata fetch -------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/profile/${encodeURIComponent(token)}`, {
          credentials: 'omit',
        });
        if (cancelled) return;
        if (!res.ok) {
          setStage('invalid');
          return;
        }
        const j = await res.json();
        setDriverName(j.driver_name || '');
        setHasAvatar(Boolean(j.has_avatar));
        setStage('locked');
      } catch {
        if (!cancelled) setStage('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // --- data fetch for a month -------------------------------------------
  const loadMonth = useCallback(
    async (ym: string, at: string) => {
      setDataLoading(true);
      setDataError('');
      try {
        const res = await fetch(`${BASE}/api/profile/${encodeURIComponent(token)}/data`, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: at, month: ym }),
        });
        const j = await res.json();
        if (res.status === 401) {
          // session expired — back to password
          setStage('locked');
          setAccessToken('');
          setLoginError(t('profileSessionExpired'));
          return;
        }
        if (!res.ok) {
          setDataError(j.error === 'no data for this month' ? t('profileNoData') : t('profileLoadError'));
          setData(null);
          return;
        }
        setData(j as DataResponse);
      } catch {
        setDataError(t('profileLoadError'));
        setData(null);
      } finally {
        setDataLoading(false);
      }
    },
    [token, t],
  );

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const res = await fetch(`${BASE}/api/profile/${encodeURIComponent(token)}/login`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setLoginError(t('profileWrongPassword'));
        return;
      }
      if (res.status === 429) {
        setLoginError(t('profileWrongPassword'));
        return;
      }
      if (!res.ok) {
        setStage('invalid');
        return;
      }
      const j: LoginResponse = await res.json();
      setAccessToken(j.access_token);
      setDriverName(j.driver_name || driverName);
      setHasAvatar(Boolean(j.has_avatar));
      setMonths(j.months || []);
      setPassword('');
      setStage('ready');
      const first = j.default_month || (j.months && j.months[0]) || '';
      if (first) {
        setMonth(first);
        await loadMonth(first, j.access_token);
      }
    } catch {
      setLoginError(t('profileLoadError'));
    } finally {
      setLoggingIn(false);
    }
  };

  const onMonthChange = (ym: string) => {
    setMonth(ym);
    if (accessToken) loadMonth(ym, accessToken);
  };

  const onLogout = () => {
    setAccessToken('');
    setData(null);
    setMonths([]);
    setMonth('');
    setStage('locked');
  };

  // Working days (Mon–Fri, minus German public holidays) in the selected
  // month that have NO shift — i.e. days the driver "is missing work". For
  // the current month we only look back up to today, never flag the future.
  const missingDays = useMemo<{ day: number; label: string }[]>(() => {
    if (!data || !month) return [];
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return [];
    const worked = new Set(data.shifts.map((s) => s.shift_date || s.grid_date));
    const holidays = getHolidayMap(y);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const daysInMonth = new Date(y, m, 0).getDate();
    const loc = locale === 'de' ? 'de-DE' : 'pl-PL';
    const out: { day: number; label: string }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(y, m - 1, day);
      const dow = d.getDay(); // 0 = Sun, 6 = Sat
      if (dow === 0 || dow === 6) continue;
      if (d > today) continue;
      const iso = `${month}-${String(day).padStart(2, '0')}`;
      if (holidays.has(iso)) continue;
      if (!worked.has(iso)) {
        // e.g. "pon. 13.05" / "Mo. 13.05." — unambiguous which day it is
        const label = d.toLocaleDateString(loc, {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
        });
        out.push({ day, label });
      }
    }
    return out;
  }, [data, month, locale]);

  // Month totals for the summary cards (computed from the shift rows).
  const totals = useMemo(() => {
    const s = data?.shifts ?? [];
    const sum = (f: keyof ShiftDetail) =>
      s.reduce((a, x) => a + (Number(x[f]) || 0), 0);
    const hm = (mins: number) => `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
    return {
      shifts: s.length,
      workHm: hm(sum('work_minutes')),
      drivingHm: hm(sum('driving_minutes')),
    };
  }, [data]);

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';

  const fmtMonth = (ym: string) => {
    const [y, m] = ym.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    try {
      return d.toLocaleDateString(locale === 'de' ? 'de-DE' : 'pl-PL', {
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return ym;
    }
  };

  // --- Loading / invalid / locked are full-screen branded screens --------

  if (stage === 'loading') {
    return (
      <div className={`flex min-h-screen items-center justify-center ${HERO_BG}`}>
        <Spinner size="lg" className="!border-white/30 !border-t-white" />
      </div>
    );
  }

  if (stage === 'invalid') {
    return (
      <CenteredHero>
        <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-white/10 p-8 text-center text-white shadow-2xl backdrop-blur-xl">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-white/15">
            <Lock size={24} />
          </div>
          <p className="text-sm text-white/90">{t('profileInvalid')}</p>
        </div>
      </CenteredHero>
    );
  }

  if (stage === 'locked') {
    return (
      <CenteredHero>
        <div className="absolute right-4 top-4">
          <LangSwitch locale={locale} setLocale={setLocale} glass />
        </div>
        <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-white/10 p-8 text-white shadow-2xl backdrop-blur-xl">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={driverName}
                className="size-16 rounded-2xl object-cover ring-2 ring-white/30"
              />
            ) : (
              <div className="grid size-16 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                <Lock size={26} />
              </div>
            )}
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                {driverName ? `${t('profileGreeting')}, ${driverName}` : t('profileTitle')}
              </h1>
              <p className="mt-0.5 text-sm text-white/70">{t('profilePasswordPrompt')}</p>
            </div>
          </div>
          <form onSubmit={onLogin} className="grid gap-3">
            <input
              autoFocus
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-2xl border border-white/20 bg-white/10 px-4 text-center text-base text-white placeholder-white/40 outline-none transition focus:border-white/50 focus:bg-white/15"
              placeholder={t('profilePasswordLabel')}
            />
            {loginError && (
              <div className="rounded-xl bg-rose-500/20 px-3 py-2 text-center text-xs font-medium text-rose-100">
                {loginError}
              </div>
            )}
            <button
              type="submit"
              disabled={loggingIn}
              className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-bold text-red-600 shadow-lg transition hover:bg-white/90 disabled:opacity-60"
            >
              {loggingIn ? <Spinner size="sm" /> : t('profileLoginBtn')}
            </button>
          </form>
        </div>
      </CenteredHero>
    );
  }

  // --- Ready: the full profile dashboard ---------------------------------

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-100 to-white text-gray-900 antialiased dark:from-[#0b0b0d] dark:to-[#0b0b0d] dark:text-gray-100">
      {/* HERO banner */}
      <div className={`relative overflow-hidden rounded-b-[2.5rem] pb-24 shadow-xl ${HERO_BG}`}>
        <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-12 size-72 rounded-full bg-red-600/30 blur-3xl" />

        <div className="relative mx-auto max-w-[1500px] px-4 sm:px-6">
          {/* top bar */}
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-2.5 text-white">
              <img src="/icon.svg" alt="" className="size-9 rounded-xl ring-1 ring-white/30" />
              <span className="text-sm font-semibold tracking-tight">LTS Logistik GmbH</span>
            </div>
            <div className="flex items-center gap-2">
              <LangSwitch locale={locale} setLocale={setLocale} glass />
              <button
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20"
              >
                <LogOut size={13} />
                <span className="hidden sm:inline">{t('profileLogout')}</span>
              </button>
            </div>
          </div>

          {/* profile identity */}
          <div className="flex flex-col items-center gap-4 pb-2 pt-6 text-center">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={driverName}
                className="size-20 rounded-3xl object-cover ring-2 ring-white/40 shadow-lg"
              />
            ) : (
              <div className="grid size-20 place-items-center rounded-3xl bg-white/15 text-2xl font-extrabold text-white ring-2 ring-white/30 backdrop-blur">
                {initials(driverName)}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                {driverName || t('profileTitle')}
              </h1>
              <p className="mt-1 text-sm text-white/75">{t('profileTitle')} · LTS Logistik GmbH</p>
            </div>

            {/* month selector */}
            <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 py-1.5 pl-3.5 pr-2 text-white shadow-lg backdrop-blur">
              <CalendarDays size={15} className="text-white/80" />
              <select
                value={month}
                onChange={(e) => onMonthChange(e.target.value)}
                className="cursor-pointer bg-transparent pr-1 text-sm font-semibold text-white outline-none [&>option]:text-gray-900"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {fmtMonth(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT — overlaps the hero */}
      <main className="relative z-10 mx-auto -mt-16 max-w-[1500px] px-4 pb-16 sm:px-6">
        {dataLoading && (
          <div className="flex justify-center rounded-3xl bg-white p-16 shadow-lg dark:bg-white/[0.06]">
            <Spinner size="lg" />
          </div>
        )}

        {!dataLoading && dataError && (
          <div className="rounded-3xl bg-white p-10 text-center text-sm text-muted shadow-lg dark:bg-white/[0.06]">
            {dataError}
          </div>
        )}

        {!dataLoading && !dataError && data && (
          <div className="space-y-5">
            {/* Summary cards */}
            {data.shifts.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard icon={<Truck size={20} />} tone="red" label={t('analysisShifts')} value={String(totals.shifts)} />
                <StatCard icon={<Clock size={20} />} tone="dark" label={t('analysisWorkTime')} value={totals.workHm} />
                <StatCard icon={<UtensilsCrossed size={20} />} tone="dark" label={t('profileDietHeading')} value={`${data.summary.diet_count} / ${data.summary.total_shifts}`} />
                <StatCard icon={<CalendarX size={20} />} tone="red" label={t('profileMissingWorkLabel')} value={String(missingDays.length)} />
              </div>
            )}

            {/* Missing working days */}
            {missingDays.length > 0 && (
              <section className="overflow-hidden rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 to-red-50 p-5 shadow-sm dark:border-rose-500/20 dark:from-rose-500/10 dark:to-red-500/5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-sm">
                    <CalendarX size={19} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">
                      {t('profileMissingWorkLabel')} ({missingDays.length})
                    </h2>
                    <p className="mt-0.5 text-sm text-rose-800 dark:text-rose-100/90">
                      {t('profileMissingWorkIntro')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {missingDays.map(({ day, label }) => (
                        <span
                          key={day}
                          className="rounded-lg bg-white/70 px-2.5 py-1 text-xs font-bold capitalize text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/30"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Shifts */}
            <Panel>
              <SectionHeader icon={<Truck size={18} />} tone="dark" title={t('profileShiftsHeading')} />
              {data.shifts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">{t('profileNoData')}</p>
              ) : (
                <ProfileShiftTable shifts={data.shifts} />
              )}
            </Panel>

            {/* Diets */}
            {data.shifts.length > 0 && (
              <Panel>
                <SectionHeader
                  icon={<UtensilsCrossed size={18} />}
                  tone="red"
                  title={t('profileDietHeading')}
                  right={
                    <span className="rounded-full bg-red-500/10 px-3 py-1 text-sm font-bold text-red-600 dark:text-red-400">
                      {data.summary.diet_count} / {data.summary.total_shifts}
                    </span>
                  }
                />
                <DietReport
                  shifts={data.shifts}
                  driverName={data.driver_name}
                  cardNumber=""
                  summary={data.summary}
                />
              </Panel>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------ building blocks ------------------------ */

function CenteredHero({ children }: { children: ReactNode }) {
  return (
    <div className={`relative flex min-h-screen items-center justify-center overflow-hidden px-4 ${HERO_BG}`}>
      <div className="pointer-events-none absolute -right-16 -top-24 size-80 rounded-full bg-red-600/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-12 size-80 rounded-full bg-white/10 blur-3xl" />
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm shadow-black/[0.03] sm:p-6 dark:border-white/10 dark:bg-white/[0.06]">
      {children}
    </section>
  );
}

function SectionHeader({
  icon,
  title,
  tone,
  right,
}: {
  icon: ReactNode;
  title: string;
  tone: Tone;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${GRADIENTS[tone]} text-white shadow-sm`}>
        {icon}
      </span>
      <h2 className="text-base font-bold tracking-tight text-ink">{title}</h2>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: Tone;
}) {
  return (
    <div className="group rounded-3xl border border-black/5 bg-white p-4 shadow-sm shadow-black/[0.03] transition hover:-translate-y-0.5 hover:shadow-md sm:p-5 dark:border-white/10 dark:bg-white/[0.06]">
      <div className="flex items-center gap-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${GRADIENTS[tone]} text-white shadow-sm`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-2xl font-extrabold leading-none tracking-tight text-ink">
            {value}
          </div>
          <div className="mt-1.5 truncate text-xs font-medium text-muted">{label}</div>
        </div>
      </div>
    </div>
  );
}

function LangSwitch({
  locale,
  setLocale,
  glass,
}: {
  locale: 'pl' | 'de';
  setLocale: (l: 'pl' | 'de') => void;
  glass?: boolean;
}) {
  return (
    <div
      className={`flex overflow-hidden rounded-full text-xs font-bold ${
        glass ? 'border border-white/25 bg-white/10 backdrop-blur' : 'border border-border'
      }`}
    >
      {(['de', 'pl'] as const).map((l) => {
        const active = locale === l;
        return (
          <button
            key={l}
            onClick={() => setLocale(l)}
            className={`px-3 py-1.5 transition ${
              active
                ? glass
                  ? 'bg-white text-red-600'
                  : 'bg-red-600 text-white'
                : glass
                  ? 'text-white/80 hover:bg-white/10'
                  : 'text-muted hover:bg-surface'
            }`}
          >
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

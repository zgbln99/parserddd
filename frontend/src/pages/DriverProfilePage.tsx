import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, LogOut, Truck, UtensilsCrossed, CalendarDays } from 'lucide-react';
import { useI18n } from '../i18n';
import { Spinner } from '../components/Spinner';
import { ShiftTable } from '../features/analysis/ShiftTable';
import { DietReport } from '../features/analysis/DietReport';
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

export function DriverProfilePage() {
  const { token = '' } = useParams<{ token: string }>();
  const { t, locale, setLocale } = useI18n();

  const [stage, setStage] = useState<Stage>('loading');
  const [driverName, setDriverName] = useState('');

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

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-gray-900 antialiased dark:bg-[#0f141a] dark:text-gray-100">
      {/* Header */}
      <header className="border-b border-black/5 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-white/5">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="size-8 rounded-lg" />
            <div>
              <div className="text-sm font-semibold leading-tight">{t('profileTitle')}</div>
              <div className="text-[11px] text-muted">LTS Logistik GmbH</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LangSwitch locale={locale} setLocale={setLocale} />
            {stage === 'ready' && (
              <button
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface"
              >
                <LogOut size={13} />
                {t('profileLogout')}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {stage === 'loading' && (
          <div className="flex justify-center py-24">
            <Spinner size="lg" />
          </div>
        )}

        {stage === 'invalid' && (
          <div className="mx-auto mt-16 max-w-sm rounded-2xl border border-border bg-white p-8 text-center dark:bg-white/5">
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-red-500/10 text-red-500">
              <Lock size={20} />
            </div>
            <p className="text-sm text-muted">{t('profileInvalid')}</p>
          </div>
        )}

        {stage === 'locked' && (
          <div className="mx-auto mt-12 max-w-sm rounded-2xl border border-border bg-white p-8 dark:bg-white/5">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-[#0071e3]/10 text-[#0071e3]">
                <Lock size={18} />
              </span>
              <div>
                <h1 className="text-base font-semibold">
                  {driverName ? `${t('profileGreeting')}, ${driverName}` : t('profileTitle')}
                </h1>
                <p className="text-xs text-muted">{t('profilePasswordPrompt')}</p>
              </div>
            </div>
            <form onSubmit={onLogin} className="grid gap-3">
              <label className="text-sm">
                <span className="mb-1.5 block text-xs font-medium text-muted">
                  {t('profilePasswordLabel')}
                </span>
                <input
                  autoFocus
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-transparent px-4 text-sm focus:border-[#0071e3] focus:outline-none focus:ring-1 focus:ring-[#0071e3]"
                  placeholder="••••••••"
                />
              </label>
              {loginError && (
                <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                  {loginError}
                </div>
              )}
              <button
                type="submit"
                disabled={loggingIn}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0071e3] text-sm font-semibold text-white transition hover:bg-[#0077ed] disabled:opacity-60"
              >
                {loggingIn ? <Spinner size="sm" /> : t('profileLoginBtn')}
              </button>
            </form>
          </div>
        )}

        {stage === 'ready' && (
          <div className="space-y-6">
            {/* Month picker */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CalendarDays size={16} className="text-[#0071e3]" />
                {t('profileMonth')}
              </div>
              <select
                value={month}
                onChange={(e) => onMonthChange(e.target.value)}
                className="h-10 rounded-lg border border-border bg-transparent px-3 text-sm"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {fmtMonth(m)}
                  </option>
                ))}
              </select>
            </div>

            {dataLoading && (
              <div className="flex justify-center py-16">
                <Spinner size="lg" />
              </div>
            )}

            {!dataLoading && dataError && (
              <div className="rounded-xl border border-border bg-white p-6 text-center text-sm text-muted dark:bg-white/5">
                {dataError}
              </div>
            )}

            {!dataLoading && !dataError && data && (
              <>
                {/* Shifts */}
                <section className="rounded-2xl border border-border bg-white p-4 dark:bg-white/5">
                  <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
                    <Truck size={17} className="text-[#0071e3]" />
                    {t('profileShiftsHeading')}
                  </h2>
                  {data.shifts.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted">{t('profileNoData')}</p>
                  ) : (
                    <ShiftTable shifts={data.shifts} />
                  )}
                </section>

                {/* Diets */}
                {data.shifts.length > 0 && (
                  <section className="rounded-2xl border border-border bg-white p-4 dark:bg-white/5">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-base font-semibold">
                        <UtensilsCrossed size={17} className="text-emerald-500" />
                        {t('profileDietHeading')}
                      </h2>
                      <div className="text-right text-sm">
                        <span className="text-muted">{t('profileDietTotal')}: </span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          {data.diet_total_eur.toFixed(2)} €
                        </span>
                      </div>
                    </div>
                    <DietReport
                      shifts={data.shifts}
                      driverName={data.driver_name}
                      cardNumber=""
                      summary={data.summary}
                    />
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function LangSwitch({
  locale,
  setLocale,
}: {
  locale: 'pl' | 'de';
  setLocale: (l: 'pl' | 'de') => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-full border border-border text-xs font-semibold">
      {(['de', 'pl'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={`px-2.5 py-1.5 transition ${
            locale === l ? 'bg-[#0071e3] text-white' : 'text-muted hover:bg-surface'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

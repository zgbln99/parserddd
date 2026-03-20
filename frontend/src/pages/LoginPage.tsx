import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { Sun, Moon, Globe, Lock, Truck } from 'lucide-react';
import type { Locale } from '../i18n';
import { Spinner } from '../components/Spinner';

export function LoginPage() {
  const { login } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
    } catch {
      setError(t('loginError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4 bg-surface">
      {/* Subtle background decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-48 -top-48 h-[600px] w-[600px] rounded-full bg-primary-100/50 blur-[120px]" />
        <div className="absolute -bottom-48 -left-48 h-[500px] w-[500px] rounded-full bg-accent-light/40 blur-[120px] dark:bg-accent/5" />
      </div>

      {/* Controls */}
      <div className="fixed right-4 top-4 z-10 flex items-center gap-1">
        <button
          onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl' as Locale)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-card hover:text-ink dark:hover:bg-card-dark"
        >
          <Globe size={14} />
          {locale === 'pl' ? 'DE' : 'PL'}
        </button>
        <button
          onClick={toggle}
          className="rounded-lg p-2 text-muted transition hover:bg-card hover:text-ink dark:hover:bg-card-dark"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative w-[calc(100%-1rem)] sm:w-full max-w-sm card rounded-2xl p-5 sm:p-8 animate-scale-in"
      >
        <div className="mb-8 text-center">
          {/* Icon */}
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-600 text-white">
            <Truck size={28} />
          </div>
          <img src="https://ltslog.de/logo.png" alt="LTS" className="mx-auto mb-3 h-10 dark:brightness-200 dark:contrast-50" />
          <h1 className="text-xl font-bold tracking-tight text-ink">{t('loginTitle')}</h1>
          <p className="mt-1.5 text-sm text-muted">{t('loginSubtitle')}</p>
        </div>

        {error && (
          <div className="mb-4 animate-slide-up rounded-lg bg-danger/5 px-4 py-3 text-sm font-medium text-danger border border-danger/15">
            {error}
          </div>
        )}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('loginPlaceholder')}
          autoFocus
          required
          className="input mb-4 w-full rounded-xl px-4 py-3.5 text-sm"
        />

        <button
          type="submit"
          disabled={loading}
          className="btn-press flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-primary-700 disabled:opacity-50"
        >
          {loading ? <Spinner size="sm" className="border-white/30 border-t-white" /> : t('login')}
        </button>
      </form>
    </div>
  );
}

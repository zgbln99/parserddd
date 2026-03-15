import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { Sun, Moon, Globe, Lock } from 'lucide-react';
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 p-4 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Decorative background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-40 -top-40 h-96 w-96 rounded-full bg-primary-200/30 blur-3xl dark:bg-primary-900/20" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary-300/20 blur-3xl dark:bg-primary-800/10" />
      </div>

      {/* Controls in top-right */}
      <div className="fixed right-4 top-4 z-10 flex items-center gap-1">
        <button
          onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl' as Locale)}
          className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-white/80 dark:text-gray-400 dark:hover:bg-gray-800/80"
        >
          <Globe size={14} />
          {locale === 'pl' ? 'DE' : 'PL'}
        </button>
        <button
          onClick={toggle}
          className="rounded-xl p-2 text-gray-500 transition hover:bg-white/80 dark:text-gray-400 dark:hover:bg-gray-800/80"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm animate-scale-in rounded-2xl bg-white/80 p-8 shadow-xl shadow-gray-200/50 ring-1 ring-gray-900/5 backdrop-blur-xl dark:bg-gray-900/80 dark:shadow-none dark:ring-white/10"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg shadow-primary-200 dark:shadow-primary-900/30">
            <Lock size={28} className="text-white" />
          </div>
          <img src="https://ltslog.de/logo.png" alt="LTS" className="mx-auto mb-3 h-10" />
          <h1 className="text-xl font-bold tracking-tight">{t('loginTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('loginSubtitle')}</p>
        </div>

        {error && (
          <div className="mb-4 animate-slide-up rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 ring-1 ring-red-100 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800/50">
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
          className="mb-4 w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm outline-none transition-all duration-200 focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800/50 dark:focus:bg-gray-800 dark:focus:border-primary-400 dark:focus:ring-primary-900/40"
        />

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary-600 to-primary-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-200 transition-all duration-200 hover:from-primary-700 hover:to-primary-800 hover:shadow-primary-300 disabled:opacity-50 dark:shadow-none dark:from-primary-500 dark:to-primary-600 dark:hover:from-primary-600 dark:hover:to-primary-700"
        >
          {loading ? <Spinner size="sm" className="border-white/30 border-t-white" /> : t('login')}
        </button>
      </form>
    </div>
  );
}

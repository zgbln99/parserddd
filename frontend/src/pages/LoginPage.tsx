import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { Sun, Moon, Globe } from 'lucide-react';
import type { Locale } from '../i18n';

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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
      {/* Controls in top-right */}
      <div className="fixed right-4 top-4 flex items-center gap-1">
        <button
          onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl' as Locale)}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-white dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <Globe size={14} />
          {locale === 'pl' ? 'DE' : 'PL'}
        </button>
        <button
          onClick={toggle}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-white dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800"
      >
        <div className="mb-6 text-center">
          <img src="https://ltslog.de/logo.png" alt="LTS" className="mx-auto mb-4 h-12" />
          <h1 className="text-xl font-bold tracking-tight">{t('loginTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('loginSubtitle')}</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 ring-1 ring-red-100 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800">
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
          className="mb-4 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:border-primary-400 dark:focus:ring-primary-900/40"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50 dark:bg-primary-500 dark:hover:bg-primary-600"
        >
          {loading ? '...' : t('login')}
        </button>
      </form>
    </div>
  );
}

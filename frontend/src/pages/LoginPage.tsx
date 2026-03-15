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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Animated gradient background */}
      <div className="pointer-events-none fixed inset-0 bg-mesh" />
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-32 -top-32 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-blue-400/30 to-violet-400/30 blur-[100px] animate-glow-pulse dark:from-blue-600/15 dark:to-violet-600/15" />
        <div className="absolute -bottom-32 -left-32 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-pink-400/20 to-amber-400/20 blur-[100px] animate-glow-pulse dark:from-pink-600/10 dark:to-amber-600/10" style={{ animationDelay: '1.5s' }} />
        <div className="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-cyan-400/10 to-blue-400/10 blur-[80px] dark:from-cyan-600/5 dark:to-blue-600/5" />
      </div>

      {/* Controls */}
      <div className="fixed right-4 top-4 z-10 flex items-center gap-1">
        <button
          onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl' as Locale)}
          className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-white/60 dark:text-gray-400 dark:hover:bg-white/5"
        >
          <Globe size={14} />
          {locale === 'pl' ? 'DE' : 'PL'}
        </button>
        <button
          onClick={toggle}
          className="rounded-xl p-2 text-gray-500 transition hover:bg-white/60 dark:text-gray-400 dark:hover:bg-white/5"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm glass-card rounded-3xl p-8 animate-scale-in"
      >
        <div className="mb-8 text-center">
          {/* Icon */}
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-violet-600 shadow-xl shadow-blue-500/25 dark:shadow-blue-500/10">
            <Lock size={32} className="text-white" />
          </div>
          <img src="https://ltslog.de/logo.png" alt="LTS" className="mx-auto mb-3 h-10 dark:brightness-200 dark:contrast-50" />
          <h1 className="text-xl font-bold tracking-tight">{t('loginTitle')}</h1>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{t('loginSubtitle')}</p>
        </div>

        {error && (
          <div className="mb-4 animate-slide-up rounded-xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-600 ring-1 ring-rose-500/20 dark:text-rose-400">
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
          className="glass-input mb-4 w-full rounded-xl px-4 py-3.5 text-sm outline-none"
        />

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 via-blue-600 to-violet-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-300 hover:shadow-blue-500/40 hover:brightness-110 disabled:opacity-50 dark:shadow-blue-500/10 dark:hover:shadow-blue-500/20"
        >
          {loading ? <Spinner size="sm" className="border-white/30 border-t-white" /> : t('login')}
        </button>
      </form>
    </div>
  );
}

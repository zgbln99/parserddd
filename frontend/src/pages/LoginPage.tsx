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
    <div className="relative flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-primary-900 via-primary-800 to-indigo-900">
      {/* Animated background orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-32 -top-32 h-[500px] w-[500px] rounded-full bg-primary-500/20 blur-[100px] animate-pulse" />
        <div className="absolute -bottom-32 -left-32 h-[400px] w-[400px] rounded-full bg-indigo-500/20 blur-[100px] animate-pulse [animation-delay:1s]" />
        <div className="absolute left-1/2 top-1/3 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-blue-400/10 blur-[80px] animate-pulse [animation-delay:2s]" />
      </div>

      {/* Controls */}
      <div className="fixed right-4 top-4 z-10 flex items-center gap-1">
        <button
          onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl' as Locale)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <Globe size={14} />
          {locale === 'pl' ? 'DE' : 'PL'}
        </button>
        <button
          onClick={toggle}
          className="rounded-lg p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative w-[calc(100%-1rem)] sm:w-full max-w-sm rounded-3xl border border-white/10 bg-white/10 p-5 sm:p-8 backdrop-blur-xl shadow-2xl animate-scale-in"
      >
        <div className="mb-8 text-center">
          <img src="/logo.png" alt="LTS" className="mx-auto mb-4 h-14 brightness-0 invert" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <h1 className="text-2xl font-bold tracking-tight text-white">{t('loginTitle')}</h1>
          <p className="mt-1.5 text-sm text-white/60">{t('loginSubtitle')}</p>
        </div>

        {error && (
          <div className="mb-4 animate-slide-up rounded-lg bg-red-500/20 px-4 py-3 text-sm font-medium text-red-200 border border-red-400/20">
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
          className="mb-4 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-sm text-white placeholder-white/40 backdrop-blur-sm outline-none transition focus:border-white/40 focus:bg-white/15 focus:ring-2 focus:ring-white/10"
        />

        <button
          type="submit"
          disabled={loading}
          className="btn-press flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-primary-700 shadow-lg transition-all duration-200 hover:bg-white/90 hover:shadow-xl disabled:opacity-50"
        >
          {loading ? <Spinner size="sm" /> : t('login')}
        </button>
      </form>
    </div>
  );
}

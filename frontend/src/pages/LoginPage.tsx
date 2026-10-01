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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch {
      setError(t('loginError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-rail p-4">
      {/* Quiet depth: one soft accent glow behind the form */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-500/15 blur-[120px]" />
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
        className="relative w-[calc(100%-1rem)] sm:w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] p-5 sm:p-8 backdrop-blur-xl animate-scale-in"
      >
        <div className="mb-8 text-center">
          <img src="/logo.png" alt="LTS" className="mx-auto mb-4 h-14" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <h1 className="text-2xl font-bold tracking-tight text-white">{t('loginTitle')}</h1>
          <p className="mt-1.5 text-sm text-white/60">{t('loginSubtitle')}</p>
        </div>

        {error && (
          <div className="mb-4 animate-slide-up rounded-lg bg-red-500/20 px-4 py-3 text-sm font-medium text-red-200 border border-red-400/20">
            {error}
          </div>
        )}

        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('loginUsernamePlaceholder')}
          autoComplete="username"
          autoFocus
          required
          className="mb-3 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-sm text-white placeholder-white/40 backdrop-blur-sm outline-none transition focus:border-white/40 focus:bg-white/15 focus:ring-2 focus:ring-white/10"
        />
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('loginPlaceholder')}
          required
          className="mb-4 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-sm text-white placeholder-white/40 backdrop-blur-sm outline-none transition focus:border-white/40 focus:bg-white/15 focus:ring-2 focus:ring-white/10"
        />

        <button
          type="submit"
          disabled={loading}
          className="btn-press flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-3.5 text-sm font-bold text-white transition-all duration-200 hover:bg-primary-400 disabled:opacity-50"
        >
          {loading ? <Spinner size="sm" /> : t('login')}
        </button>
      </form>
    </div>
  );
}

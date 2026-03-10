import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, FileText, RefreshCw, Sun, Moon, Globe, LogOut, Calendar, X } from 'lucide-react';
import { useI18n, type Locale } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { useDateFilter } from '../hooks/useDateFilter';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'navDashboard' as const },
  { to: '/drivers', icon: Users, labelKey: 'navDrivers' as const },
  { to: '/reader', icon: FileText, labelKey: 'navReader' as const },
  { to: '/sync', icon: RefreshCw, labelKey: 'navSync' as const },
];

export function Layout({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const { logout } = useAuth();
  const { dateFrom, dateTo, setDateFrom, setDateTo, clear } = useDateFilter();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top Nav */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-lg dark:border-gray-800 dark:bg-gray-950/80">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <img src="https://ltslog.de/logo.png" alt="LTS" className="h-7" />
            <span className="text-sm font-bold tracking-tight">{t('appName')}</span>
          </div>

          {/* Nav links */}
          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {navItems.map(({ to, icon: Icon, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200',
                  )
                }
              >
                <Icon size={16} />
                {t(labelKey)}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Controls */}
          <div className="flex items-center gap-1">
            {/* Language toggle */}
            <button
              onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl' as Locale)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              title={locale === 'pl' ? 'Deutsch' : 'Polski'}
            >
              <Globe size={14} />
              {locale === 'pl' ? 'DE' : 'PL'}
            </button>

            {/* Theme toggle */}
            <button
              onClick={toggle}
              className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">{t('logout')}</span>
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-gray-100 px-4 dark:border-gray-800 md:hidden">
          {navItems.map(({ to, icon: Icon, labelKey }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium',
                  isActive
                    ? 'border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400',
                )
              }
            >
              <Icon size={14} />
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Global date filter bar */}
      <div className="border-b border-gray-100 bg-gray-50/80 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/80">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2 sm:px-6">
          <Calendar size={14} className="text-gray-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('globalDateFilter')}:</span>
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('detailFrom')}:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:[color-scheme:dark]"
          />
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('detailTo')}:</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:[color-scheme:dark]"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={clear}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <X size={12} />
              {t('clear')}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

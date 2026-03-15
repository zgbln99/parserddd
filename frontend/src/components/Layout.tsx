import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, RefreshCw, Sun, Moon, Globe, LogOut,
  Calendar, X, Shield, UserCog, GitCompareArrows, Receipt, Truck,
  Menu, ChevronLeft,
} from 'lucide-react';
import { useI18n, type Locale } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { useDateFilter } from '../hooks/useDateFilter';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

const baseNavItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'navDashboard' as const },
  { to: '/drivers', icon: Users, labelKey: 'navDrivers' as const },
  { to: '/reader', icon: FileText, labelKey: 'navReader' as const },
];

export function Layout({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const { logout, isAdmin } = useAuth();
  const { dateFrom, dateTo, setDateFrom, setDateTo, clear } = useDateFilter();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    ...baseNavItems,
    ...(isAdmin
      ? [
          { to: '/compare', icon: GitCompareArrows, labelKey: 'navCompare' as const },
          { to: '/settlement', icon: Receipt, labelKey: 'navSettlement' as const },
          { to: '/vehicles', icon: Truck, labelKey: 'navVehicles' as const },
          { to: '/config', icon: UserCog, labelKey: 'navDriverConfig' as const },
          { to: '/admin', icon: Shield, labelKey: 'navAdmin' as const },
        ]
      : [{ to: '/sync', icon: RefreshCw, labelKey: 'navSync' as const }]
    ),
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200/80 bg-white transition-transform duration-300 dark:border-gray-800 dark:bg-gray-900 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-gray-100 px-5 dark:border-gray-800">
          <img src="https://ltslog.de/logo.png" alt="LTS" className="h-8" />
          <div className="min-w-0 flex-1">
            <span className="block text-sm font-bold tracking-tight">{t('appName')}</span>
            <span className="text-[10px] font-medium text-gray-400">LTS Logistik GmbH</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 lg:hidden dark:hover:bg-gray-800"
          >
            <ChevronLeft size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-1">
            {navItems.map(({ to, icon: Icon, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-primary-50 text-primary-700 shadow-sm shadow-primary-100 dark:bg-primary-900/20 dark:text-primary-400 dark:shadow-none'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200',
                  )
                }
              >
                <Icon size={18} className="shrink-0" />
                {t(labelKey)}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Bottom controls */}
        <div className="border-t border-gray-100 p-3 dark:border-gray-800">
          {isAdmin && (
            <span className="mb-2 inline-flex items-center rounded-lg bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:bg-red-900/20 dark:text-red-400">
              Admin
            </span>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl' as Locale)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              title={locale === 'pl' ? 'Deutsch' : 'Polski'}
            >
              <Globe size={14} />
              {locale === 'pl' ? 'DE' : 'PL'}
            </button>
            <button
              onClick={toggle}
              className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="flex-1" />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-red-500 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">{t('logout')}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col lg:pl-64">
        {/* Top bar (mobile + date filter) */}
        <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/80 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/80">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <Menu size={20} />
            </button>

            {/* Date filter */}
            <Calendar size={14} className="hidden text-gray-400 sm:block" />
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {[
                { label: t('filterThisMonth'), fn: () => { const now = new Date(); setDateFrom(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`); const last = new Date(now.getFullYear(), now.getMonth()+1, 0); setDateTo(`${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`); }},
                { label: t('filterLastMonth'), fn: () => { const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth()-1, 1); const last = new Date(now.getFullYear(), now.getMonth(), 0); setDateFrom(`${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,'0')}-01`); setDateTo(`${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`); }},
                { label: t('filterLast30'), fn: () => { const now = new Date(); const past = new Date(now.getTime() - 30*86400000); setDateFrom(`${past.getFullYear()}-${String(past.getMonth()+1).padStart(2,'0')}-${String(past.getDate()).padStart(2,'0')}`); setDateTo(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`); }},
              ].map(({ label, fn }) => (
                <button
                  key={label}
                  onClick={fn}
                  className="hidden rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 sm:inline-flex dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  {label}
                </button>
              ))}
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:border-gray-700 dark:text-gray-200 dark:[color-scheme:dark]"
              />
              <span className="text-xs text-gray-400">—</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-xs outline-none transition focus:border-primary-400 focus:ring-1 focus:ring-primary-200 dark:border-gray-700 dark:text-gray-200 dark:[color-scheme:dark]"
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

            {/* Mobile controls */}
            <div className="flex items-center gap-1 lg:hidden">
              <button
                onClick={toggle}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-4 py-6 pb-20 sm:px-6 lg:px-8 lg:pb-6">
          <div className="mx-auto max-w-[1400px] animate-fade-in">
            {children}
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/90 backdrop-blur-xl lg:hidden dark:border-gray-800 dark:bg-gray-950/90">
          <div className="flex items-stretch justify-around">
            {navItems.slice(0, 5).map(({ to, icon: Icon, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                    isActive
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-400 dark:text-gray-500',
                  )
                }
              >
                <Icon size={20} />
                <span className="truncate">{t(labelKey)}</span>
              </NavLink>
            ))}
            {navItems.length > 5 && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-gray-400 dark:text-gray-500"
              >
                <Menu size={20} />
                <span>{t('navMore') || 'Mehr'}</span>
              </button>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}

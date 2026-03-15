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
    <div className="flex min-h-screen bg-mesh">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col transition-transform duration-300 lg:translate-x-0',
          'border-r border-gray-200 bg-white dark:border-white/[0.06] dark:bg-slate-900',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="px-5 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 ring-1 ring-blue-100 dark:bg-white/10 dark:ring-white/10">
              <Truck size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight text-gray-900 dark:text-white">Tachoprüfung</span>
              <span className="text-[11px] font-medium text-gray-400 dark:text-slate-400">LTS Logistik GmbH</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 lg:hidden dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
          {isAdmin && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/20">
              <Shield size={12} className="text-amber-600 dark:text-amber-400" />
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Administrator</span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-gray-100 dark:bg-white/[0.08]" />

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Menu</p>
          <div className="space-y-0.5">
            {navItems.map(({ to, icon: Icon, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150',
                    isActive
                      ? 'bg-blue-50 text-blue-700 dark:bg-white/10 dark:text-white'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={clsx(
                      'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                      isActive
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 dark:bg-blue-500 dark:shadow-blue-500/30'
                        : 'bg-gray-100 text-gray-400 group-hover:text-gray-600 dark:bg-white/[0.06] dark:text-slate-400 dark:group-hover:text-slate-200',
                    )}>
                      <Icon size={16} />
                    </div>
                    <span>{t(labelKey)}</span>
                    {isActive && (
                      <div className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50 dark:bg-blue-400 dark:shadow-blue-400/50" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Bottom controls */}
        <div className="border-t border-gray-100 p-3 dark:border-white/[0.06]">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl' as Locale)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
              title={locale === 'pl' ? 'Deutsch' : 'Polski'}
            >
              <Globe size={14} />
              {locale === 'pl' ? 'DE' : 'PL'}
            </button>
            <button
              onClick={toggle}
              className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="flex-1" />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-gray-400 transition hover:bg-rose-50 hover:text-rose-500 dark:text-slate-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">{t('logout')}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col lg:pl-[272px]">
        {/* Top bar */}
        <header className="sticky top-0 z-30 glass border-b border-white/20 dark:border-white/5">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2.5 text-gray-500 hover:bg-black/5 lg:hidden dark:text-gray-400 dark:hover:bg-white/5 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <Menu size={22} />
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
                  className="hidden rounded-lg border border-white/30 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-white/40 sm:inline-flex dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
                >
                  {label}
                </button>
              ))}
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="glass-input rounded-lg px-3 py-2 text-sm sm:text-xs sm:px-2 sm:py-1 outline-none dark:[color-scheme:dark] min-h-[44px] sm:min-h-0"
              />
              <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="glass-input rounded-lg px-3 py-2 text-sm sm:text-xs sm:px-2 sm:py-1 outline-none dark:[color-scheme:dark] min-h-[44px] sm:min-h-0"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={clear}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-rose-500 transition hover:bg-rose-500/10"
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
                className="rounded-lg p-2 text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:pb-6">
          <div className="mx-auto max-w-[1400px] animate-fade-in">
            {children}
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-30 glass border-t border-white/20 lg:hidden dark:border-white/5">
          <div className="flex items-stretch justify-around">
            {navItems.slice(0, 5).map(({ to, icon: Icon, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors min-h-[56px] justify-center',
                    isActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-gray-400 dark:text-gray-500',
                  )
                }
              >
                <Icon size={22} />
                <span className="truncate">{t(labelKey)}</span>
              </NavLink>
            ))}
            {navItems.length > 5 && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium text-gray-400 dark:text-gray-500 min-h-[56px] justify-center"
              >
                <Menu size={22} />
                <span>{t('navMore')}</span>
              </button>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}

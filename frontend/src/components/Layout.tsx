import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, RefreshCw, Sun, Moon, Globe, LogOut,
  Calendar, X, Shield, UserCog, GitCompareArrows, Receipt, Truck, Gauge, Coins,
  Menu, ChevronLeft, ShieldAlert, Route, MoonStar,
} from 'lucide-react';
import { useI18n, type Locale } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { useDateFilter } from '../hooks/useDateFilter';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

const baseNavItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'navDashboard' as const, permission: 'dashboard' },
  { to: '/drivers', icon: Users, labelKey: 'navDrivers' as const, permission: 'drivers' },
  { to: '/reader', icon: FileText, labelKey: 'navReader' as const, permission: 'reader' },
  { to: '/verstosse', icon: ShieldAlert, labelKey: 'navVerstosse' as const, permission: 'verstosse' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const { logout, isAdmin, isDispatcher, role, hasPermission } = useAuth();
  const { dateFrom, dateTo, setDateFrom, setDateTo, clear } = useDateFilter();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const allNavItems = [
    ...baseNavItems,
    ...(isDispatcher
      ? [
          { to: '/compare', icon: GitCompareArrows, labelKey: 'navCompare' as const, permission: 'compare' },
          { to: '/settlement', icon: Receipt, labelKey: 'navSettlement' as const, permission: 'settlement' },
          { to: '/vehicles', icon: Truck, labelKey: 'navVehicles' as const, permission: 'vehicles' },
          { to: '/driver-km', icon: Gauge, labelKey: 'navDriverKm' as const, permission: 'driver_km' },
          { to: '/toll', icon: Coins, labelKey: 'navTollCollect' as const, permission: 'toll' },
          { to: '/samsara-km', icon: Route, labelKey: 'navSamsaraKm' as const, permission: 'samsara_km' },
        ]
      : []
    ),
    ...(isAdmin
      ? [
          { to: '/config', icon: UserCog, labelKey: 'navDriverConfig' as const, permission: 'config' },
          { to: '/night-sim', icon: MoonStar, labelKey: 'navNightSim' as const, permission: 'night_sim' },
          { to: '/admin', icon: Shield, labelKey: 'navAdmin' as const, permission: 'admin' },
        ]
      : []
    ),
    ...(!isAdmin && !isDispatcher && hasPermission('sync')
      ? [{ to: '/sync', icon: RefreshCw, labelKey: 'navSync' as const, permission: 'sync' }]
      : []
    ),
  ];

  // Filter by permissions
  const navItems = allNavItems.filter((item) => hasPermission(item.permission));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col transition-transform duration-300 lg:translate-x-0',
          'sidebar',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="px-5 pb-4 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white">
              <Truck size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-sm font-bold leading-tight text-ink">Tachoprüfung</span>
              <span className="text-[11px] font-medium text-muted">LTS Logistik GmbH</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink lg:hidden"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
          {(role === 'admin' || role === 'dispatcher') && (
            <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-1.5 ${
              role === 'admin' ? 'bg-accent-light' : 'bg-blue-50 dark:bg-blue-900/20'
            }`}>
              <Shield size={12} className={role === 'admin' ? 'text-accent-dark' : 'text-blue-600'} />
              <span className={`text-[11px] font-semibold ${
                role === 'admin' ? 'text-accent-dark' : 'text-blue-700 dark:text-blue-400'
              }`}>
                {role === 'admin' ? 'Administrator' : t('roleDispatcher')}
              </span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-border" />

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted">Menu</p>
          <div className="space-y-0.5">
            {navItems.map(({ to, icon: Icon, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150',
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-muted hover:bg-surface hover:text-ink',
                  )
                }
              >
                <Icon size={18} />
                <span>{t(labelKey)}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Bottom controls */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setLocale(locale === 'pl' ? 'de' : 'pl' as Locale)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted transition hover:bg-surface hover:text-ink"
              title={locale === 'pl' ? 'Deutsch' : 'Polski'}
            >
              <Globe size={14} />
              {locale === 'pl' ? 'DE' : 'PL'}
            </button>
            <button
              onClick={toggle}
              className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-ink"
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="flex-1" />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted transition hover:bg-danger/5 hover:text-danger dark:hover:text-danger"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">{t('logout')}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col lg:pl-[260px]">
        {/* Top bar */}
        <header className="sticky top-0 z-30 topbar">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2.5 text-muted hover:bg-surface lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <Menu size={22} />
            </button>

            {/* Date filter */}
            <Calendar size={14} className="hidden text-muted sm:block" />
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {[
                { label: t('filterThisMonth'), fn: () => { const now = new Date(); setDateFrom(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`); const last = new Date(now.getFullYear(), now.getMonth()+1, 0); setDateTo(`${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`); }},
                { label: t('filterLastMonth'), fn: () => { const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth()-1, 1); const last = new Date(now.getFullYear(), now.getMonth(), 0); setDateFrom(`${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,'0')}-01`); setDateTo(`${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`); }},
                { label: t('filterLast30'), fn: () => { const now = new Date(); const past = new Date(now.getTime() - 30*86400000); setDateFrom(`${past.getFullYear()}-${String(past.getMonth()+1).padStart(2,'0')}-${String(past.getDate()).padStart(2,'0')}`); setDateTo(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`); }},
              ].map(({ label, fn }) => (
                <button
                  key={label}
                  onClick={fn}
                  className="hidden rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-primary-300 hover:text-ink sm:inline-flex"
                >
                  {label}
                </button>
              ))}
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input rounded-lg px-3 py-2 text-sm sm:text-xs sm:px-2 sm:py-1 dark:[color-scheme:dark] min-h-[44px] sm:min-h-0"
              />
              <span className="text-xs text-muted">—</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="input rounded-lg px-3 py-2 text-sm sm:text-xs sm:px-2 sm:py-1 dark:[color-scheme:dark] min-h-[44px] sm:min-h-0"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={clear}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger transition hover:bg-danger/5"
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
                className="rounded-lg p-2 text-muted hover:bg-surface"
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
        <nav className="fixed inset-x-0 bottom-0 z-30 topbar border-t border-border lg:hidden safe-bottom">
          <div className="flex items-stretch justify-around">
            {navItems.slice(0, 5).map(({ to, icon: Icon, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors min-h-[56px] justify-center',
                    isActive
                      ? 'text-primary-600'
                      : 'text-muted',
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
                className="flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium text-muted min-h-[56px] justify-center"
              >
                <Menu size={20} />
                <span>{t('navMore')}</span>
              </button>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, RefreshCw, Sun, Moon, Globe, LogOut,
  Calendar, X, Shield, UserCog, Truck, Gauge, Coins, ClipboardCheck,
  Menu, ChevronLeft, ChevronRight, Route, PanelLeftClose, PanelLeftOpen,
  Palette, Clock, ShieldCheck, Search,
} from 'lucide-react';
import { NotificationCenter } from './NotificationCenter';
import { prefetchRoute } from '../lib/prefetch';
import { useI18n, type Locale } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { useDateFilter } from '../hooks/useDateFilter';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { AccentPicker } from './AccentPicker';
import { PageTransition } from './PageTransition';
import { MonthSelect } from './MonthSelect';
import { monthRange, dateRangeToMonth } from '../lib/utils';

const baseNavItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'navDashboard' as const, permission: 'dashboard' },
  { to: '/drivers', icon: Users, labelKey: 'navDrivers' as const, permission: 'drivers' },
  { to: '/reader', icon: FileText, labelKey: 'navReader' as const, permission: 'reader' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const { logout, role, hasPermission, companyName } = useAuth();
  const { dateFrom, dateTo, setDateFrom, setDateTo, clear } = useDateFilter();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ddd-sidebar') === 'collapsed');
  const [accentOpen, setAccentOpen] = useState(false);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('ddd-sidebar', next ? 'collapsed' : 'expanded');
      return next;
    });
  };

  // Catalogue of every nav item. The `hasPermission` filter below decides
  // which ones the current user actually sees — that's also how per-user
  // grants work (an admin can give a 'user'-role account `vehicles` and
  // they'll see the Pojazdy entry without changing their role).
  const allNavItems = [
    ...baseNavItems,
    { to: '/payroll', icon: ClipboardCheck, labelKey: 'navPayroll' as const, permission: 'settlement' },
    { to: '/stundenzettel', icon: FileText, labelKey: 'navStundenzettel' as const, permission: 'settlement' },
    { to: '/bulk-grid', icon: Users, labelKey: 'navBulkGrid' as const, permission: 'settlement' },
    { to: '/arbeitszeitbericht', icon: Clock, labelKey: 'navArbeitszeitbericht' as const, permission: 'settlement' },
    { to: '/compliance', icon: ShieldCheck, labelKey: 'navCompliance' as const, permission: 'settlement' },
    { to: '/vehicles', icon: Truck, labelKey: 'navVehicles' as const, permission: 'vehicles' },
    { to: '/odometer', icon: Gauge, labelKey: 'navOdometer' as const, permission: 'vehicles' },
    { to: '/driver-km', icon: Gauge, labelKey: 'navDriverKm' as const, permission: 'driver_km' },
    { to: '/toll', icon: Coins, labelKey: 'navTollCollect' as const, permission: 'toll' },
    { to: '/samsara-km', icon: Route, labelKey: 'navSamsaraKm' as const, permission: 'samsara_km' },
    { to: '/sync', icon: RefreshCw, labelKey: 'navSync' as const, permission: 'sync' },
    { to: '/config', icon: UserCog, labelKey: 'navDriverConfig' as const, permission: 'config' },
    { to: '/admin', icon: Shield, labelKey: 'navAdmin' as const, permission: 'admin' },
  ];

  // Filter by permissions — single source of truth.
  const navItems = allNavItems.filter((item) => hasPermission(item.permission));

  // Group nav items into compact sections
  type NavItem = typeof navItems[number];
  const navSections: { label: string; items: NavItem[] }[] = [];

  const mainKeys = new Set(['/', '/drivers', '/reader']);
  const mainItems = navItems.filter(i => mainKeys.has(i.to));
  if (mainItems.length > 0) navSections.push({ label: 'Menu', items: mainItems });

  const payrollKeys = new Set(['/payroll', '/stundenzettel', '/bulk-grid', '/arbeitszeitbericht', '/compliance']);
  const payrollItems = navItems.filter(i => payrollKeys.has(i.to));
  if (payrollItems.length > 0) navSections.push({ label: locale === 'de' ? 'Abrechnung' : 'Rozliczenia', items: payrollItems });

  const vehicleKeys = new Set(['/vehicles', '/odometer', '/driver-km', '/toll', '/samsara-km']);
  const vehicleItems = navItems.filter(i => vehicleKeys.has(i.to));
  if (vehicleItems.length > 0) navSections.push({ label: locale === 'de' ? 'Fahrzeuge & Maut' : 'Pojazdy i maut', items: vehicleItems });

  const adminKeys = new Set(['/config', '/admin', '/sync']);
  const adminItems = navItems.filter(i => adminKeys.has(i.to));
  if (adminItems.length > 0) navSections.push({ label: locale === 'de' ? 'Einstellungen' : 'Ustawienia', items: adminItems });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarPx = collapsed ? 72 : 280;

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
          'fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 lg:translate-x-0',
          'sidebar',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Use inline style for reliable width transition on desktop */}
        <div
          className="flex h-full flex-col transition-[width] duration-300 overflow-hidden"
          style={{ width: sidebarOpen ? 280 : sidebarPx }}
        >
          {/* Brand */}
          <div className={clsx('pb-4 pt-6', collapsed && !sidebarOpen ? 'px-3' : 'px-5')}>
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="LTS" className="h-10 w-10 shrink-0 rounded-lg object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling!.classList.remove('hidden'); }} />
              <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-white">
                <Truck size={20} />
              </div>
              {(!collapsed || sidebarOpen) && (
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-bold leading-tight text-ink">Tachoprüfung</span>
                  <span className="text-[11px] font-medium text-muted">{companyName}</span>
                </div>
              )}
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink lg:hidden"
              >
                <ChevronLeft size={18} />
              </button>
            </div>
            {(!collapsed || sidebarOpen) && (role === 'admin' || role === 'dispatcher') && (
              <div className="mt-3 flex items-center gap-2 rounded-lg px-3 py-1.5 bg-[rgba(87,80,241,0.07)] dark:bg-[rgba(87,80,241,0.12)]">
                <Shield size={12} className="text-primary-500" />
                <span className="text-[11px] font-medium text-primary-500">
                  {role === 'admin' ? 'Administrator' : t('roleDispatcher')}
                </span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-4 h-px bg-border" />

          {/* Navigation — grouped sections like NextAdmin */}
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {navSections.map((section, si) => (
              <div key={section.label} className={si > 0 ? 'mt-4' : ''}>
                {(!collapsed || sidebarOpen) && (
                  <p className="mb-2 px-3.5 text-[11px] font-semibold uppercase tracking-wider text-[#9ca3af] dark:text-[#6b7280]">
                    {section.label}
                  </p>
                )}
                {collapsed && !sidebarOpen && si > 0 && (
                  <div className="mx-3 mb-2 h-px bg-[#e5e7eb] dark:bg-[#374151]" />
                )}
                <div className="space-y-0.5">
                  {section.items.map(({ to, icon: Icon, labelKey }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      onClick={() => setSidebarOpen(false)}
                      onMouseEnter={() => prefetchRoute(to)}
                      onFocus={() => prefetchRoute(to)}
                      title={collapsed && !sidebarOpen ? t(labelKey) : undefined}
                      className={({ isActive }) =>
                        clsx(
                          'group relative flex items-center rounded-lg font-medium text-[#4b5563] transition-all duration-200 dark:text-[#9ca3af]',
                          collapsed && !sidebarOpen
                            ? 'justify-center px-2 py-2.5'
                            : 'gap-3 px-3.5 py-2',
                          isActive
                            ? 'bg-[rgba(87,80,241,0.07)] font-semibold !text-[#5750f1] dark:bg-[#FFFFFF1A] dark:!text-white before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-[#5750f1]'
                            : 'hover:bg-[#f3f4f6] hover:text-[#111928] dark:hover:bg-[#FFFFFF1A] dark:hover:text-white',
                        )
                      }
                    >
                      <Icon size={18} />
                      {(!collapsed || sidebarOpen) && (
                        <span className="text-[14px]">{t(labelKey)}</span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Recent analyses */}
          {(!collapsed || sidebarOpen) && (() => {
            try {
              const recent = JSON.parse(localStorage.getItem('recent-analyses') || '[]') as { name: string; url: string }[];
              if (recent.length === 0) return null;
              return (
                <div className="border-t border-border px-3 py-3">
                  <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted">{t('recentAnalyses')}</p>
                  <div className="space-y-0.5">
                    {recent.slice(0, 5).map((r, i) => (
                      <NavLink
                        key={i}
                        to={r.url}
                        onClick={() => setSidebarOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-[#6b7280] transition-colors duration-200 hover:bg-gray-100 hover:text-ink dark:text-[#9ca3af] dark:hover:bg-[rgba(255,255,255,0.1)]"
                      >
                        <Clock size={12} />
                        <span className="truncate">{r.name}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              );
            } catch { return null; }
          })()}

          {/* Bottom controls */}
          <div className="border-t border-border p-3">
            {collapsed && !sidebarOpen ? (
              /* Collapsed: vertical icon buttons */
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={toggle}
                  className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-ink"
                  title={theme === 'dark' ? t('lightMode') : t('darkMode')}
                >
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </button>
                <button
                  onClick={() => setAccentOpen(true)}
                  className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-ink"
                  title="Accent color"
                >
                  <Palette size={16} />
                </button>
                <button
                  onClick={handleLogout}
                  className="rounded-lg p-2 text-muted transition hover:bg-danger/5 hover:text-danger"
                  title={t('logout')}
                >
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              /* Expanded: horizontal row */
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
                <button
                  onClick={() => setAccentOpen(true)}
                  className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-ink"
                  title="Accent color"
                >
                  <Palette size={16} />
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
            )}

            {/* Collapse toggle (desktop only) */}
            <button
              onClick={toggleCollapse}
              className="mt-2 hidden w-full items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-medium text-muted transition hover:bg-surface hover:text-ink lg:flex"
            >
              {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
              {!collapsed && <span>Zwiń</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* Inject dynamic sidebar offset for desktop */}
      <style>{`@media (min-width: 1024px) { .sidebar-offset { padding-left: ${sidebarPx}px; } }`}</style>

      {/* Main area */}
      <div className="sidebar-offset flex flex-1 flex-col transition-[padding-left] duration-300">
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
              <MonthSelect
                value={dateRangeToMonth(dateFrom, dateTo)}
                onChange={(v) => { if (v) { const r = monthRange(v); setDateFrom(r.from); setDateTo(r.to); } }}
                allowEmpty
                emptyLabel={t('filterCustomRange')}
                title={t('filterMonth')}
                className="input rounded-lg px-3 py-2 text-sm sm:text-xs sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0"
              />
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

            {/* Right cluster: search + notifications */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('app:open-search'))}
                className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-muted transition hover:border-primary-300 hover:text-ink"
                title={t('search')}
              >
                <Search size={16} />
                <span className="hidden md:inline">{t('search')}</span>
                <kbd className="hidden rounded border border-border px-1 py-0.5 text-[10px] lg:inline">⌘K</kbd>
              </button>
              <NotificationCenter />
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
          <div className="mx-auto max-w-[1800px]">
            <PageTransition>{children}</PageTransition>
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
                onTouchStart={() => prefetchRoute(to)}
                className={({ isActive }) =>
                  clsx(
                    'relative flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors min-h-[56px] justify-center',
                    isActive
                      ? 'font-semibold text-primary-600 before:absolute before:top-0 before:left-1/2 before:h-[3px] before:w-8 before:-translate-x-1/2 before:rounded-full before:bg-primary-600'
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

      {/* Accent color picker modal */}
      {accentOpen && <AccentPicker onClose={() => setAccentOpen(false)} />}
    </div>
  );
}

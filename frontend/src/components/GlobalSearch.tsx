import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LayoutDashboard, Users, FileText, RefreshCw, Shield, UserCog, Truck, Clock } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../hooks/useAuth';
import { fetchDrivers, fetchSamsaraVehicles } from '../lib/api';
import type { SamsaraVehicle } from '../lib/api';
import type { Driver } from '../types';

interface SearchItem {
  label: string;
  sub?: string;
  to: string;
  icon: typeof LayoutDashboard;
  keywords: string[];
}

export function GlobalSearch() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<SamsaraVehicle[]>([]);
  const loadedRef = useRef(false);

  const recent: { name: string; url: string }[] = (() => {
    try {
      return JSON.parse(localStorage.getItem('recent-analyses') || '[]');
    } catch {
      return [];
    }
  })();

  const pages: SearchItem[] = [
    { label: t('navDashboard'), to: '/', icon: LayoutDashboard, keywords: ['dashboard', 'pulpit', 'übersicht', 'home'] },
    { label: t('navDrivers'), to: '/drivers', icon: Users, keywords: ['drivers', 'kierowcy', 'fahrer'] },
    { label: t('navReader'), to: '/reader', icon: FileText, keywords: ['reader', 'czytnik', 'kartenleser', 'upload', 'ddd'] },
    { label: t('navSync'), to: '/sync', icon: RefreshCw, keywords: ['sync', 'synchronizacja', 'monitor'] },
    ...(isAdmin ? [
      { label: t('navVehicles'), to: '/vehicles', icon: Truck, keywords: ['vehicles', 'pojazdy', 'fahrzeuge', 'samsara', 'controlling'] },
      { label: t('navDriverConfig'), to: '/config', icon: UserCog, keywords: ['config', 'konfiguracja', 'pracownicy', 'mitarbeiter'] },
      { label: t('navAdmin'), to: '/admin', icon: Shield, keywords: ['admin', 'panel', 'users', 'logs'] },
      { label: t('navArbeitszeitbericht'), to: '/arbeitszeitbericht', icon: Clock, keywords: ['arbeitszeitbericht', 'raport', 'arbeitszeit', 'czas pracy', 'timeline', 'woche', 'tydzień'] },
    ] : []),
  ];

  const q = query.toLowerCase().trim();
  const pageResults = q
    ? pages.filter((item) => item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)))
    : pages;

  const driverResults: SearchItem[] = q
    ? drivers
        .filter((d) => d.name.toLowerCase().includes(q) || (d.card_number || '').toLowerCase().includes(q))
        .slice(0, 6)
        .map((d) => {
          const f = d.files?.[0];
          const to = f
            ? `/analysis?${new URLSearchParams({ path: f.path, name: f.name, driver: d.name })}`
            : '/drivers';
          return { label: d.name, sub: d.card_number || undefined, to, icon: Users, keywords: [] };
        })
    : [];

  const vehicleResults: SearchItem[] = q
    ? vehicles
        .filter((v) => v.name.toLowerCase().includes(q) || (v.license_plate || '').toLowerCase().includes(q))
        .slice(0, 6)
        .map((v) => ({ label: v.name, sub: v.license_plate || undefined, to: '/vehicles', icon: Truck, keywords: [] }))
    : [];

  const recentResults: SearchItem[] = recent
    .filter((r) => (q ? r.name.toLowerCase().includes(q) : true))
    .slice(0, 5)
    .map((r) => ({ label: r.name, sub: t('recentAnalyses'), to: r.url, icon: Clock, keywords: [] }));

  const results = q
    ? [...pageResults, ...driverResults, ...vehicleResults, ...recentResults]
    : [...pageResults, ...recentResults];

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Lazily load drivers the first time the palette opens (cached endpoint).
  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      fetchDrivers().then((r) => setDrivers(r.drivers || [])).catch(() => {});
      fetchSamsaraVehicles().then((r) => setVehicles(r.vehicles || [])).catch(() => {});
    }
  }, [open]);

  const handleSelect = useCallback((to: string) => {
    navigate(to);
    setOpen(false);
    setQuery('');
  }, [navigate]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    }
    function handleOpenEvent() {
      setOpen(true);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('app:open-search', handleOpenEvent);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('app:open-search', handleOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleKeyNav = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex].to);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[15vh] px-4 animate-fade-in">
      <div className="fixed inset-0 bg-black/30" onClick={() => { setOpen(false); setQuery(''); }} />
      <div className="relative w-full max-w-lg rounded-2xl card shadow-xl animate-scale-in overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search size={18} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyNav}
            placeholder={`${t('search')}... (Ctrl+K)`}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted text-ink"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{t('noData')}</p>
          ) : (
            results.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={`${item.to}-${i}`}
                  onClick={() => handleSelect(item.to)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    i === selectedIndex
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-ink hover:bg-surface'
                  }`}
                >
                  <Icon size={18} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  {item.sub && <span className="shrink-0 font-mono text-xs text-muted">{item.sub}</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

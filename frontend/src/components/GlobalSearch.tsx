import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LayoutDashboard, Users, FileText, RefreshCw, Shield, UserCog, GitCompareArrows, Receipt, Truck, MoonStar } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../hooks/useAuth';

interface SearchItem {
  label: string;
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

  const items: SearchItem[] = [
    { label: t('navDashboard'), to: '/', icon: LayoutDashboard, keywords: ['dashboard', 'pulpit', 'übersicht', 'home'] },
    { label: t('navDrivers'), to: '/drivers', icon: Users, keywords: ['drivers', 'kierowcy', 'fahrer'] },
    { label: t('navReader'), to: '/reader', icon: FileText, keywords: ['reader', 'czytnik', 'kartenleser', 'upload', 'ddd'] },
    { label: t('navSync'), to: '/sync', icon: RefreshCw, keywords: ['sync', 'synchronizacja', 'monitor'] },
    ...(isAdmin ? [
      { label: t('navCompare'), to: '/compare', icon: GitCompareArrows, keywords: ['compare', 'porównanie', 'vergleich'] },
      { label: t('navSettlement'), to: '/settlement', icon: Receipt, keywords: ['settlement', 'rozliczenie', 'abrechnung', 'datev'] },
      { label: t('navVehicles'), to: '/vehicles', icon: Truck, keywords: ['vehicles', 'pojazdy', 'fahrzeuge', 'samsara', 'controlling'] },
      { label: t('navDriverConfig'), to: '/config', icon: UserCog, keywords: ['config', 'konfiguracja', 'pracownicy', 'mitarbeiter'] },
      { label: t('navNightSim'), to: '/night-sim', icon: MoonStar, keywords: ['night', 'nocne', 'nacht', 'symulator', 'simulator', 'nachtschicht'] },
      { label: t('navAdmin'), to: '/admin', icon: Shield, keywords: ['admin', 'panel', 'users', 'logs'] },
    ] : []),
  ];

  const filtered = query.trim()
    ? items.filter((item) => {
        const q = query.toLowerCase();
        return item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q));
      })
    : items;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleKeyNav = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      handleSelect(filtered[selectedIndex].to);
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
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{t('noData')}</p>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.to}
                  onClick={() => handleSelect(item.to)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    i === selectedIndex
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-ink hover:bg-surface'
                  }`}
                >
                  <Icon size={18} className="shrink-0" />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

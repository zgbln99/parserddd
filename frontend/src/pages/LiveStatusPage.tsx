import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Truck, Coffee, Wrench, Clock, Users } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';

interface DriverStatus {
  id: string;
  name: string;
  status: string;
  since: string;
  duration_minutes: number;
}

const STATUS_CONFIG: Record<string, { icon: typeof Truck; color: string; bg: string; label: string }> = {
  driving: { icon: Truck, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800', label: 'Jazda' },
  work: { icon: Wrench, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800', label: 'Praca' },
  available: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800', label: 'Dyspozycyjność' },
  rest: { icon: Coffee, color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200 dark:bg-gray-800/50 dark:border-gray-700', label: 'Przerwa' },
};

function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

export function LiveStatusPage() {
  const { t } = useI18n();
  const [drivers, setDrivers] = useState<DriverStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetch('/api/samsara/live-status', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setDrivers(data.drivers || []);
        setLastUpdate(data.timestamp || '');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // Auto-refresh every 60s
    return () => clearInterval(id);
  }, [load]);

  const byStatus = {
    driving: drivers.filter(d => d.status === 'driving'),
    work: drivers.filter(d => d.status === 'work'),
    available: drivers.filter(d => d.status === 'available'),
    rest: drivers.filter(d => d.status === 'rest'),
    other: drivers.filter(d => !['driving', 'work', 'available', 'rest'].includes(d.status)),
  };

  return (
    <div className="animate-slide-up">
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/20">
          <Truck size={20} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('liveTitle')}</h1>
          {lastUpdate && <p className="text-xs text-muted">{t('liveLastUpdate')}: {fmtTime(lastUpdate)}</p>}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('refresh')}
        </button>
      </div>

      {error && (
        <Card className="mb-4 p-4">
          <p className="text-sm text-danger">{error}</p>
        </Card>
      )}

      {/* Stats bar */}
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['driving', 'work', 'available', 'rest'] as const).map(status => {
          const cfg = STATUS_CONFIG[status];
          const Icon = cfg.icon;
          const count = byStatus[status].length;
          return (
            <div key={status} className={`rounded-2xl border p-4 ${cfg.bg}`}>
              <div className="flex items-center gap-3">
                <Icon size={20} className={cfg.color} />
                <div>
                  <p className="text-2xl font-bold text-ink">{count}</p>
                  <p className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {loading && drivers.length === 0 && (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      )}

      {/* Driver cards grouped by status */}
      {(['driving', 'work', 'available', 'rest', 'other'] as const).map(status => {
        const list = byStatus[status];
        if (list.length === 0) return null;
        const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.rest;
        const Icon = cfg.icon;
        return (
          <div key={status} className="mb-6">
            <div className="mb-3 flex items-center gap-2">
              <Icon size={16} className={cfg.color} />
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
                {cfg.label} ({list.length})
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {list.map(d => (
                <Card key={d.id} className={`p-4 border-l-4 ${status === 'driving' ? 'border-l-emerald-500' : status === 'work' ? 'border-l-blue-500' : status === 'available' ? 'border-l-amber-500' : 'border-l-gray-300'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${status === 'driving' ? 'from-emerald-500 to-emerald-700' : status === 'work' ? 'from-blue-500 to-blue-700' : status === 'available' ? 'from-amber-500 to-amber-700' : 'from-gray-400 to-gray-600'} text-xs font-bold text-white`}>
                      {d.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{d.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant={status === 'driving' ? 'green' : status === 'work' ? 'blue' : status === 'available' ? 'orange' : 'gray'}>
                          {cfg.label}
                        </Badge>
                        <span className="text-xs text-muted">{fmtDuration(d.duration_minutes)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono text-muted">{fmtTime(d.since)}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      {drivers.length === 0 && !loading && !error && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-muted">
            <Users size={32} />
            <p className="text-sm">{t('liveNoData')}</p>
          </div>
        </Card>
      )}
    </div>
  );
}

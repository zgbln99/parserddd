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
  hos_status: string;
  vehicle: string;
  drive_remaining_min: number;
  shift_remaining_min: number;
  break_in_min: number;
}

const STATUS_CONFIG: Record<string, { icon: typeof Truck; color: string; bg: string; borderColor: string; gradientFrom: string; label: string }> = {
  driving: { icon: Truck, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800', borderColor: 'border-l-emerald-500', gradientFrom: 'bg-[#30d158]', label: 'Jazda' },
  work: { icon: Wrench, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800', borderColor: 'border-l-blue-500', gradientFrom: 'bg-[#0071e3]', label: 'Praca' },
  rest: { icon: Coffee, color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200 dark:bg-gray-800/50 dark:border-gray-700', borderColor: 'border-l-gray-400', gradientFrom: 'bg-[#86868b]', label: 'Przerwa / Wolne' },
  unknown: { icon: Users, color: 'text-gray-400', bg: 'bg-gray-50/50 border-gray-100 dark:bg-gray-800/30 dark:border-gray-700', borderColor: 'border-l-gray-300', gradientFrom: 'bg-[#aeaeb2]', label: 'Brak danych' },
};

function fmtDuration(min: number): string {
  if (min <= 0) return '0:00';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
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
        if (data.error) { setError(data.error); setLoading(false); return; }
        setDrivers(data.drivers || []);
        setLastUpdate(data.timestamp || '');
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const byStatus = {
    driving: drivers.filter(d => d.status === 'driving'),
    work: drivers.filter(d => d.status === 'work'),
    rest: drivers.filter(d => d.status === 'rest'),
    unknown: drivers.filter(d => d.status === 'unknown' || !['driving', 'work', 'rest'].includes(d.status)),
  };

  const fmtUpdateTime = lastUpdate ? new Date(lastUpdate).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

  return (
    <div className="animate-slide-up">
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#30d158] text-white">
          <Truck size={20} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('liveTitle')}</h1>
          {fmtUpdateTime && <p className="text-xs text-muted">{t('liveLastUpdate')}: {fmtUpdateTime}</p>}
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
        {(['driving', 'work', 'rest', 'unknown'] as const).map(status => {
          const cfg = STATUS_CONFIG[status];
          const Icon = cfg.icon;
          const count = byStatus[status].length;
          return (
            <div key={status} className={`rounded-xl border p-4 ${cfg.bg}`}>
              <div className="flex items-center gap-3">
                <Icon size={22} className={cfg.color} />
                <div>
                  <p className="text-3xl font-bold text-ink">{count}</p>
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
      {(['driving', 'work', 'rest', 'unknown'] as const).map(status => {
        const list = byStatus[status];
        if (list.length === 0) return null;
        const cfg = STATUS_CONFIG[status];
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
                <Card key={d.id} className={`p-4 border-l-4 ${cfg.borderColor}`}>
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cfg.gradientFrom} text-xs font-bold text-white`}>
                      {d.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{d.name}</p>
                      {d.vehicle && (
                        <p className="text-xs text-muted truncate">{d.vehicle}</p>
                      )}
                      {d.status !== 'unknown' && (
                      <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                        <div>
                          <p className="text-[10px] text-muted">Jazda</p>
                          <p className="text-xs font-bold text-ink">{fmtDuration(d.drive_remaining_min)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted">Zmiana</p>
                          <p className="text-xs font-bold text-ink">{fmtDuration(d.shift_remaining_min)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted">Przerwa za</p>
                          <p className="text-xs font-bold text-ink">{fmtDuration(d.break_in_min)}</p>
                        </div>
                      </div>
                      )}
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

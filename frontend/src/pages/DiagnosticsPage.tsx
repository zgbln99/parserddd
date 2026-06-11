import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wrench, RefreshCw, Search, AlertTriangle, Timer, Power } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { fetchVehicleLocations, type VehicleLocation } from '../lib/api';

/**
 * Vehicle diagnostics — engine state, idling time and OBD/J1939 fault codes
 * ("check engine") from the live Samsara snapshot.
 */

const REFRESH_MS = 60_000;
const IDLE_WARN = 15; // minutes

function fmtMin(m: number, de: boolean): string {
  if (!m) return '—';
  if (m < 60) return `${m} min`;
  return de ? `${Math.floor(m / 60)} Std ${m % 60} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function DiagnosticsPage() {
  const { locale } = useI18n();
  const de = locale === 'de';
  const [rows, setRows] = useState<VehicleLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);

  const load = useCallback(() => {
    fetchVehicleLocations()
      .then((r) => { setRows(r.vehicles || []); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const stats = useMemo(() => ({
    faults: rows.filter((r) => r.faults && r.faults.length > 0).length,
    idling: rows.filter((r) => r.idle_minutes >= IDLE_WARN).length,
    running: rows.filter((r) => r.engine_state === 'On' || r.engine_state === 'Idle').length,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((r) => {
      if (onlyIssues && !(r.faults?.length || r.idle_minutes >= IDLE_WARN)) return false;
      if (!q) return true;
      return r.vehicle_name.toLowerCase().includes(q);
    }).sort((a, b) => (b.faults?.length || 0) - (a.faults?.length || 0) || b.idle_minutes - a.idle_minutes);
  }, [rows, search, onlyIssues]);

  const engineBadge = (s: string | null) => {
    if (s === 'Idle') return <Badge variant="orange">{de ? 'Leerlauf' : 'Bieg jałowy'}</Badge>;
    if (s === 'On') return <Badge variant="green">{de ? 'An' : 'Wł.'}</Badge>;
    if (s === 'Off') return <Badge variant="gray">{de ? 'Aus' : 'Wył.'}</Badge>;
    return <span className="text-muted">—</span>;
  };

  return (
    <div className="animate-slide-up space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#60a5fa] to-[#3b82f6] text-white">
          <Wrench size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{de ? 'Diagnose' : 'Diagnostyka'}</h1>
          <p className="text-xs text-muted">{de ? 'Motorzustand, Leerlauf und Fehlercodes' : 'Stan silnika, bieg jałowy i kody usterek'}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={de ? 'Fehlercodes' : 'Kody usterek'} value={stats.faults} icon={<AlertTriangle size={20} />} color={stats.faults > 0 ? 'red' : 'green'} />
        <StatCard label={de ? `Leerlauf > ${IDLE_WARN} min` : `Bieg jałowy > ${IDLE_WARN} min`} value={stats.idling} icon={<Timer size={20} />} color={stats.idling > 0 ? 'orange' : 'green'} />
        <StatCard label={de ? 'Motor läuft' : 'Silnik pracuje'} value={stats.running} icon={<Power size={20} />} color="primary" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={de ? 'Fahrzeug…' : 'Pojazd…'}
            className="input w-full rounded-xl py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <button
          onClick={() => setOnlyIssues(!onlyIssues)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            onlyIssues ? 'bg-primary-600 text-white' : 'border border-border text-muted hover:bg-surface'
          }`}
        >
          {de ? 'Nur Auffälligkeiten' : 'Tylko z problemami'}
        </button>
        <div className="flex-1" />
        <button onClick={load} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<Wrench size={26} />} title={de ? 'Keine Daten' : 'Brak danych'} hint={onlyIssues ? (de ? 'Keine Auffälligkeiten 🎉' : 'Brak problemów 🎉') : undefined} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-black/[0.02] dark:bg-white/5">
                  {[de ? 'Fahrzeug' : 'Pojazd', de ? 'Motor' : 'Silnik', de ? 'Leerlauf' : 'Bieg jałowy', de ? 'Fehlercodes' : 'Kody usterek'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.vehicle_id} className="transition hover:bg-primary-50/40 dark:hover:bg-white/5">
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-ink">{r.vehicle_name}</td>
                    <td className="whitespace-nowrap px-4 py-3">{engineBadge(r.engine_state)}</td>
                    <td className={`whitespace-nowrap px-4 py-3 font-mono ${r.idle_minutes >= IDLE_WARN ? 'font-bold text-warning' : 'text-muted'}`}>
                      {fmtMin(r.idle_minutes, de)}
                    </td>
                    <td className="px-4 py-3">
                      {r.faults && r.faults.length ? (
                        <div className="flex flex-wrap gap-1">
                          {r.faults.slice(0, 4).map((f, i) => (
                            <span key={i} className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-300" title={f.description}>
                              {f.code}{f.description ? ` · ${f.description.slice(0, 28)}` : ''}
                            </span>
                          ))}
                          {r.faults.length > 4 && <span className="text-[11px] text-muted">+{r.faults.length - 4}</span>}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldAlert, RefreshCw, Search, Gauge, Truck, AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { fetchSafetyEvents, type SafetyEvent } from '../lib/api';

/**
 * Driving safety events from Samsara — harsh braking/acceleration, sharp
 * cornering, speeding, etc. Complements the tachograph (561/2006) violations
 * with how the trucks are actually being driven.
 */

const PERIODS = [1, 7, 14, 30];

function fmtTime(ts: string, de: boolean): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString(de ? 'de-DE' : 'pl-PL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function labelChip(label: string): { text: string; cls: string } {
  const l = label.toLowerCase();
  if (l.includes('speed')) return { text: label, cls: 'bg-red-500/15 text-red-600 dark:text-red-300' };
  if (l.includes('brak')) return { text: label, cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-300' };
  if (l.includes('accel')) return { text: label, cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' };
  if (l.includes('crash') || l.includes('collision')) return { text: label, cls: 'bg-red-600/20 text-red-700 dark:text-red-300' };
  return { text: label, cls: 'bg-primary-500/15 text-primary-600 dark:text-primary-300' };
}

export function SafetyEventsPage() {
  const { locale } = useI18n();
  const de = locale === 'de';

  const [events, setEvents] = useState<SafetyEvent[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback((d: number) => {
    setLoading(true);
    setError('');
    setUnavailable('');
    fetchSafetyEvents(d)
      .then((r) => {
        if (r.unavailable) setUnavailable(r.message || 'Safety API not available');
        setEvents(r.events || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return events;
    return events.filter((e) =>
      e.vehicle_name.toLowerCase().includes(q) ||
      e.driver_name.toLowerCase().includes(q) ||
      e.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }, [events, search]);

  const stats = useMemo(() => {
    const speeding = events.filter((e) => e.labels.some((l) => l.toLowerCase().includes('speed'))).length;
    const byDriver = new Map<string, number>();
    for (const e of events) {
      const k = e.driver_name || e.vehicle_name || '?';
      byDriver.set(k, (byDriver.get(k) || 0) + 1);
    }
    let topDriver = '—';
    let topCount = 0;
    for (const [k, n] of byDriver) if (n > topCount) { topCount = n; topDriver = k; }
    return { total: events.length, speeding, drivers: byDriver.size, topDriver, topCount };
  }, [events]);

  return (
    <div className="animate-slide-up space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#fb7185] to-[#ef4444] text-white">
          <ShieldAlert size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{de ? 'Fahrverhalten' : 'Wykroczenia jazdy'}</h1>
          <p className="text-xs text-muted">{de ? 'Sicherheitsereignisse aus Samsara' : 'Zdarzenia bezpieczeństwa z Samsary'}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={de ? 'Ereignisse' : 'Zdarzenia'} value={stats.total} icon={<ShieldAlert size={20} />} color="red" />
        <StatCard label={de ? 'Geschwindigkeit' : 'Prędkość'} value={stats.speeding} icon={<Gauge size={20} />} color="orange" />
        <StatCard label={de ? 'Betroffene Fahrer' : 'Kierowcy'} value={stats.drivers} icon={<Truck size={20} />} color="primary" />
        <StatCard label={de ? 'Auffälligster' : 'Najwięcej'} value={stats.topCount ? `${stats.topCount}` : '—'} icon={<AlertTriangle size={20} />} color="blue" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={de ? 'Fahrer, Fahrzeug, Typ…' : 'Kierowca, pojazd, typ…'}
            className="input w-full rounded-xl py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex gap-1.5">
          {PERIODS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                days === d ? 'bg-primary-600 text-white' : 'border border-border text-muted hover:bg-surface'
              }`}
            >
              {d === 1 ? (de ? '24 Std' : '24 h') : `${d} ${de ? 'Tage' : 'dni'}`}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => load(days)}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : unavailable ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={26} />}
            title={de ? 'Safety-Modul nicht verfügbar' : 'Moduł bezpieczeństwa niedostępny'}
            hint={de
              ? 'Ihr Samsara-Tarif gibt die Safety-Events nicht frei. Bitte beim Samsara-Support aktivieren lassen.'
              : 'Twój plan Samsara nie udostępnia zdarzeń bezpieczeństwa. Poproś o aktywację w Samsarze.'}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldAlert size={26} />}
            title={de ? 'Keine Ereignisse 🎉' : 'Brak zdarzeń 🎉'}
            hint={de ? 'In diesem Zeitraum keine Sicherheitsereignisse.' : 'W tym okresie brak zdarzeń bezpieczeństwa.'}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border sm:hidden">
            {filtered.map((e, i) => (
              <div key={i} className="p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">{e.vehicle_name || '—'}</span>
                  <span className="text-xs text-muted">{fmtTime(e.time, de)}</span>
                </div>
                {e.driver_name && <p className="mb-1 text-xs text-muted">👤 {e.driver_name}</p>}
                <div className="flex flex-wrap gap-1">
                  {e.labels.map((l, j) => {
                    const c = labelChip(l);
                    return <span key={j} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.cls}`}>{c.text}</span>;
                  })}
                  {e.max_speed_kmh != null && (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-300">
                      {e.max_speed_kmh}{e.posted_speed_kmh ? `/${e.posted_speed_kmh}` : ''} km/h
                    </span>
                  )}
                </div>
                {e.location && <p className="mt-1 truncate text-[11px] text-muted">{e.location}</p>}
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-black/[0.02] dark:bg-white/5">
                  {[de ? 'Zeit' : 'Czas', de ? 'Fahrzeug' : 'Pojazd', de ? 'Fahrer' : 'Kierowca', de ? 'Ereignis' : 'Zdarzenie', 'km/h', de ? 'Ort' : 'Miejsce'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((e, i) => (
                  <tr key={i} className="transition hover:bg-primary-50/40 dark:hover:bg-white/5">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{fmtTime(e.time, de)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{e.vehicle_name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{e.driver_name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {e.labels.length ? e.labels.map((l, j) => {
                          const c = labelChip(l);
                          return <span key={j} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.cls}`}>{c.text}</span>;
                        }) : <span className="text-muted">—</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono">
                      {e.max_speed_kmh != null ? (
                        <span className={e.posted_speed_kmh && e.max_speed_kmh > e.posted_speed_kmh ? 'font-bold text-danger' : ''}>
                          {e.max_speed_kmh}{e.posted_speed_kmh ? ` / ${e.posted_speed_kmh}` : ''}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-xs text-muted" title={e.location}>{e.location || '—'}</td>
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

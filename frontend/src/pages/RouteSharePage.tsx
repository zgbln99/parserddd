import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Navigation, MapPin, Clock, Truck, Gauge, CalendarDays, Lock, ChevronLeft, ChevronRight } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchPublicRoute, type PublicRoute, type RouteLeg, type TrailPoint } from '../lib/api';

// Distinct colors per vehicle on the shared map.
const COLORS = ['#4f46e5', '#dc2626', '#0891b2', '#d97706', '#7c3aed', '#16a34a', '#db2777', '#475569'];

interface Stop {
  from: string;
  to: string;
  durMin: number;
  location: string;
  lat: number;
  lng: number;
}

function detectStops(points: TrailPoint[], minMin = 10): Stop[] {
  const stops: Stop[] = [];
  let i = 0;
  while (i < points.length) {
    if (points[i].speed_kmh <= 3) {
      let j = i;
      while (j + 1 < points.length && points[j + 1].speed_kmh <= 3) j++;
      const from = points[i].time;
      const to = points[j].time;
      const durMin = (new Date(to).getTime() - new Date(from).getTime()) / 60000;
      if (durMin >= minMin) {
        const mid = points[Math.floor((i + j) / 2)];
        stops.push({ from, to, durMin: Math.round(durMin), location: mid.location || points[i].location || '', lat: mid.lat, lng: mid.lng });
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return stops;
}

function fmtHM(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// 846 min -> "14 Std 6 Min"
function fmtDur(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} Min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} Std ${mm} Min` : `${h} Std`;
}

interface VehStatus { moving: boolean; speed: number; stoppedMin: number; }

// Current situation from the latest GPS point: moving (+ speed) or standing
// (+ how long it has been standing, from the trailing low-speed run).
function statusOf(points: TrailPoint[]): VehStatus {
  if (!points.length) return { moving: false, speed: 0, stoppedMin: 0 };
  const last = points[points.length - 1];
  if (last.speed_kmh > 3) return { moving: true, speed: Math.round(last.speed_kmh), stoppedMin: 0 };
  let i = points.length - 1;
  while (i - 1 >= 0 && points[i - 1].speed_kmh <= 3) i--;
  const stoppedMin = Math.max(0, Math.round((new Date(last.time).getTime() - new Date(points[i].time).getTime()) / 60000));
  return { moving: false, speed: 0, stoppedMin };
}

function shiftDay(base: string, delta: number): string {
  const dt = new Date(base + 'T00:00:00');
  if (isNaN(dt.getTime())) return base;
  dt.setDate(dt.getDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function dayLabel(d: PublicRoute): string {
  const dt = new Date(d.selected_day + 'T00:00:00');
  const formatted = isNaN(dt.getTime())
    ? d.selected_day
    : dt.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const range = d.from_time || d.to_time ? ` · ${d.from_time || '00:00'}–${d.to_time || '24:00'}` : '';
  return (d.is_today ? `Heute · ${formatted}` : formatted) + range;
}

export function RouteSharePage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PublicRoute | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(''); // '' = today (server default)

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  // Fetch the selected day (empty = today). Re-fits the map on day change and
  // only auto-refreshes when viewing today (live).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetchPublicRoute(token, selectedDay || undefined)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError('');
          setLoading(false);
          if (d.is_today) timer = setTimeout(load, 60_000);
        })
        .catch((e) => { if (alive) { setError(e.message); setLoading(false); } });
    };
    fittedRef.current = false;
    setLoading(true);
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [token, selectedDay]);

  useEffect(() => {
    if (mapRef.current || error || !data) return;
    const el = mapElRef.current;
    if (!el) return;
    const map = L.map(el, { zoomControl: true }).setView([51.5, 10.0], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 60);
  }, [data, error]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !data) return;
    layer.clearLayers();
    const allLatLngs: [number, number][] = [];
    (data.routes || []).forEach((leg, idx) => {
      const color = COLORS[idx % COLORS.length];
      const pts = leg.points || [];
      if (pts.length === 0) return;
      const latlngs = pts.map((p) => [p.lat, p.lng] as [number, number]);
      allLatLngs.push(...latlngs);
      L.polyline(latlngs, { color, weight: 4, opacity: 0.85 }).addTo(layer);
      L.circleMarker(latlngs[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#10b981', fillOpacity: 1 })
        .bindPopup(`<b>Start</b> · ${leg.vehicle_name}`)
        .addTo(layer);
      const last = pts[pts.length - 1];
      const moving = last.speed_kmh > 3;
      const statusColor = moving ? '#10b981' : '#f59e0b';
      const statusTxt = moving ? `Fährt · ${Math.round(last.speed_kmh)} km/h` : 'Steht';
      L.circleMarker([last.lat, last.lng], { radius: 9, color: '#fff', weight: 3, fillColor: statusColor, fillOpacity: 1 })
        .bindPopup(`<b>${leg.vehicle_name}</b><br>${statusTxt}<br>${fmtHM(last.time)}<br>${last.location || ''}`)
        .addTo(layer);
    });
    if (!fittedRef.current && allLatLngs.length > 0) {
      try { map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] }); } catch { /* noop */ }
      fittedRef.current = true;
    }
  }, [data]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  const legs = useMemo(() => {
    return (data?.routes || []).map((leg: RouteLeg, idx) => ({
      ...leg,
      color: COLORS[idx % COLORS.length],
      stops: detectStops(leg.points || []),
      status: statusOf(leg.points || []),
      last: leg.points && leg.points.length ? leg.points[leg.points.length - 1] : null,
    }));
  }, [data]);

  const totalStops = legs.reduce((n, l) => n + l.stops.length, 0);
  const hasAnyPoint = legs.some((l) => (l.points || []).length > 0);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Lock size={22} />
          </div>
          <h1 className="mb-2 text-lg font-semibold text-slate-900">Link nicht verfügbar</h1>
          <p className="text-sm text-slate-500">Dieser Tracking-Link ist inaktiv, deaktiviert oder abgelaufen. Bitte fordern Sie einen aktuellen Link beim Absender an.</p>
        </div>
      </div>
    );
  }

  const title = data?.label || (legs.length === 1 ? legs[0].vehicle_name : 'Streckenverfolgung');

  const Stat = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
    <span className="inline-flex items-center gap-1.5 text-slate-500">{icon}{children}</span>
  );

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Navigation size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
              {data && <Stat icon={<CalendarDays size={13} />}>{dayLabel(data)}</Stat>}
              {data && <Stat icon={<Gauge size={13} />}>{data.total_km} km</Stat>}
              {legs.length > 1 && <Stat icon={<Truck size={13} />}>{legs.length} Fahrzeuge</Stat>}
              {totalStops > 0 && <Stat icon={<Clock size={13} />}>{totalStops} Halte</Stat>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
          {data?.pickable && (
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5">
              <button
                onClick={() => data && setSelectedDay(shiftDay(data.selected_day, -1))}
                disabled={!data || data.selected_day <= data.min_day}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                aria-label="Vorheriger Tag"
              ><ChevronLeft size={16} /></button>
              <input
                type="date"
                value={data.selected_day}
                min={data.min_day}
                max={data.max_day}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="border-0 bg-transparent px-1 text-xs text-slate-700 outline-none"
              />
              <button
                onClick={() => data && setSelectedDay(shiftDay(data.selected_day, 1))}
                disabled={!data || data.selected_day >= data.max_day}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                aria-label="Nächster Tag"
              ><ChevronRight size={16} /></button>
            </div>
          )}
          {data?.pickable && !data.is_today && (
            <button onClick={() => data && setSelectedDay(data.max_day)} className="rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 hover:bg-slate-50">Heute</button>
          )}
          {data?.live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
            </span>
          )}
          {data?.updated_at && <span className="text-slate-400">Aktualisiert {fmtHM(data.updated_at)}</span>}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div ref={mapElRef} className="min-h-[48vh] flex-1 md:min-h-0" style={{ zIndex: 0 }} />

        <aside className="flex w-full flex-col overflow-y-auto border-t border-slate-200 bg-slate-50 md:w-[380px] md:max-w-[44vw] md:border-l md:border-t-0">
          {loading && <div className="p-8 text-center text-sm text-slate-400">Wird geladen…</div>}

          {!loading && !hasAnyPoint && (
            <div className="p-8 text-center text-sm text-slate-400">
              Keine Standortdaten.
              <br />Die Strecke erscheint, sobald GPS-Positionen eintreffen.
            </div>
          )}

          {!loading && hasAnyPoint && (
            <div className="space-y-3 p-3">
              {legs.map((leg) => (
                <div key={leg.vehicle_id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-2 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="h-9 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: leg.color }} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{leg.vehicle_name || leg.vehicle_id}</div>
                        {leg.driver_name && <div className="truncate text-xs text-slate-500">{leg.driver_name}</div>}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      {leg.status.moving ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          <Navigation size={11} /> {leg.status.speed} km/h
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          <span className="h-2 w-2 rounded-full bg-amber-500" /> Steht{leg.status.stoppedMin >= 5 ? ` · ${fmtDur(leg.status.stoppedMin)}` : ''}
                        </span>
                      )}
                      <span className="text-xs font-medium text-slate-400">{leg.total_km} km</span>
                    </div>
                  </div>

                  {leg.last && (
                    <button
                      onClick={() => leg.last && mapRef.current?.setView([leg.last.lat, leg.last.lng], 14)}
                      className="flex w-full items-start gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-left hover:bg-slate-100"
                    >
                      <MapPin size={14} className="mt-0.5 flex-shrink-0 text-rose-500" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-700">{data?.live ? 'Letzte Position' : 'Streckenende'} · {fmtHM(leg.last.time)}</div>
                        <div className="text-xs text-slate-500">{leg.last.location || '—'}</div>
                      </div>
                    </button>
                  )}

                  {leg.stops.length > 0 && (
                    <div className="border-t border-slate-100 pb-1">
                      <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Halte</div>
                      <ul className="px-1">
                        {[...leg.stops].reverse().map((s, i) => (
                          <li key={i}>
                            <button
                              onClick={() => mapRef.current?.setView([s.lat, s.lng], 15)}
                              className="flex w-full items-start gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-slate-50"
                            >
                              <Clock size={13} className="mt-0.5 flex-shrink-0 text-slate-400" />
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-slate-700">
                                  {fmtHM(s.from)}–{fmtHM(s.to)} <span className="text-slate-400">· {fmtDur(s.durMin)}</span>
                                </div>
                                <div className="text-xs text-slate-500">{s.location || '—'}</div>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto border-t border-slate-200 px-4 py-3 text-center text-[11px] text-slate-400">
            Adressen &amp; Karte: © OpenStreetMap, CARTO · Privater Link — bitte nicht weitergeben.
          </div>
        </aside>
      </main>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchPublicRoute, type PublicRoute, type RouteLeg, type TrailPoint } from '../lib/api';

// Distinct colors per vehicle on the shared map.
const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#475569'];

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

function fmtDateHM(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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

function periodLabel(d: PublicRoute): string {
  if (d.day) {
    const range = d.from_time || d.to_time ? ` ${d.from_time || '00:00'}–${d.to_time || '24:00'}` : '';
    return d.day + range;
  }
  const map: Record<number, string> = {
    6: 'Letzte 6 Std', 24: 'Letzter Tag', 72: 'Letzte 3 Tage',
    168: 'Letzte 7 Tage', 336: 'Letzte 14 Tage', 720: 'Letzter Monat',
  };
  return map[d.hours] || `Letzte ${d.hours} Std`;
}

export function RouteSharePage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PublicRoute | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetchPublicRoute(token)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError('');
          // Auto-refresh only for short live windows (live tracking).
          if (d.live && d.hours <= 72) timer = setTimeout(load, 60_000);
        })
        .catch((e) => { if (alive) setError(e.message); })
        .finally(() => { if (alive) setLoading(false); });
    };
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [token]);

  // Init the Leaflet map once we have data to show.
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

  // Draw all vehicle routes whenever data updates.
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
      L.circleMarker(latlngs[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 })
        .bindPopup(`<b>Start</b> · ${leg.vehicle_name}`)
        .addTo(layer);
      const last = pts[pts.length - 1];
      const moving = last.speed_kmh > 3;
      const statusColor = moving ? '#22c55e' : '#f59e0b';
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
      <div className="flex min-h-screen items-center justify-center bg-[#f0f2f7] p-6">
        <div className="max-w-md rounded-2xl bg-white p-12 text-center shadow-lg">
          <div className="mb-3 text-4xl">🔒</div>
          <h1 className="mb-2 text-xl font-bold">Link nicht verfügbar</h1>
          <p className="text-sm text-gray-500">Dieser Tracking-Link ist inaktiv, deaktiviert oder abgelaufen. Bitte fordern Sie einen aktuellen Link beim Absender an.</p>
        </div>
      </div>
    );
  }

  const title = data?.label || (legs.length === 1 ? legs[0].vehicle_name : 'Streckenverfolgung');

  return (
    <div className="flex h-screen flex-col bg-[#f0f2f7]">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#1e293b] to-[#1e40af] px-5 py-3.5 text-white shadow-md">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-90">
            <span>📍 {data ? `${data.total_km} km` : '—'}</span>
            {legs.length > 1 && <span>🚚 {legs.length} Fahrzeuge</span>}
            {totalStops > 0 && <span>⏸ {totalStops} Halte</span>}
            {data && <span>🗓 {periodLabel(data)}</span>}
          </div>
        </div>
        <div className="text-right text-xs">
          {data?.live && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 font-semibold">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" /> Live
            </div>
          )}
          {data?.updated_at && <div className="mt-1 opacity-80">Aktualisiert: {fmtHM(data.updated_at)}</div>}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div ref={mapElRef} className="min-h-[48vh] flex-1 md:min-h-0" style={{ zIndex: 0 }} />

        <aside className="flex w-full flex-col overflow-y-auto border-t bg-[#f0f2f7] md:w-[380px] md:max-w-[44vw] md:border-l md:border-t-0">
          {loading && <div className="p-6 text-center text-sm text-gray-400">Wird geladen…</div>}

          {!loading && !hasAnyPoint && (
            <div className="p-6 text-center text-sm text-gray-400">
              Keine Standortdaten.
              <br />Die Strecke erscheint, sobald GPS-Positionen eintreffen.
            </div>
          )}

          {!loading && hasAnyPoint && (
            <div className="space-y-3 p-3">
              {legs.map((leg) => (
                <div key={leg.vehicle_id} className="overflow-hidden rounded-xl bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: leg.color }} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{leg.vehicle_name || leg.vehicle_id}</div>
                        {leg.driver_name && <div className="truncate text-xs text-gray-500">{leg.driver_name}</div>}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      {leg.status.moving ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" /> Fährt · {leg.status.speed} km/h
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                          ⏸ Steht{leg.status.stoppedMin >= 5 ? ` · ${fmtDur(leg.status.stoppedMin)}` : ''}
                        </span>
                      )}
                      <span className="text-xs font-semibold text-gray-400">{leg.total_km} km</span>
                    </div>
                  </div>

                  {leg.last && (
                    <div
                      className="flex cursor-pointer items-start gap-2 bg-amber-50 px-3.5 py-2.5"
                      onClick={() => leg.last && mapRef.current?.setView([leg.last.lat, leg.last.lng], 14)}
                    >
                      <span className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-red-500" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold">{data?.live ? 'Letzte Position' : 'Streckenende'} · {fmtHM(leg.last.time)}</div>
                        <div className="text-xs text-gray-600">{leg.last.location || '—'}</div>
                      </div>
                    </div>
                  )}

                  {leg.stops.length > 0 && (
                    <ul className="border-t">
                      {[...leg.stops].reverse().map((s, i) => (
                        <li
                          key={i}
                          className="flex cursor-pointer items-start gap-2 border-b px-3.5 py-2 last:border-0 hover:bg-gray-50"
                          onClick={() => mapRef.current?.setView([s.lat, s.lng], 15)}
                        >
                          <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-gray-400" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold">
                              {fmtHM(s.from)}–{fmtHM(s.to)}{' '}
                              <span className="font-medium text-gray-400">· Standzeit {fmtDur(s.durMin)}</span>
                            </div>
                            <div className="text-xs text-gray-500">{s.location || '—'}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto px-4 py-3 text-center text-[11px] text-gray-400">
            Adressen &amp; Karte: © OpenStreetMap, CARTO · Privater Link — bitte nicht weitergeben.
          </div>
        </aside>
      </main>
    </div>
  );
}

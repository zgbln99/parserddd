import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchPublicRoute, type PublicRoute, type TrailPoint } from '../lib/api';

const REFRESH_MS = 60_000;

interface Stop {
  from: string;
  to: string;
  durMin: number;
  location: string;
  lat: number;
  lng: number;
}

// Mirrors the fleet-map / PDF logic: a stop is a run of near-stationary points
// (<= 3 km/h) lasting at least `minMin` minutes. Address comes from Samsara.
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
        stops.push({
          from,
          to,
          durMin: Math.round(durMin),
          location: mid.location || points[i].location || '',
          lat: mid.lat,
          lng: mid.lng,
        });
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
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
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
    const load = () => {
      fetchPublicRoute(token)
        .then((d) => { if (alive) { setData(d); setError(''); } })
        .catch((e) => { if (alive) setError(e.message); })
        .finally(() => { if (alive) setLoading(false); });
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  // Init the Leaflet map once we actually have a route to show.
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

  // Draw / redraw the route whenever data updates.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !data) return;
    layer.clearLayers();
    const pts = data.points || [];
    if (pts.length === 0) return;
    const latlngs = pts.map((p) => [p.lat, p.lng] as [number, number]);
    const line = L.polyline(latlngs, { color: '#2563eb', weight: 4, opacity: 0.85 }).addTo(layer);
    L.circleMarker(latlngs[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 })
      .bindPopup('Start')
      .addTo(layer);
    const last = pts[pts.length - 1];
    L.circleMarker([last.lat, last.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#ef4444', fillOpacity: 1 })
      .bindPopup(`<b>${data.live ? 'Ostatnia pozycja' : 'Koniec trasy'}</b><br>${fmtHM(last.time)}<br>${last.location || ''}`)
      .addTo(layer);
    if (!fittedRef.current) {
      try { map.fitBounds(line.getBounds(), { padding: [40, 40] }); } catch { /* noop */ }
      fittedRef.current = true;
    }
  }, [data]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  const stops = useMemo(() => (data ? detectStops(data.points) : []), [data]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f2f7] p-6">
        <div className="max-w-md rounded-2xl bg-white p-12 text-center shadow-lg">
          <div className="mb-3 text-4xl">🔒</div>
          <h1 className="mb-2 text-xl font-bold">Link niedostępny / Link nicht verfügbar</h1>
          <p className="text-sm text-gray-500">
            Ten link do śledzenia trasy jest nieaktywny, został wyłączony lub wygasł.
            <br />Dieser Tracking-Link ist inaktiv, deaktiviert oder abgelaufen.
          </p>
        </div>
      </div>
    );
  }

  const title = data?.label || data?.driver_name || data?.vehicle_name || 'Trasa';

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#1e3a5f] to-[#1e40af] px-5 py-3 text-white">
        <div>
          <h1 className="text-base font-bold leading-tight">{title}</h1>
          <div className="text-xs opacity-80">
            {data?.vehicle_name}
            {data?.driver_name ? ` · ${data.driver_name}` : ''}
            {data ? ` · ${data.total_km} km` : ''}
          </div>
        </div>
        <div className="text-right text-xs opacity-90">
          {data?.live && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 font-semibold">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" /> Na żywo
            </div>
          )}
          {data?.updated_at && <div className="mt-1">Aktualizacja: {fmtHM(data.updated_at)}</div>}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div ref={mapElRef} className="min-h-[50vh] flex-1 md:min-h-0" style={{ zIndex: 0 }} />
        <aside className="flex w-full flex-col overflow-y-auto border-t bg-white md:w-[360px] md:max-w-[42vw] md:border-l md:border-t-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-bold">Historia trasy</h2>
            <span className="text-xs text-gray-400">{data?.points?.length || 0} pkt</span>
          </div>
          {loading && <div className="p-6 text-center text-sm text-gray-400">Ładowanie…</div>}
          {!loading && (data?.points?.length || 0) === 0 && (
            <div className="p-6 text-center text-sm text-gray-400">
              Brak danych lokalizacji.
              <br />Trasa pojawi się, gdy spłyną pozycje GPS.
            </div>
          )}
          {!loading && stops.length > 0 && (
            <ul>
              {[...stops].reverse().map((s, idx) => (
                <li
                  key={idx}
                  className="flex cursor-pointer gap-2.5 border-b px-4 py-2.5 hover:bg-gray-50"
                  onClick={() => mapRef.current?.setView([s.lat, s.lng], 15)}
                >
                  <div className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-blue-600" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold">
                      {fmtHM(s.from)}–{fmtHM(s.to)}{' '}
                      <span className="font-medium text-gray-400">· postój {s.durMin} min</span>
                    </div>
                    <div className="text-xs text-gray-500">{s.location || '—'}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto px-4 py-2.5 text-center text-[11px] text-gray-400">
            Adresy &amp; mapa: © OpenStreetMap, CARTO. Link prywatny — nie udostępniaj dalej.
          </div>
        </aside>
      </main>
    </div>
  );
}

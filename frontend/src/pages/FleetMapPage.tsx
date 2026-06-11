import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Map as MapIcon, RefreshCw, Search, Layers, Truck, X, Route, Fuel } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchVehicleLocations, fetchLiveStatus, fetchVehicleTrail, type VehicleLocation } from '../lib/api';

/**
 * Fleet map — OpenStreetMap/satellite/dark tiles via Leaflet (no API keys).
 *
 * Left panel: searchable vehicle list (name/plate/driver/location) with a
 * moving/stopped filter; clicking an entry flies to the pin and opens its
 * popup. Pins are custom divIcons: green pulsing = moving, gray = stopped,
 * indigo ring = selected. `?vehicle=<id>` (from ⌘K) preselects a vehicle.
 */

const REFRESH_MS = 60_000;

const BASE_LAYERS = {
  // Clean, colourful Google-like base — much nicer than raw OSM.
  voyager: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
  },
  sat: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    maxZoom: 19,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
  },
} as const;
type BaseLayerKey = keyof typeof BASE_LAYERS;

type MoveFilter = 'all' | 'moving' | 'stopped';

function fmtStop(mins: number | null, de: boolean): string {
  if (mins == null || mins <= 0) return '';
  if (mins < 60) return `${mins} min`;
  return de ? `${Math.floor(mins / 60)} Std ${mins % 60} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function FleetMapPage() {
  const { locale } = useI18n();
  const de = locale === 'de';
  const [searchParams] = useSearchParams();

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const trailLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const fittedRef = useRef(false);

  const [vehicles, setVehicles] = useState<VehicleLocation[]>([]);
  const [drivers, setDrivers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [query, setQuery] = useState('');
  const [moveFilter, setMoveFilter] = useState<MoveFilter>('all');
  const [baseLayer, setBaseLayer] = useState<BaseLayerKey>(() => {
    const saved = localStorage.getItem('fleet-map-layer') as BaseLayerKey;
    return saved && saved in BASE_LAYERS ? saved : 'voyager';
  });
  const [selectedId, setSelectedId] = useState(searchParams.get('vehicle') || '');
  const [panelOpen, setPanelOpen] = useState(true);
  const [trailHours, setTrailHours] = useState(0); // 0 = off (and no date)
  const [trailDate, setTrailDate] = useState(''); // YYYY-MM-DD = full historic day
  const [trailKm, setTrailKm] = useState<number | null>(null);
  const [trailLoading, setTrailLoading] = useState(false);

  // --- map init ----------------------------------------------------------
  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const map = L.map(mapDiv.current, { zoomControl: false }).setView([51.5, 10.0], 6);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const cfg = BASE_LAYERS[baseLayer] || BASE_LAYERS.voyager;
    tileRef.current = L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom, attribution: cfg.attribution }).addTo(map);
    trailLayerRef.current = L.layerGroup().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // The container grows after mount (page transition / full-bleed layout),
    // so tell Leaflet to repaint tiles whenever its size settles — otherwise
    // it keeps a stale size and leaves blank areas.
    const fixSize = () => map.invalidateSize();
    const t1 = window.setTimeout(fixSize, 60);
    const t2 = window.setTimeout(fixSize, 350);
    const ro = new ResizeObserver(fixSize);
    ro.observe(mapDiv.current);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      layerRef.current = null;
      trailLayerRef.current = null;
      markersRef.current.clear();
      fittedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- base layer switch ---------------------------------------------------
  const switchLayer = (key: BaseLayerKey) => {
    setBaseLayer(key);
    localStorage.setItem('fleet-map-layer', key);
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const cfg = BASE_LAYERS[key];
    tileRef.current = L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom, attribution: cfg.attribution }).addTo(map);
  };

  // --- data ----------------------------------------------------------------
  const load = useCallback(async () => {
    try {
      const [locRes, liveRes] = await Promise.all([
        fetchVehicleLocations(),
        fetchLiveStatus().catch(() => ({ drivers: [] as { name: string; vehicle: string }[] })),
      ]);
      const dm = new Map<string, string>();
      for (const d of liveRes.drivers || []) {
        if (d.vehicle) dm.set(d.vehicle, d.name);
      }
      setDrivers(dm);
      setVehicles(locRes.vehicles || []);
      setUpdatedAt(new Date());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // --- filtering -----------------------------------------------------------
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return vehicles.filter((v) => {
      const moving = v.speed_kmh > 5;
      if (moveFilter === 'moving' && !moving) return false;
      if (moveFilter === 'stopped' && moving) return false;
      if (!q) return true;
      const driver = v.driver_name || drivers.get(v.vehicle_name) || '';
      return (
        v.vehicle_name.toLowerCase().includes(q) ||
        driver.toLowerCase().includes(q) ||
        (v.location || '').toLowerCase().includes(q)
      );
    });
  }, [vehicles, drivers, query, moveFilter]);

  const focusVehicle = useCallback((v: VehicleLocation) => {
    setSelectedId(v.vehicle_id);
    const map = mapRef.current;
    if (!map || v.latitude == null || v.longitude == null) return;
    map.flyTo([v.latitude, v.longitude], Math.max(map.getZoom(), 13), { duration: 0.6 });
    setTimeout(() => markersRef.current.get(v.vehicle_id)?.openPopup(), 650);
  }, []);

  const clearTrail = useCallback(() => {
    trailLayerRef.current?.clearLayers();
    setTrailKm(null);
  }, []);

  const loadTrail = useCallback(async (vehicleId: string, hours: number, date: string) => {
    const layer = trailLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map || !vehicleId) return;
    setTrailLoading(true);
    layer.clearLayers();
    setTrailKm(null);
    try {
      const res = await fetchVehicleTrail(vehicleId, hours, date || undefined);
      setTrailKm(res.total_km ?? null);
      const pts = (res.points || []).filter((p) => p.lat != null && p.lng != null);
      if (pts.length < 2) return;
      const latlngs = pts.map((p) => [p.lat, p.lng] as L.LatLngTuple);
      const kmLabel = res.total_km != null ? `${res.total_km} km` : '';
      // casing + colored line
      L.polyline(latlngs, { color: '#ffffff', weight: 7, opacity: 0.8 }).addTo(layer);
      L.polyline(latlngs, { color: '#5750f1', weight: 4, opacity: 0.95 })
        .bindTooltip(kmLabel, { sticky: true })
        .addTo(layer);
      // start + end dots
      const first = pts[0];
      const last = pts[pts.length - 1];
      L.circleMarker([first.lat, first.lng], { radius: 5, color: '#16a34a', fillColor: '#22ad5c', fillOpacity: 1, weight: 2 })
        .bindTooltip(de ? 'Start' : 'Początek').addTo(layer);
      L.circleMarker([last.lat, last.lng], { radius: 5, color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 1, weight: 2 })
        .bindTooltip(de ? 'Letzte Position' : 'Ostatnia pozycja').addTo(layer);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [60, 60] });
    } catch {
      /* surface nothing; trail is best-effort */
    } finally {
      setTrailLoading(false);
    }
  }, [de]);

  // (re)load or clear the trail when the toggle / date / selection changes
  useEffect(() => {
    if (selectedId && (trailHours > 0 || trailDate)) loadTrail(selectedId, trailHours || 24, trailDate);
    else clearTrail();
  }, [trailHours, trailDate, selectedId, loadTrail, clearTrail]);

  // --- markers -------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const seen = new Set<string>();
    const bounds: L.LatLngTuple[] = [];

    for (const v of filtered) {
      if (v.latitude == null || v.longitude == null) continue;
      seen.add(v.vehicle_id);
      const moving = v.speed_kmh > 5;
      const selected = v.vehicle_id === selectedId;
      const pos: L.LatLngTuple = [v.latitude, v.longitude];
      bounds.push(pos);

      const driver = v.driver_name || drivers.get(v.vehicle_name);
      const stop = !moving && v.stopped_minutes
        ? `<div style="color:#b45309">${de ? 'Steht seit' : 'Postój od'}: <b>${v.stopped_is_min ? '> ' : ''}${fmtStop(v.stopped_minutes, de)}</b></div>`
        : '';
      const popupHtml = `
        <div style="font: 12px/1.5 system-ui; min-width: 180px">
          <div style="font-weight:700; font-size:13px">${v.vehicle_name}</div>
          ${driver ? `<div>👤 ${driver}</div>` : ''}
          <div>${moving ? `🟢 <b>${v.speed_kmh} km/h</b>` : `⚪ ${de ? 'Steht' : 'Postój'}`}${v.fuel_percent != null ? ` · ⛽ ${v.fuel_percent}%` : ''}</div>
          ${stop}
          <div style="color:#6b7280; margin-top:2px">${v.location || ''}</div>
          <a href="https://maps.google.com/?q=${v.latitude},${v.longitude}" target="_blank" rel="noopener" style="color:#5750f1">Google Maps →</a>
        </div>`;

      const icon = L.divIcon({
        className: '',
        html: `<div class="fleet-pin${moving ? ' fleet-pin--moving' : ''}${selected ? ' fleet-pin--selected' : ''}"><span class="fleet-pin__dot"></span>${v.vehicle_name}</div>`,
        iconSize: undefined,
        iconAnchor: [10, 10],
      });

      const existing = markersRef.current.get(v.vehicle_id);
      if (existing) {
        existing.setLatLng(pos);
        existing.setIcon(icon);
        existing.setPopupContent(popupHtml);
      } else {
        const m = L.marker(pos, { icon }).bindPopup(popupHtml);
        m.on('click', () => setSelectedId(v.vehicle_id));
        m.addTo(layer);
        markersRef.current.set(v.vehicle_id, m);
      }
    }

    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) {
        layer.removeLayer(m);
        markersRef.current.delete(id);
      }
    }

    if (!fittedRef.current && bounds.length > 0) {
      fittedRef.current = true;
      const fv = selectedId ? filtered.find((v) => v.vehicle_id === selectedId && v.latitude != null) : null;
      if (fv) {
        map.setView([fv.latitude!, fv.longitude!], 13);
        setTimeout(() => markersRef.current.get(fv.vehicle_id)?.openPopup(), 300);
      } else {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    }
  }, [filtered, drivers, de, selectedId]);

  const movingCount = vehicles.filter((v) => v.speed_kmh > 5).length;
  const selectedVehicle = vehicles.find((v) => v.vehicle_id === selectedId) || null;
  const today = new Date().toISOString().slice(0, 10);
  const routeOn = trailHours > 0 || !!trailDate;

  const filterPills: { key: MoveFilter; label: string }[] = [
    { key: 'all', label: de ? 'Alle' : 'Wszystkie' },
    { key: 'moving', label: de ? 'Fährt' : 'Jadące' },
    { key: 'stopped', label: de ? 'Steht' : 'Stojące' },
  ];

  const layerPills: { key: BaseLayerKey; label: string }[] = [
    { key: 'voyager', label: de ? 'Karte' : 'Mapa' },
    { key: 'sat', label: de ? 'Satellit' : 'Satelita' },
    { key: 'dark', label: de ? 'Dunkel' : 'Ciemna' },
  ];

  return (
    // Fills the full-bleed <main> (Layout drops padding/max-width for /map).
    <div className="relative h-full w-full overflow-hidden">
      {/* Map fills everything; panels float on top */}
      <div ref={mapDiv} className="absolute inset-0 z-0" />

      {error && (
        <div className="absolute left-1/2 top-3 z-[600] -translate-x-1/2 rounded-xl bg-red-500/90 px-4 py-2 text-sm text-white shadow-lg backdrop-blur">
          {error}
        </div>
      )}

      {/* Floating title / stats chip (top-left) */}
      <div className="pointer-events-none absolute left-3 top-3 z-[500] flex items-center gap-2.5 rounded-2xl border border-border bg-card/90 px-3 py-2 shadow-lg backdrop-blur-md">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#34d399] to-[#16a34a] text-white">
          <MapIcon size={16} />
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="text-sm font-bold tracking-tight text-ink">{de ? 'Flottenkarte' : 'Mapa floty'}</h1>
          <p className="text-[11px] text-muted">
            {vehicles.length} {de ? 'Fzg.' : 'poj.'} · <span className="font-semibold text-[#22ad5c]">{movingCount} {de ? 'fährt' : 'w trasie'}</span>
            {updatedAt && ` · ${updatedAt.toLocaleTimeString(de ? 'de-DE' : 'pl-PL', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
      </div>

      {/* Floating layers + refresh (top-right) */}
      <div className="absolute right-3 top-3 z-[500] flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-2xl border border-border bg-card/90 p-1 shadow-lg backdrop-blur-md">
          <Layers size={14} className="ml-1.5 text-muted" />
          {layerPills.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => switchLayer(key)}
              className={`rounded-xl px-2.5 py-1 text-xs font-semibold transition ${
                baseLayer === key ? 'bg-primary-600 text-white' : 'text-muted hover:bg-surface'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setLoading(true); load(); }}
          className="flex h-9 w-9 items-center justify-center rounded-2xl border border-border bg-card/90 text-ink shadow-lg backdrop-blur-md transition hover:bg-surface"
          title={de ? 'Aktualisieren' : 'Odśwież'}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Floating vehicle list (left) */}
      {panelOpen ? (
        <div className="absolute bottom-3 left-3 top-[68px] z-[500] flex w-[calc(100%-1.5rem)] max-w-[320px] flex-col overflow-hidden rounded-2xl border border-border bg-card/90 shadow-2xl backdrop-blur-md sm:w-[320px]">
          <div className="border-b border-border p-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={de ? 'Fahrzeug, Fahrer, Ort…' : 'Pojazd, kierowca, miejsce…'}
                  className="input w-full rounded-xl py-2 pl-8 pr-7 text-sm"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
                    <X size={13} />
                  </button>
                )}
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition hover:bg-surface hover:text-ink"
                title={de ? 'Liste ausblenden' : 'Ukryj listę'}
              >
                <X size={15} />
              </button>
            </div>
            <div className="mt-2 flex gap-1">
              {filterPills.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setMoveFilter(key)}
                  className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                    moveFilter === key ? 'bg-primary-600 text-white' : 'border border-border text-muted hover:bg-surface'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 divide-y divide-border overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted">{de ? 'Keine Treffer' : 'Brak wyników'}</p>
            ) : (
              filtered.map((v) => {
                const moving = v.speed_kmh > 5;
                const driver = v.driver_name || drivers.get(v.vehicle_name);
                const selected = v.vehicle_id === selectedId;
                return (
                  <button
                    key={v.vehicle_id}
                    onClick={() => focusVehicle(v)}
                    className={`block w-full px-3 py-2.5 text-left transition ${
                      selected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-surface'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${moving ? 'bg-[#22ad5c] animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <span className="truncate font-mono text-sm font-bold text-ink">{v.vehicle_name}</span>
                      <span className={`ml-auto shrink-0 font-mono text-[11px] ${moving ? 'font-bold text-[#22ad5c]' : 'text-muted'}`}>
                        {moving
                          ? `${v.speed_kmh} km/h`
                          : fmtStop(v.stopped_minutes, de)
                            ? `${v.stopped_is_min ? '> ' : ''}${fmtStop(v.stopped_minutes, de)}`
                            : (de ? 'Steht' : 'Postój')}
                      </span>
                    </div>
                    {driver && <p className="ml-4 truncate text-[11px] text-muted">👤 {driver}</p>}
                    <div className="ml-4 flex items-center gap-2 text-[11px] text-muted">
                      {v.fuel_percent != null && (
                        <span className={`inline-flex items-center gap-0.5 font-medium ${v.fuel_percent <= 15 ? 'text-danger' : v.fuel_percent <= 30 ? 'text-warning' : ''}`}>
                          <Fuel size={10} /> {v.fuel_percent}%
                        </span>
                      )}
                      {v.location && <span className="truncate">{v.location}</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-border px-3 py-2 text-center text-[11px] text-muted">
            {filtered.length} / {vehicles.length}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setPanelOpen(true)}
          className="absolute left-3 top-[68px] z-[500] flex items-center gap-1.5 rounded-2xl border border-border bg-card/90 px-3 py-2 text-xs font-semibold text-ink shadow-lg backdrop-blur-md transition hover:bg-surface"
        >
          <Truck size={14} />
          {de ? 'Liste' : 'Lista'}
        </button>
      )}

      {/* Floating route-history panel (when a vehicle is selected) */}
      {selectedId && (
        <div className="absolute bottom-3 right-3 z-[500] w-[calc(100%-1.5rem)] max-w-[320px] rounded-2xl border border-border bg-card/90 p-3 shadow-2xl backdrop-blur-md sm:w-auto">
          <div className="mb-2 flex items-center gap-2">
            <Route size={15} className={trailLoading ? 'animate-pulse text-primary-600' : 'text-primary-600'} />
            <span className="text-sm font-bold text-ink">{de ? 'Route' : 'Trasa'}</span>
            {selectedVehicle && <span className="truncate font-mono text-xs text-muted">{selectedVehicle.vehicle_name}</span>}
            {routeOn && (
              <button
                onClick={() => { setTrailHours(0); setTrailDate(''); }}
                className="ml-auto rounded-lg border border-border px-2 py-0.5 text-[11px] font-semibold text-muted transition hover:bg-surface"
              >
                {de ? 'Aus' : 'Wył.'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {[
              { h: 4, label: '4 h' },
              { h: 8, label: '8 h' },
              { h: 24, label: '24 h' },
            ].map(({ h, label }) => (
              <button
                key={h}
                onClick={() => { setTrailDate(''); setTrailHours(h); }}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  !trailDate && trailHours === h ? 'bg-primary-600 text-white' : 'border border-border text-muted hover:bg-surface'
                }`}
              >
                {label}
              </button>
            ))}
            <input
              type="date"
              value={trailDate}
              max={today}
              onChange={(e) => { setTrailHours(0); setTrailDate(e.target.value); }}
              className={`input rounded-lg px-2 py-1 text-xs dark:[color-scheme:dark] ${trailDate ? 'border-primary-500 text-primary-600' : ''}`}
              title={de ? 'Historischer Tag' : 'Dzień historyczny'}
            />
          </div>
          {routeOn && (
            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span className="text-muted">
                {trailDate ? trailDate : (de ? `Letzte ${trailHours} Std` : `Ostatnie ${trailHours} h`)}
              </span>
              <span className="font-bold text-ink">
                {trailLoading ? '…' : trailKm != null ? `${trailKm} km` : (de ? 'Keine Daten' : 'Brak danych')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default FleetMapPage;

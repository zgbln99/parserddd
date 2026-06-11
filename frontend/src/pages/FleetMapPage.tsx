import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Map as MapIcon, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n';
import { fetchVehicleLocations, fetchLiveStatus, type VehicleLocation } from '../lib/api';
import { Badge } from '../components/Badge';

/**
 * Full-screen fleet map — OpenStreetMap tiles via Leaflet (no API keys).
 * Pins are custom divIcons (no Leaflet image-asset issues with bundlers):
 * green pulsing when moving, gray when stopped. `?vehicle=<id>` focuses
 * one vehicle (used by the ⌘K palette).
 */

const REFRESH_MS = 60_000;

function fmtStop(mins: number | null, locale: string): string {
  if (mins == null) return '';
  if (mins < 60) return `${mins} min`;
  return locale === 'de' ? `${Math.floor(mins / 60)} Std ${mins % 60} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function FleetMapPage() {
  const { locale } = useI18n();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('vehicle') || '';

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const fittedRef = useRef(false);

  const [vehicles, setVehicles] = useState<VehicleLocation[]>([]);
  const [drivers, setDrivers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // --- map init ----------------------------------------------------------
  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const map = L.map(mapDiv.current, { zoomControl: true }).setView([51.5, 10.0], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markersRef.current.clear();
      fittedRef.current = false;
    };
  }, []);

  // --- data load ---------------------------------------------------------
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

  // --- render markers ----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const seen = new Set<string>();
    const bounds: L.LatLngTuple[] = [];

    for (const v of vehicles) {
      if (v.latitude == null || v.longitude == null) continue;
      seen.add(v.vehicle_id);
      const moving = v.speed_kmh > 5;
      const pos: L.LatLngTuple = [v.latitude, v.longitude];
      bounds.push(pos);

      const driver = drivers.get(v.vehicle_name);
      const stop = !moving && v.stopped_minutes != null && v.stopped_minutes > 0
        ? `<div style="color:#b45309">${locale === 'de' ? 'Steht seit' : 'Postój od'}: <b>${fmtStop(v.stopped_minutes, locale)}</b></div>`
        : '';
      const popupHtml = `
        <div style="font: 12px/1.5 system-ui; min-width: 180px">
          <div style="font-weight:700; font-size:13px">${v.vehicle_name}</div>
          ${driver ? `<div>👤 ${driver}</div>` : ''}
          <div>${moving ? `🟢 <b>${v.speed_kmh} km/h</b>` : `⚪ ${locale === 'de' ? 'Steht' : 'Postój'}`}</div>
          ${stop}
          <div style="color:#6b7280; margin-top:2px">${v.location || ''}</div>
          <a href="https://maps.google.com/?q=${v.latitude},${v.longitude}" target="_blank" rel="noopener" style="color:#5750f1">Google Maps →</a>
        </div>`;

      const icon = L.divIcon({
        className: '',
        html: `<div class="fleet-pin${moving ? ' fleet-pin--moving' : ''}"><span class="fleet-pin__dot"></span>${v.vehicle_name}</div>`,
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
        m.addTo(layer);
        markersRef.current.set(v.vehicle_id, m);
      }
    }

    // Drop markers for vehicles that disappeared from the feed.
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) {
        layer.removeLayer(m);
        markersRef.current.delete(id);
      }
    }

    if (!fittedRef.current && bounds.length > 0) {
      fittedRef.current = true;
      if (focusId) {
        const fv = vehicles.find((v) => v.vehicle_id === focusId && v.latitude != null);
        if (fv) {
          map.setView([fv.latitude!, fv.longitude!], 13);
          markersRef.current.get(focusId)?.openPopup();
        } else {
          map.fitBounds(bounds, { padding: [40, 40] });
        }
      } else {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    }
  }, [vehicles, drivers, locale, focusId]);

  const movingCount = vehicles.filter((v) => v.speed_kmh > 5).length;

  return (
    <div className="animate-slide-up">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#34d399] to-[#16a34a] text-white">
          <MapIcon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {locale === 'de' ? 'Flottenkarte' : 'Mapa floty'}
          </h1>
          <p className="text-xs text-muted">
            {vehicles.length} {locale === 'de' ? 'Fahrzeuge' : 'pojazdów'} · {movingCount} {locale === 'de' ? 'fährt' : 'w trasie'}
            {updatedAt && ` · ${updatedAt.toLocaleTimeString(locale === 'de' ? 'de-DE' : 'pl-PL')}`}
          </p>
        </div>
        <Badge variant="green">{movingCount} 🟢</Badge>
        <button
          onClick={() => { setLoading(true); load(); }}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">{error}</div>
      )}

      <div className="card overflow-hidden">
        <div ref={mapDiv} className="h-[calc(100vh-220px)] min-h-[420px] w-full" />
      </div>
    </div>
  );
}

export default FleetMapPage;

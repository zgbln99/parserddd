/**
 * Route export — branded PDF with a static map snapshot + GPX download.
 *
 * The map snapshot is rendered locally on a canvas from CARTO raster tiles
 * (CORS-enabled), with the route polyline and start/end markers drawn on
 * top — no extra dependencies, no API keys.
 */
import autoTable from 'jspdf-autotable';
import { ctx, drawHeader, drawFooter, drawCard, safeName } from './pdf-generator';
import type { TrailPoint } from './api';

// --- static map on canvas ---------------------------------------------------

const TILE_URL = (z: number, x: number, y: number) =>
  `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`;
const TILE = 512; // @2x tiles

const lon2tile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2tile = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

function loadTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const max = 2 ** z;
    if (y < 0 || y >= max) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = TILE_URL(z, ((x % max) + max) % max, y);
  });
}

/** Renders the route on a static map; returns a PNG data-URL. */
export async function renderRouteSnapshot(
  points: TrailPoint[],
  width = 1400,
  height = 880,
): Promise<string | null> {
  const pts = points.filter((p) => p.lat != null && p.lng != null);
  if (pts.length < 2) return null;

  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);

  // Highest zoom (≤16) where the padded bbox fits the canvas.
  let zoom = 16;
  for (; zoom > 3; zoom--) {
    const w = (lon2tile(maxLng, zoom) - lon2tile(minLng, zoom)) * TILE;
    const h = (lat2tile(minLat, zoom) - lat2tile(maxLat, zoom)) * TILE;
    if (w <= width - 120 && h <= height - 120) break;
  }

  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  const cx = lon2tile(cLng, zoom) * TILE; // world px of canvas centre
  const cy = lat2tile(cLat, zoom) * TILE;
  const px = (lng: number) => lon2tile(lng, zoom) * TILE - cx + width / 2;
  const py = (lat: number) => lat2tile(lat, zoom) * TILE - cy + height / 2;

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#e8edf1';
  g.fillRect(0, 0, width, height);

  const tx0 = Math.floor((cx - width / 2) / TILE);
  const tx1 = Math.floor((cx + width / 2) / TILE);
  const ty0 = Math.floor((cy - height / 2) / TILE);
  const ty1 = Math.floor((cy + height / 2) / TILE);
  const jobs: Promise<void>[] = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const dx = tx * TILE - cx + width / 2;
      const dy = ty * TILE - cy + height / 2;
      jobs.push(loadTile(zoom, tx, ty).then((img) => {
        if (img) g.drawImage(img, dx, dy, TILE, TILE);
      }));
    }
  }
  await Promise.all(jobs);

  // Route: white casing + brand-coloured line.
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const [color, w] of [['#ffffff', 11], ['#5750f1', 6]] as const) {
    g.strokeStyle = color; g.lineWidth = w;
    g.beginPath();
    g.moveTo(px(pts[0].lng), py(pts[0].lat));
    for (let i = 1; i < pts.length; i++) g.lineTo(px(pts[i].lng), py(pts[i].lat));
    g.stroke();
  }

  // Start (green) / end (red) markers.
  const dot = (lng: number, lat: number, fill: string) => {
    g.beginPath();
    g.arc(px(lng), py(lat), 10, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
  };
  dot(pts[0].lng, pts[0].lat, '#16a34a');
  dot(pts[pts.length - 1].lng, pts[pts.length - 1].lat, '#dc2626');

  // Attribution (tile licence requirement).
  g.font = '16px sans-serif';
  const attr = '© OpenStreetMap © CARTO';
  const tw = g.measureText(attr).width;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(width - tw - 16, height - 28, tw + 16, 28);
  g.fillStyle = '#374151';
  g.fillText(attr, width - tw - 8, height - 9);

  return canvas.toDataURL('image/png');
}

// --- helpers -----------------------------------------------------------------

const fmtT = (iso: string, de: boolean) =>
  new Date(iso).toLocaleString(de ? 'de-DE' : 'pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

function routeStats(points: TrailPoint[], totalKm: number) {
  const pts = points.filter((p) => p.lat != null && p.lng != null);
  const t0 = new Date(pts[0].time).getTime();
  const t1 = new Date(pts[pts.length - 1].time).getTime();
  const durMin = Math.max(0, Math.round((t1 - t0) / 60_000));
  const speeds = pts.map((p) => p.speed_kmh || 0);
  const maxSpeed = Math.round(Math.max(...speeds));
  const driveMin = pts.filter((p) => (p.speed_kmh || 0) > 5).length > 1
    ? Math.round(durMin * (pts.filter((p) => (p.speed_kmh || 0) > 5).length / pts.length))
    : durMin;
  const avgSpeed = driveMin > 0 ? Math.round(totalKm / (driveMin / 60)) : 0;
  return { pts, durMin, maxSpeed, avgSpeed, driveMin };
}

const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;

// --- PDF ----------------------------------------------------------------------

interface RoutePageOpts {
  vehicleName: string;
  driverName?: string;
  periodLabel: string; // e.g. "2026-06-10" or "Ostatnie 8 h"
  points: TrailPoint[];
  totalKm: number;
  de: boolean;
}

/** One full report page: header, metric cards, map snapshot, start/end line. */
async function addRoutePage(c: Awaited<ReturnType<typeof ctx>>, opts: RoutePageOpts) {
  const { vehicleName, driverName, periodLabel, points, totalKm, de } = opts;
  const { pts, durMin, maxSpeed, avgSpeed, driveMin } = routeStats(points, totalKm);
  const snapshot = await renderRouteSnapshot(points);
  const { doc, W, H, M } = c;

  let y = drawHeader(
    c,
    de ? 'Routenbericht' : 'Raport trasy',
    `${vehicleName}${driverName ? ` · ${driverName}` : ''} · ${periodLabel}`,
  );

  // Metric cards across the top.
  const cardW = (W - 2 * M - 3 * 4) / 4;
  drawCard(doc, M, y, cardW, 16, de ? 'Distanz' : 'Dystans', `${totalKm} km`, [87, 80, 241]);
  drawCard(doc, M + cardW + 4, y, cardW, 16, de ? 'Fahrzeit (ca.)' : 'Czas jazdy (ok.)', hhmm(driveMin), [16, 185, 129]);
  drawCard(doc, M + 2 * (cardW + 4), y, cardW, 16, de ? 'Ø Geschw.' : 'Śr. prędkość', `${avgSpeed} km/h`, [234, 88, 12]);
  drawCard(doc, M + 3 * (cardW + 4), y, cardW, 16, de ? 'Max. Geschw.' : 'Maks. prędkość', `${maxSpeed} km/h`, [220, 38, 38]);
  y += 20;

  // Map snapshot fills the rest of the page.
  const mapH = H - y - 24;
  if (snapshot) {
    const mapW = W - 2 * M;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.roundedRect(M, y, mapW, mapH, 2, 2, 'S');
    doc.addImage(snapshot, 'PNG', M + 0.5, y + 0.5, mapW - 1, mapH - 1);
  }
  y += mapH + 4;

  // Start/end summary line under the map.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const startLine = `${de ? 'Start' : 'Początek'}: ${fmtT(pts[0].time, de)}`;
  const endLine = `${de ? 'Ende' : 'Koniec'}: ${fmtT(pts[pts.length - 1].time, de)}`;
  doc.text(`🟢 ${startLine}    🔴 ${endLine}    ·    ${de ? 'Gesamtdauer' : 'Czas całkowity'}: ${hhmm(durMin)}    ·    GPS: ${pts.length} ${de ? 'Punkte' : 'punktów'}`, M, y + 3);
}

export async function generateRoutePdf(opts: RoutePageOpts) {
  const { vehicleName, periodLabel, points, de } = opts;
  const { pts } = routeStats(points, opts.totalKm);
  if (pts.length < 2) throw new Error(de ? 'Keine Routendaten' : 'Brak danych trasy');

  const c = await ctx('landscape');
  const { doc, M } = c;
  await addRoutePage(c, opts);

  // Page 2: hourly breakdown table (km per hour bucket).
  doc.addPage('a4', 'landscape');
  let y2 = drawHeader(c, de ? 'Routendetails' : 'Szczegóły trasy', `${vehicleName} · ${periodLabel}`);
  const buckets = new Map<string, { km: number; max: number }>();
  for (let i = 1; i < pts.length; i++) {
    const d = new Date(pts[i].time);
    const key = `${String(d.getHours()).padStart(2, '0')}:00`;
    const prev = pts[i - 1];
    const R = 6371;
    const dLat = ((pts[i].lat - prev.lat) * Math.PI) / 180;
    const dLng = ((pts[i].lng - prev.lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((prev.lat * Math.PI) / 180) * Math.cos((pts[i].lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(a));
    const b = buckets.get(key) || { km: 0, max: 0 };
    b.km += km;
    b.max = Math.max(b.max, pts[i].speed_kmh || 0);
    buckets.set(key, b);
  }
  autoTable(doc, {
    startY: y2 + 2,
    margin: { left: M, right: M },
    head: [[de ? 'Stunde' : 'Godzina', 'km', de ? 'Max km/h' : 'Maks. km/h']],
    body: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([h, b]) => [h, b.km.toFixed(1), String(Math.round(b.max))]),
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [87, 80, 241], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  drawFooter(c);
  doc.save(`${de ? 'Route' : 'Trasa'}_${safeName(vehicleName)}_${periodLabel.replace(/[^0-9A-Za-z-]+/g, '_')}.pdf`);
}

export interface DayTrail {
  date: string; // YYYY-MM-DD
  points: TrailPoint[];
  km: number;
}

/** Multi-day report: summary page with per-day table, then one page per day. */
export async function generateMultiDayRoutePdf(opts: {
  vehicleName: string;
  driverName?: string;
  days: DayTrail[];
  de: boolean;
}) {
  const { vehicleName, driverName, de } = opts;
  const days = opts.days.filter((d) => d.points.length >= 2);
  if (days.length === 0) throw new Error(de ? 'Keine Routendaten' : 'Brak danych trasy');

  const c = await ctx('landscape');
  const { doc, W, M } = c;
  const rangeLabel = `${days[0].date} – ${days[days.length - 1].date}`;
  const totalKm = Math.round(days.reduce((s, d) => s + d.km, 0) * 10) / 10;

  // --- summary page ---
  let y = drawHeader(
    c,
    de ? 'Routenbericht — Zeitraum' : 'Raport tras — zakres',
    `${vehicleName}${driverName ? ` · ${driverName}` : ''} · ${rangeLabel}`,
  );
  const perDay = days.map((d) => ({ ...d, s: routeStats(d.points, d.km) }));
  const driveTotal = perDay.reduce((s, d) => s + d.s.driveMin, 0);
  const maxSpeed = Math.max(...perDay.map((d) => d.s.maxSpeed));

  const cardW = (W - 2 * M - 3 * 4) / 4;
  drawCard(doc, M, y, cardW, 16, de ? 'Distanz gesamt' : 'Dystans łącznie', `${totalKm} km`, [87, 80, 241]);
  drawCard(doc, M + cardW + 4, y, cardW, 16, de ? 'Tage' : 'Dni', String(days.length), [13, 148, 136]);
  drawCard(doc, M + 2 * (cardW + 4), y, cardW, 16, de ? 'Fahrzeit (ca.)' : 'Czas jazdy (ok.)', hhmm(driveTotal), [16, 185, 129]);
  drawCard(doc, M + 3 * (cardW + 4), y, cardW, 16, de ? 'Max. Geschw.' : 'Maks. prędkość', `${maxSpeed} km/h`, [220, 38, 38]);
  y += 20;

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [[
      de ? 'Datum' : 'Data', 'km',
      de ? 'Start' : 'Początek', de ? 'Ende' : 'Koniec',
      de ? 'Fahrzeit' : 'Czas jazdy', de ? 'Max km/h' : 'Maks. km/h',
    ]],
    body: perDay.map((d) => [
      d.date,
      d.km.toFixed(1),
      fmtT(d.s.pts[0].time, de),
      fmtT(d.s.pts[d.s.pts.length - 1].time, de),
      hhmm(d.s.driveMin),
      String(d.s.maxSpeed),
    ]),
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [87, 80, 241], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // --- one page per day (map + metrics) ---
  for (const d of days) {
    doc.addPage('a4', 'landscape');
    await addRoutePage(c, {
      vehicleName,
      driverName,
      periodLabel: d.date,
      points: d.points,
      totalKm: d.km,
      de,
    });
  }

  drawFooter(c);
  doc.save(`${de ? 'Route' : 'Trasa'}_${safeName(vehicleName)}_${days[0].date}_${days[days.length - 1].date}.pdf`);
}

// --- GPX ----------------------------------------------------------------------

export function downloadRouteGpx(vehicleName: string, periodLabel: string, points: TrailPoint[]) {
  const pts = points.filter((p) => p.lat != null && p.lng != null);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="LTS Logistik Fleet" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${esc(vehicleName)} ${esc(periodLabel)}</name><trkseg>
${pts.map((p) => `    <trkpt lat="${p.lat}" lon="${p.lng}"><time>${p.time}</time></trkpt>`).join('\n')}
  </trkseg></trk>
</gpx>`;
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName(vehicleName)}_${periodLabel.replace(/[^0-9A-Za-z-]+/g, '_')}.gpx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

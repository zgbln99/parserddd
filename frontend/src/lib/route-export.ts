/**
 * Route export — branded PDF with a static map snapshot + GPX download.
 *
 * The map snapshot is rendered locally on a canvas from CARTO raster tiles
 * (CORS-enabled), with the route polyline and start/end markers drawn on
 * top — no extra dependencies, no API keys.
 */
import autoTable from 'jspdf-autotable';
import { ctx, drawFooter, safeName, loadInterFonts, registerInterFont, type Ctx } from './pdf-generator';
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
  de = false,
  width = 1680,
  height = 1000,
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
    if (w <= width - 200 && h <= height - 200) break;
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

  // Soften the basemap so the route pops.
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(0, 0, width, height);

  // Route with soft shadow: dark casing + brand line + light core.
  g.lineJoin = 'round'; g.lineCap = 'round';
  const drawLine = (color: string, w: number, blur = 0) => {
    g.save();
    if (blur) { g.shadowColor = 'rgba(30,27,75,0.45)'; g.shadowBlur = blur; g.shadowOffsetY = 4; }
    g.strokeStyle = color; g.lineWidth = w;
    g.beginPath();
    g.moveTo(px(pts[0].lng), py(pts[0].lat));
    for (let i = 1; i < pts.length; i++) g.lineTo(px(pts[i].lng), py(pts[i].lat));
    g.stroke();
    g.restore();
  };
  drawLine('#1e1b4b', 14, 12);
  drawLine('#5750f1', 8);
  drawLine('#a5b4fc', 2.5);

  // Start / end: pin dot + label pill.
  const pin = (lng: number, lat: number, fill: string, label: string) => {
    const x = px(lng); const y = py(lat);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
    g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2);
    g.fillStyle = '#ffffff'; g.fill();
    g.restore();
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill();
    // label pill
    g.font = 'bold 22px system-ui, sans-serif';
    const tw = g.measureText(label).width;
    const lx = Math.min(Math.max(x - tw / 2 - 12, 8), width - tw - 32);
    const ly = Math.max(y - 52, 10);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(lx, ly, tw + 24, 32, 16);
    g.fill();
    g.restore();
    g.fillStyle = '#ffffff';
    g.fillText(label, lx + 12, ly + 23);
  };
  pin(pts[0].lng, pts[0].lat, '#16a34a', de ? 'START' : 'START');
  pin(pts[pts.length - 1].lng, pts[pts.length - 1].lat, '#dc2626', de ? 'ZIEL' : 'META');

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

const fmtClock = (iso: string, de: boolean) =>
  new Date(iso).toLocaleTimeString(de ? 'de-DE' : 'pl-PL', { hour: '2-digit', minute: '2-digit' });

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

interface Stop { from: string; to: string; durMin: number; location: string }

/** Stops ≥ minMin with the reverse-geocoded address from Samsara points. */
function detectStops(points: TrailPoint[], minMin = 10): Stop[] {
  const stops: Stop[] = [];
  let start: TrailPoint | null = null;
  let last: TrailPoint | null = null;
  const flush = () => {
    if (start && last) {
      const dur = Math.round((new Date(last.time).getTime() - new Date(start.time).getTime()) / 60_000);
      if (dur >= minMin) {
        stops.push({ from: start.time, to: last.time, durMin: dur, location: start.location || last.location || '' });
      }
    }
    start = null; last = null;
  };
  for (const p of points) {
    if ((p.speed_kmh || 0) <= 3) {
      if (!start) start = p;
      last = p;
    } else flush();
  }
  flush();
  return stops;
}

// --- PDF ----------------------------------------------------------------------

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const PRIMARY: [number, number, number] = [87, 80, 241];

interface Fonts { name: string }

async function setupFonts(c: Ctx): Promise<Fonts> {
  const fonts = await loadInterFonts();
  if (fonts) {
    registerInterFont(c.doc, fonts);
    return { name: 'Inter' };
  }
  return { name: 'helvetica' };
}

/** Pretty header band: brand bar, title, subtitle, date chip. */
function header(c: Ctx, f: Fonts, title: string, subtitle: string, de: boolean): number {
  const { doc, W, M } = c;
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, W, 3, 'F');
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 3, W, 22, 'F');
  if (c.logo) { try { doc.addImage(c.logo, 'PNG', W - M - 28, 7, 28, 12); } catch { /* skip */ } }
  doc.setFont(f.name, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(title, M, 13.5);
  doc.setFont(f.name, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(subtitle, M, 20);
  doc.setFontSize(7);
  doc.text(
    `${de ? 'Erstellt' : 'Wygenerowano'}: ${new Date().toLocaleString(de ? 'de-DE' : 'pl-PL')} · LTS Logistik GmbH`,
    W - M - 32, 22.5, { align: 'right' },
  );
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(0, 25, W, 25);
  return 30;
}

/** Metric card with accent bar, Inter font, big value. */
function card(c: Ctx, f: Fonts, x: number, y: number, w: number, label: string, value: string, color: [number, number, number]) {
  const { doc } = c;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, 17, 2, 2, 'FD');
  doc.setFillColor(...color);
  doc.roundedRect(x, y, 1.6, 17, 0.8, 0.8, 'F');
  doc.setFont(f.name, 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x + 5, y + 6);
  doc.setFont(f.name, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(value, x + 5, y + 13.5);
}

interface RoutePageOpts {
  vehicleName: string;
  driverName?: string;
  periodLabel: string; // e.g. "2026-06-10" or "Ostatnie 8 h"
  points: TrailPoint[];
  totalKm: number;
  de: boolean;
}

/** One full report page: header, metric cards, map snapshot, address strip. */
async function addRoutePage(c: Ctx, f: Fonts, opts: RoutePageOpts) {
  const { vehicleName, driverName, periodLabel, points, totalKm, de } = opts;
  const { pts, durMin, maxSpeed, avgSpeed, driveMin } = routeStats(points, totalKm);
  const snapshot = await renderRouteSnapshot(points, de);
  const { doc, W, H, M } = c;

  let y = header(
    c, f,
    de ? 'Routenbericht' : 'Raport trasy',
    `${vehicleName}${driverName ? `  ·  ${driverName}` : ''}  ·  ${periodLabel}`,
    de,
  );

  const cardW = (W - 2 * M - 4 * 4) / 5;
  card(c, f, M, y, cardW, de ? 'Distanz' : 'Dystans', `${totalKm} km`, PRIMARY);
  card(c, f, M + (cardW + 4), y, cardW, de ? 'Fahrzeit' : 'Czas jazdy', hhmm(driveMin), [16, 185, 129]);
  card(c, f, M + 2 * (cardW + 4), y, cardW, de ? 'Gesamtdauer' : 'Czas całkowity', hhmm(durMin), [13, 148, 136]);
  card(c, f, M + 3 * (cardW + 4), y, cardW, de ? 'Ø Geschw.' : 'Śr. prędkość', `${avgSpeed} km/h`, [234, 88, 12]);
  card(c, f, M + 4 * (cardW + 4), y, cardW, de ? 'Max. Geschw.' : 'Maks. prędkość', `${maxSpeed} km/h`, [220, 38, 38]);
  y += 21;

  // Map snapshot with rounded frame.
  const addrH = 13;
  const mapH = H - y - addrH - 13;
  const mapW = W - 2 * M;
  if (snapshot) {
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.5);
    doc.roundedRect(M, y, mapW, mapH, 2.5, 2.5, 'S');
    doc.addImage(snapshot, 'PNG', M + 0.6, y + 0.6, mapW - 1.2, mapH - 1.2);
  }
  y += mapH + 4;

  // Address strip: start → end with times.
  const startLoc = pts[0].location || `${pts[0].lat.toFixed(4)}, ${pts[0].lng.toFixed(4)}`;
  const endLoc = pts[pts.length - 1].location || `${pts[pts.length - 1].lat.toFixed(4)}, ${pts[pts.length - 1].lng.toFixed(4)}`;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, mapW, addrH, 2, 2, 'F');
  doc.setFillColor(22, 163, 74);
  doc.circle(M + 5, y + 4.4, 1.4, 'F');
  doc.setFillColor(220, 38, 38);
  doc.circle(M + 5, y + 9.6, 1.4, 'F');
  doc.setFont(f.name, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(fmtT(pts[0].time, de), M + 9, y + 5.4);
  doc.text(fmtT(pts[pts.length - 1].time, de), M + 9, y + 10.6);
  doc.setFont(f.name, 'normal');
  doc.setTextColor(...MUTED);
  const addrX = M + 42;
  doc.text(doc.splitTextToSize(startLoc, mapW - addrX + M - 4)[0] || '', addrX, y + 5.4);
  doc.text(doc.splitTextToSize(endLoc, mapW - addrX + M - 4)[0] || '', addrX, y + 10.6);
}

/** Details page: stops with addresses + hourly km table. */
function addDetailsPage(c: Ctx, f: Fonts, opts: RoutePageOpts) {
  const { vehicleName, periodLabel, points, de } = opts;
  const { doc, W, M } = c;
  const pts = points.filter((p) => p.lat != null && p.lng != null);
  doc.addPage('a4', 'landscape');
  let y = header(c, f, de ? 'Routendetails' : 'Szczegóły trasy', `${vehicleName}  ·  ${periodLabel}`, de);

  const half = (W - 2 * M - 6) / 2;

  // Stops with addresses (left half).
  const stops = detectStops(pts);
  doc.setFont(f.name, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(de ? `Stopps ≥ 10 min (${stops.length})` : `Postoje ≥ 10 min (${stops.length})`, M, y);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: M, right: M + half + 6 },
    tableWidth: half,
    head: [[de ? 'Von' : 'Od', de ? 'Bis' : 'Do', de ? 'Dauer' : 'Czas', de ? 'Adresse' : 'Adres']],
    body: stops.length
      ? stops.map((s) => [fmtClock(s.from, de), fmtClock(s.to, de), hhmm(s.durMin), s.location || '—'])
      : [[de ? 'Keine Stopps' : 'Brak postojów', '', '', '']],
    styles: { font: f.name, fontSize: 7.5, cellPadding: 1.5, textColor: INK },
    headStyles: { fillColor: PRIMARY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 14 }, 2: { cellWidth: 14 } },
  });

  // Hourly breakdown (right half).
  doc.setFont(f.name, 'bold');
  doc.setFontSize(10);
  doc.text(de ? 'Kilometer pro Stunde' : 'Kilometry na godzinę', M + half + 6, y);
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
    startY: y + 2,
    margin: { left: M + half + 6, right: M },
    tableWidth: half,
    head: [[de ? 'Stunde' : 'Godzina', 'km', de ? 'Max km/h' : 'Maks. km/h']],
    body: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([h, b]) => [h, b.km.toFixed(1), String(Math.round(b.max))]),
    styles: { font: f.name, fontSize: 7.5, cellPadding: 1.5, textColor: INK },
    headStyles: { fillColor: [13, 148, 136], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });
}

export async function generateRoutePdf(opts: RoutePageOpts) {
  const { vehicleName, periodLabel, points, de } = opts;
  const { pts } = routeStats(points, opts.totalKm);
  if (pts.length < 2) throw new Error(de ? 'Keine Routendaten' : 'Brak danych trasy');

  const c = await ctx('landscape');
  const f = await setupFonts(c);
  await addRoutePage(c, f, opts);
  addDetailsPage(c, f, opts);

  drawFooter(c);
  c.doc.save(`${de ? 'Route' : 'Trasa'}_${safeName(vehicleName)}_${periodLabel.replace(/[^0-9A-Za-z-]+/g, '_')}.pdf`);
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
  const f = await setupFonts(c);
  const { doc, W, M } = c;
  const rangeLabel = `${days[0].date} – ${days[days.length - 1].date}`;
  const totalKm = Math.round(days.reduce((s, d) => s + d.km, 0) * 10) / 10;

  // --- summary page ---
  let y = header(
    c, f,
    de ? 'Routenbericht — Zeitraum' : 'Raport tras — zakres',
    `${vehicleName}${driverName ? `  ·  ${driverName}` : ''}  ·  ${rangeLabel}`,
    de,
  );
  const perDay = days.map((d) => ({ ...d, s: routeStats(d.points, d.km) }));
  const driveTotal = perDay.reduce((s, d) => s + d.s.driveMin, 0);
  const maxSpeed = Math.max(...perDay.map((d) => d.s.maxSpeed));

  const cardW = (W - 2 * M - 3 * 4) / 4;
  card(c, f, M, y, cardW, de ? 'Distanz gesamt' : 'Dystans łącznie', `${totalKm} km`, PRIMARY);
  card(c, f, M + cardW + 4, y, cardW, de ? 'Tage' : 'Dni', String(days.length), [13, 148, 136]);
  card(c, f, M + 2 * (cardW + 4), y, cardW, de ? 'Fahrzeit' : 'Czas jazdy', hhmm(driveTotal), [16, 185, 129]);
  card(c, f, M + 3 * (cardW + 4), y, cardW, de ? 'Max. Geschw.' : 'Maks. prędkość', `${maxSpeed} km/h`, [220, 38, 38]);
  y += 21;

  const trim = (s: string, n = 38) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [[
      de ? 'Datum' : 'Data', 'km',
      de ? 'Fahrzeit' : 'Czas jazdy', de ? 'Max km/h' : 'Maks. km/h',
      de ? 'Start' : 'Początek', de ? 'Ziel' : 'Koniec',
    ]],
    body: perDay.map((d) => [
      d.date,
      d.km.toFixed(1),
      hhmm(d.s.driveMin),
      String(d.s.maxSpeed),
      `${fmtClock(d.s.pts[0].time, de)}  ${trim(d.s.pts[0].location || '')}`,
      `${fmtClock(d.s.pts[d.s.pts.length - 1].time, de)}  ${trim(d.s.pts[d.s.pts.length - 1].location || '')}`,
    ]),
    styles: { font: f.name, fontSize: 7.5, cellPadding: 1.6, textColor: INK },
    headStyles: { fillColor: PRIMARY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 20, fontStyle: 'bold' }, 1: { cellWidth: 14 }, 2: { cellWidth: 18 }, 3: { cellWidth: 18 } },
  });

  // --- one page per day (map + metrics) ---
  for (const d of days) {
    doc.addPage('a4', 'landscape');
    await addRoutePage(c, f, {
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

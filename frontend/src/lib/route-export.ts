/**
 * Route export — branded PDF with a static map snapshot + GPX download.
 *
 * The map snapshot is rendered locally on a canvas from CARTO raster tiles
 * (CORS-enabled), with the route polyline and start/end markers drawn on
 * top — no extra dependencies, no API keys. The canvas is rendered at the
 * exact aspect ratio of the PDF map box so nothing gets stretched.
 */
import autoTable from 'jspdf-autotable';
import { ctx, safeName, loadInterFonts, registerInterFont, type Ctx } from './pdf-generator';
import type { TrailPoint } from './api';

// --- static map on canvas ---------------------------------------------------

// OpenStreetMap standard tiles — free, CORS-enabled, no API key (CARTO
// started watermarking its keyless tiles with "API KEY REQUIRED").
const TILE_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TILE = 256;

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
    if (w <= width - 220 && h <= height - 180) break;
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
  g.fillStyle = 'rgba(255,255,255,0.3)';
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
  pin(pts[0].lng, pts[0].lat, '#16a34a', 'START');
  pin(pts[pts.length - 1].lng, pts[pts.length - 1].lat, '#dc2626', de ? 'ZIEL' : 'META');

  // Attribution (tile licence requirement).
  g.font = '16px sans-serif';
  const attr = '© OpenStreetMap contributors';
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

// --- PDF design system --------------------------------------------------------

const NAVY: [number, number, number] = [15, 23, 42];
const INK: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 116, 139];
const FAINT: [number, number, number] = [148, 163, 184];
const PRIMARY: [number, number, number] = [87, 80, 241];
const LINE: [number, number, number] = [226, 232, 240];
const BG: [number, number, number] = [248, 250, 252];
const GREEN: [number, number, number] = [22, 163, 74];
const RED: [number, number, number] = [220, 38, 38];

interface Fonts { name: string }

async function setupFonts(c: Ctx): Promise<Fonts> {
  const fonts = await loadInterFonts();
  if (fonts) {
    registerInterFont(c.doc, fonts);
    return { name: 'Inter' };
  }
  return { name: 'helvetica' };
}

/** Dark hero header: kicker, big title, meta line, logo chip, accent rule. */
function header(c: Ctx, f: Fonts, kicker: string, title: string, meta: string): number {
  const { doc, W, M } = c;
  const H_BAND = 26;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, H_BAND, 'F');
  doc.setFillColor(...PRIMARY);
  doc.rect(0, H_BAND, W, 1.1, 'F');

  doc.setFont(f.name, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(165, 180, 252);
  doc.text(kicker.toUpperCase(), M, 8.5, { charSpace: 0.6 });

  doc.setFontSize(16.5);
  doc.setTextColor(255, 255, 255);
  doc.text(title, M, 16.5);

  doc.setFont(f.name, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(meta, M, 22.5);

  // Logo on a white chip.
  if (c.logo) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(W - M - 36, 5.5, 36, 15, 2, 2, 'F');
      doc.addImage(c.logo, 'PNG', W - M - 33, 8, 30, 10);
    } catch { /* skip */ }
  }
  return H_BAND + 7;
}

/** Custom footer for route reports (Inter, page numbers, brand rule). */
function footer(c: Ctx, f: Fonts, de: boolean) {
  const { doc, W, H, M } = c;
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(M, H - 9, W - M, H - 9);
    doc.setFillColor(...PRIMARY);
    doc.rect(0, H - 2, W, 2, 'F');
    doc.setFont(f.name, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...FAINT);
    doc.text(`LTS Logistik GmbH · ${de ? 'Routenbericht' : 'Raport trasy'} · ${de ? 'Vertraulich' : 'Poufne'}`, M, H - 5);
    doc.text(
      `${de ? 'Seite' : 'Strona'} ${i} / ${pages}  ·  ${new Date().toLocaleString(de ? 'de-DE' : 'pl-PL')}`,
      W - M, H - 5, { align: 'right' },
    );
  }
}

/** Metric card: tinted icon dot, uppercase label, big value. */
function card(c: Ctx, f: Fonts, x: number, y: number, w: number, label: string, value: string, color: [number, number, number]) {
  const { doc } = c;
  const h = 18;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');
  // tinted accent dot
  doc.setFillColor(color[0], color[1], color[2]);
  doc.circle(x + 6, y + 6.2, 1.7, 'F');
  doc.setFont(f.name, 'bold');
  doc.setFontSize(6.3);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x + 10, y + 7.3, { charSpace: 0.3 });
  doc.setFontSize(13.5);
  doc.setTextColor(...INK);
  doc.text(value, x + 6, y + 14.8);
}

/** Section title with accent square. */
function section(c: Ctx, f: Fonts, x: number, y: number, label: string, color: [number, number, number] = PRIMARY) {
  const { doc } = c;
  doc.setFillColor(color[0], color[1], color[2]);
  doc.roundedRect(x, y - 3.2, 2.4, 4.2, 0.6, 0.6, 'F');
  doc.setFont(f.name, 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(label, x + 5, y);
}

const tableTheme = (f: Fonts) => ({
  styles: { font: f.name, fontSize: 7.6, cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 }, textColor: INK as [number, number, number], lineColor: LINE as [number, number, number], lineWidth: 0.15 },
  headStyles: { fillColor: NAVY as [number, number, number], textColor: [226, 232, 240] as [number, number, number], fontStyle: 'bold' as const, fontSize: 7.2 },
  alternateRowStyles: { fillColor: BG as [number, number, number] },
});

interface RoutePageOpts {
  vehicleName: string;
  driverName?: string;
  periodLabel: string; // e.g. "2026-06-10" or "Letzte 8 Std"
  points: TrailPoint[];
  totalKm: number;
  de: boolean;
}

/** One full report page: hero header, metric cards, map, address timeline. */
async function addRoutePage(c: Ctx, f: Fonts, opts: RoutePageOpts) {
  const { vehicleName, driverName, periodLabel, points, totalKm, de } = opts;
  const { pts, durMin, maxSpeed, avgSpeed, driveMin } = routeStats(points, totalKm);
  const { doc, W, H, M } = c;

  let y = header(
    c, f,
    de ? 'Routenbericht' : 'Raport trasy',
    vehicleName,
    `${driverName ? `${driverName}   ·   ` : ''}${periodLabel}   ·   ${pts.length} GPS`,
  );

  // Metric cards.
  const gap = 4;
  const cardW = (W - 2 * M - 4 * gap) / 5;
  card(c, f, M, y, cardW, de ? 'Distanz' : 'Dystans', `${totalKm} km`, PRIMARY);
  card(c, f, M + (cardW + gap), y, cardW, de ? 'Fahrzeit' : 'Czas jazdy', hhmm(driveMin), [16, 185, 129]);
  card(c, f, M + 2 * (cardW + gap), y, cardW, de ? 'Gesamtdauer' : 'Czas całkowity', hhmm(durMin), [13, 148, 136]);
  card(c, f, M + 3 * (cardW + gap), y, cardW, de ? 'Ø Geschw.' : 'Śr. prędkość', `${avgSpeed} km/h`, [234, 88, 12]);
  card(c, f, M + 4 * (cardW + gap), y, cardW, de ? 'Max. Geschw.' : 'Maks. prędkość', `${maxSpeed} km/h`, RED);
  y += 23;

  // Layout: map fills width; address timeline card at the bottom.
  const addrH = 17;
  const mapW = W - 2 * M;
  const mapH = H - y - addrH - 17;

  // Snapshot rendered at the exact aspect ratio of the PDF box (no stretching).
  const pxPerMm = 6.5;
  const snapshot = await renderRouteSnapshot(points, de, Math.round(mapW * pxPerMm), Math.round(mapH * pxPerMm));
  if (snapshot) {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.4);
    doc.roundedRect(M, y, mapW, mapH, 3, 3, 'S');
    doc.addImage(snapshot, 'PNG', M + 0.7, y + 0.7, mapW - 1.4, mapH - 1.4);
  }
  y += mapH + 4;

  // Address timeline: green dot — connector — red dot.
  const startLoc = pts[0].location || `${pts[0].lat.toFixed(4)}, ${pts[0].lng.toFixed(4)}`;
  const endLoc = pts[pts.length - 1].location || `${pts[pts.length - 1].lat.toFixed(4)}, ${pts[pts.length - 1].lng.toFixed(4)}`;
  doc.setFillColor(...BG);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, mapW, addrH, 2.5, 2.5, 'FD');

  const dotX = M + 7;
  const r1 = y + 5.6; const r2 = y + 12.4;
  doc.setDrawColor(...FAINT);
  doc.setLineWidth(0.5);
  doc.line(dotX, r1 + 2, dotX, r2 - 2);
  doc.setFillColor(...GREEN);
  doc.circle(dotX, r1, 1.6, 'F');
  doc.setFillColor(...RED);
  doc.circle(dotX, r2, 1.6, 'F');

  doc.setFont(f.name, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(fmtT(pts[0].time, de), dotX + 5, r1 + 1.2);
  doc.text(fmtT(pts[pts.length - 1].time, de), dotX + 5, r2 + 1.2);

  doc.setFont(f.name, 'normal');
  doc.setTextColor(...MUTED);
  const addrX = dotX + 38;
  doc.text(doc.splitTextToSize(startLoc, mapW - (addrX - M) - 6)[0] || '', addrX, r1 + 1.2);
  doc.text(doc.splitTextToSize(endLoc, mapW - (addrX - M) - 6)[0] || '', addrX, r2 + 1.2);
}

/** Details page: stops with addresses + hourly km table. */
function addDetailsPage(c: Ctx, f: Fonts, opts: RoutePageOpts) {
  const { vehicleName, driverName, periodLabel, points, de } = opts;
  const { doc, W, M } = c;
  const pts = points.filter((p) => p.lat != null && p.lng != null);
  doc.addPage('a4', 'landscape');
  const y = header(
    c, f,
    de ? 'Routendetails' : 'Szczegóły trasy',
    vehicleName,
    `${driverName ? `${driverName}   ·   ` : ''}${periodLabel}`,
  );

  const half = (W - 2 * M - 8) / 2;
  const theme = tableTheme(f);

  // Stops with addresses (left half).
  const stops = detectStops(pts);
  section(c, f, M, y, de ? `Stopps ab 10 Min (${stops.length})` : `Postoje od 10 min (${stops.length})`);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M + half + 8 },
    tableWidth: half,
    head: [['#', de ? 'Von' : 'Od', de ? 'Bis' : 'Do', de ? 'Dauer' : 'Czas', de ? 'Adresse' : 'Adres']],
    body: stops.length
      ? stops.map((s, i) => [String(i + 1), fmtClock(s.from, de), fmtClock(s.to, de), hhmm(s.durMin), s.location || '—'])
      : [['—', de ? 'Keine Stopps' : 'Brak postojów', '', '', '']],
    ...theme,
    columnStyles: {
      0: { cellWidth: 7, textColor: FAINT },
      1: { cellWidth: 13, fontStyle: 'bold' },
      2: { cellWidth: 13 },
      3: { cellWidth: 14 },
    },
  });

  // Hourly breakdown (right half).
  section(c, f, M + half + 8, y, de ? 'Kilometer pro Stunde' : 'Kilometry na godzinę', [13, 148, 136]);
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
  const totalH = [...buckets.values()].reduce((s, b) => s + b.km, 0);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M + half + 8, right: M },
    tableWidth: half,
    head: [[de ? 'Stunde' : 'Godzina', 'km', de ? 'Max km/h' : 'Maks. km/h']],
    body: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([h, b]) => [h, b.km.toFixed(1), String(Math.round(b.max))]),
    foot: [[de ? 'Gesamt' : 'Razem', totalH.toFixed(1), '']],
    ...theme,
    footStyles: { fillColor: BG, textColor: INK, fontStyle: 'bold', fontSize: 7.6 },
    columnStyles: { 0: { fontStyle: 'bold' } },
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

  footer(c, f, de);
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
    vehicleName,
    `${driverName ? `${driverName}   ·   ` : ''}${rangeLabel}`,
  );
  const perDay = days.map((d) => ({ ...d, s: routeStats(d.points, d.km) }));
  const driveTotal = perDay.reduce((s, d) => s + d.s.driveMin, 0);
  const maxSpeed = Math.max(...perDay.map((d) => d.s.maxSpeed));

  const gap = 4;
  const cardW = (W - 2 * M - 3 * gap) / 4;
  card(c, f, M, y, cardW, de ? 'Distanz gesamt' : 'Dystans łącznie', `${totalKm} km`, PRIMARY);
  card(c, f, M + cardW + gap, y, cardW, de ? 'Tage' : 'Dni', String(days.length), [13, 148, 136]);
  card(c, f, M + 2 * (cardW + gap), y, cardW, de ? 'Fahrzeit' : 'Czas jazdy', hhmm(driveTotal), [16, 185, 129]);
  card(c, f, M + 3 * (cardW + gap), y, cardW, de ? 'Max. Geschw.' : 'Maks. prędkość', `${maxSpeed} km/h`, RED);
  y += 23;

  section(c, f, M, y, de ? 'Tagesübersicht' : 'Zestawienie dzienne');
  const trim = (s: string, n = 44) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  autoTable(doc, {
    startY: y + 3,
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
    foot: [[de ? 'Gesamt' : 'Razem', totalKm.toFixed(1), hhmm(driveTotal), String(maxSpeed), '', '']],
    ...tableTheme(f),
    footStyles: { fillColor: BG, textColor: INK, fontStyle: 'bold', fontSize: 7.6 },
    columnStyles: { 0: { cellWidth: 21, fontStyle: 'bold' }, 1: { cellWidth: 14 }, 2: { cellWidth: 18 }, 3: { cellWidth: 18 } },
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

  footer(c, f, de);
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

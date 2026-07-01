/**
 * Professional PDF Generator for Tachoprüfung
 * Uses jsPDF + jspdf-autotable for consistent, branded PDF reports
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { computeVehicleAverages, type VehicleAvgInput } from './vehicle-averages';

// ── Brand colors ──
const C = {
  primary:      [30, 64, 175]   as [number, number, number],
  primaryLight: [99, 102, 241]  as [number, number, number],
  accent:       [16, 185, 129]  as [number, number, number],
  danger:       [220, 38, 38]   as [number, number, number],
  warning:      [245, 158, 11]  as [number, number, number],
  success:      [21, 128, 61]   as [number, number, number],
  dark:         [15, 23, 42]    as [number, number, number],
  gray:         [100, 116, 139] as [number, number, number],
  lightGray:    [241, 245, 249] as [number, number, number],
  white:        [255, 255, 255] as [number, number, number],
  weekendBg:    [254, 242, 242] as [number, number, number],
  purple:       [124, 58, 237]  as [number, number, number],
  orange:       [234, 88, 12]   as [number, number, number],
  teal:         [13, 148, 136]  as [number, number, number],
  blue:         [37, 99, 235]   as [number, number, number],
};

const LOGO_URL = 'https://lfrfrp.stripocdn.email/content/guids/CABINET_862a1b05e2f09e6cca20d3b1bce9a4ee0b92caa7a66ee37aabdb90e233f8e4dc/images/image_6.png';

let cachedLogo: string | null = null;

// ── Inter font for beautiful multi-language PDF (Polish, Greek, etc.) ──
let cachedFontRegular: string | null = null;
let cachedFontBold: string | null = null;

async function loadFontFile(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch { return null; }
}

export async function loadInterFonts(): Promise<{ regular: string; bold: string } | null> {
  if (cachedFontRegular && cachedFontBold) return { regular: cachedFontRegular, bold: cachedFontBold };
  const [regular, bold] = await Promise.all([
    loadFontFile('/fonts/Inter-Regular.ttf'),
    loadFontFile('/fonts/Inter-Bold.ttf'),
  ]);
  if (!regular) return null;
  cachedFontRegular = regular;
  cachedFontBold = bold || regular;
  return { regular: cachedFontRegular, bold: cachedFontBold };
}

export function registerInterFont(doc: jsPDF, fonts: { regular: string; bold: string }) {
  doc.addFileToVFS('Inter-Regular.ttf', fonts.regular);
  doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', fonts.bold);
  doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
}

async function loadLogo(): Promise<string | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => { cachedLogo = reader.result as string; resolve(cachedLogo); };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

function fmtNow(): string {
  return new Date().toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, '').trim() || 'Export';
}

function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function dec(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

// ── PDF Context ──

export interface Ctx {
  doc: jsPDF;
  W: number;   // page width
  H: number;   // page height
  M: number;   // margin
  logo: string | null;
}

export async function ctx(orientation: 'portrait' | 'landscape' = 'portrait'): Promise<Ctx> {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const logo = await loadLogo();
  return { doc, W: doc.internal.pageSize.getWidth(), H: doc.internal.pageSize.getHeight(), M: 14, logo };
}

// ═══════════════════════════════════════════════════════════
//  BRANDED HEADER
// ═══════════════════════════════════════════════════════════

export function drawHeader(c: Ctx, title: string, subtitle?: string): number {
  const { doc, W, M, logo } = c;

  // ── Gradient-style top bar ──
  doc.setFillColor(...C.primary);
  doc.rect(0, 0, W, 2.5, 'F');
  doc.setFillColor(...C.primaryLight);
  doc.rect(0, 2.5, W, 0.8, 'F');

  let x = M;
  const y = 7;

  // ── Logo ──
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', M, y, 30, 13);
      x = M + 34;
    } catch { /* skip */ }
  }

  // ── Company ──
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.gray);
  doc.text('LTS Logistik GmbH', x, y + 3);

  // ── Title ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...C.dark);
  doc.text(title, x, y + 10);

  // ── Subtitle ──
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.gray);
    doc.text(subtitle, x, y + 15);
  }

  // ── Date right-aligned ──
  doc.setFontSize(7);
  doc.setTextColor(...C.gray);
  doc.text(fmtNow(), W - M, y + 3, { align: 'right' });

  // ── Separator ──
  const sepY = y + 19;
  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.4);
  doc.line(M, sepY, W - M, sepY);
  doc.setDrawColor(...C.primaryLight);
  doc.setLineWidth(0.15);
  doc.line(M, sepY + 0.6, W - M, sepY + 0.6);

  return sepY + 4;
}

// ═══════════════════════════════════════════════════════════
//  BRANDED FOOTER (all pages)
// ═══════════════════════════════════════════════════════════

export function drawFooter(c: Ctx) {
  const { doc, W, H, M } = c;
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    // Bottom gradient bar
    doc.setFillColor(...C.primaryLight);
    doc.rect(0, H - 3.3, W, 0.8, 'F');
    doc.setFillColor(...C.primary);
    doc.rect(0, H - 2.5, W, 2.5, 'F');
    // Footer text
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.gray);
    doc.text('LTS Logistik GmbH — Tachoprüfung · Vertraulich', M, H - 5);
    doc.text(`Seite ${i} von ${pages}  ·  ${fmtNow()}`, W - M, H - 5, { align: 'right' });
    // Thin separator above footer
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(M, H - 8, W - M, H - 8);
  }
}

// ═══════════════════════════════════════════════════════════
//  METRIC CARD (with accent bar)
// ═══════════════════════════════════════════════════════════

export function drawCard(doc: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string, color: [number, number, number]) {
  // Outer card
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
  // Accent left bar
  doc.setFillColor(...color);
  doc.roundedRect(x, y, 2, h, 1, 1, 'F');
  doc.rect(x + 1, y, 1, h, 'F'); // fix rounding on right side of accent
  // Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(...C.gray);
  doc.text(label.toUpperCase(), x + 5, y + 5.5);
  // Value
  doc.setFontSize(12);
  doc.setTextColor(...color);
  doc.text(value, x + 5, y + h - 3.5);
}

// 2-line card for compact grids
function drawCard2(doc: jsPDF, x: number, y: number, w: number, label: string, mainVal: string, subVal: string, color: [number, number, number]) {
  const h = 20;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
  doc.setFillColor(...color);
  doc.roundedRect(x, y, 2, h, 1, 1, 'F');
  doc.rect(x + 1, y, 1, h, 'F');
  // Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(...C.gray);
  doc.text(label.toUpperCase(), x + 5, y + 5.5);
  // Main value
  doc.setFontSize(11);
  doc.setTextColor(...color);
  doc.text(mainVal, x + 5, y + 12.5);
  // Sub-value
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.gray);
  doc.text(subVal, x + 5, y + 17);
}

// Section label
function drawSection(doc: jsPDF, x: number, y: number, label: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...C.dark);
  doc.text(label, x, y);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.15);
  doc.line(x, y + 1.5, x + 40, y + 1.5);
  return y + 4;
}

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

interface Summary {
  total_work_hm: string;
  total_work_minutes: number;
  total_driving_hm: string;
  total_driving_minutes: number;
  total_break_hm: string;
  total_break_minutes: number;
  night_25_minutes: number;
  night_25_hm: string;
  night_40_minutes: number;
  night_40_hm: string;
  diet_count: number;
  total_shifts: number;
  total_manual_hm?: string;
  total_manual_minutes?: number;
  total_avail_hm?: string;
  total_avail_minutes?: number;
  total_night_hm?: string;
  total_night_minutes?: number;
}

interface TimeSegment {
  start: string;
  end: string;
  duration_minutes: number;
}

interface Shift {
  shift_start: string;
  shift_end: string;
  shift_date: string;
  weekday: string;
  duration_hm: string;
  duration_minutes: number;
  driving_hm: string;
  driving_minutes: number;
  work_only_hm: string;
  work_only_minutes: number;
  break_hm: string;
  break_minutes: number;
  night_25_minutes: number;
  night_25_hm: string;
  night_40_minutes: number;
  night_40_hm: string;
  has_diet: boolean;
  vehicles: string[];
  manual_minutes?: number;
  manual_hm?: string;
  avail_minutes?: number;
  avail_hm?: string;
  driving_segments?: TimeSegment[];
  break_segments?: TimeSegment[];
}

// ═══════════════════════════════════════════════════════════════
//  1) ANALYSIS PDF — Single driver Fahreranalyse
// ═══════════════════════════════════════════════════════════════

export async function generateAnalysisPdf(
  driverName: string,
  cardNumber: string,
  summary: Summary,
  shifts: Shift[],
) {
  const c = await ctx('portrait');
  const { doc, W, M } = c;

  // ── Period from shifts ──
  const periodStr = shifts.length > 0
    ? `${shifts[0].shift_date} – ${shifts[shifts.length - 1].shift_date}`
    : '';

  let y = drawHeader(c, `Fahreranalyse: ${driverName}`, `Kartennr. ${cardNumber}  ·  ${periodStr}  ·  ${shifts.length} Schichten`);

  // ── Row 1: Main metrics (3 cards) ──
  const cw3 = (W - 2 * M - 8) / 3;
  y += 1;
  drawCard2(doc, M, y, cw3, 'Arbeitszeit', summary.total_work_hm, `${dec(summary.total_work_minutes)}h dezimal`, C.primary);
  drawCard2(doc, M + cw3 + 4, y, cw3, 'Lenkzeit', summary.total_driving_hm, `${dec(summary.total_driving_minutes)}h dezimal`, C.accent);
  drawCard2(doc, M + 2 * (cw3 + 4), y, cw3, 'Pausen', summary.total_break_hm, `${dec(summary.total_break_minutes)}h dezimal`, C.gray);
  y += 23;

  // ── Row 2: Night + Spesen + Manual + Bereitschaft (4 cards) ──
  const cw4 = (W - 2 * M - 12) / 4;
  drawCard2(doc, M, y, cw4, 'Nacht 25%', `${dec(summary.night_25_minutes)}h`, summary.night_25_hm, C.primaryLight);
  drawCard2(doc, M + (cw4 + 4), y, cw4, 'Nacht 40%', `${dec(summary.night_40_minutes)}h`, summary.night_40_hm, C.purple);
  drawCard2(doc, M + 2 * (cw4 + 4), y, cw4, 'Spesen', String(summary.diet_count), `Schichten mit Spesen`, C.warning);
  const manualMin = summary.total_manual_minutes || 0;
  drawCard2(doc, M + 3 * (cw4 + 4), y, cw4, 'Manual', summary.total_manual_hm || hm(manualMin), `${dec(manualMin)}h dezimal`, C.orange);
  y += 23;

  // ── Row 3: Bereitschaft + Nacht gesamt + Schichten ──
  const cw3b = (W - 2 * M - 8) / 3;
  const availMin = summary.total_avail_minutes || 0;
  drawCard(doc, M, y, cw3b, 16, 'Bereitschaft', summary.total_avail_hm || hm(availMin), C.teal);
  const nightTotal = summary.total_night_minutes || (summary.night_25_minutes + summary.night_40_minutes);
  drawCard(doc, M + cw3b + 4, y, cw3b, 16, 'Nacht gesamt', summary.total_night_hm || hm(nightTotal), C.blue);
  drawCard(doc, M + 2 * (cw3b + 4), y, cw3b, 16, 'Schichten', String(summary.total_shifts), C.dark);
  y += 20;

  // ── Vehicles ──
  const allVehicles = [...new Set(shifts.flatMap((s) => s.vehicles))];
  if (allVehicles.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.gray);
    doc.text(`Fahrzeuge: ${allVehicles.join('  ·  ')}`, M, y);
    y += 4;
  }

  // ── Shifts table ──
  y = drawSection(doc, M, y + 1, 'Schichtübersicht');

  const hasManual = shifts.some((s) => (s.manual_minutes || 0) > 0);

  const head = hasManual
    ? [['Tag', 'Datum', 'Start', 'Ende', 'Dauer', 'Fahrt', 'Arbeit', 'Pause', 'Manual', 'N25%', 'N40%', 'Spesen']]
    : [['Tag', 'Datum', 'Start', 'Ende', 'Dauer', 'Fahrt', 'Arbeit', 'Pause', 'N25%', 'N40%', 'Spesen']];

  const body = shifts.map((s) => {
    const row = [
      s.weekday,
      s.shift_date,
      s.shift_start?.split(' ')[1] || s.shift_start,
      s.shift_end?.split(' ')[1] || s.shift_end,
      s.duration_hm,
      s.driving_hm,
      s.work_only_hm,
      s.break_hm,
    ];
    if (hasManual) row.push(s.manual_hm || '—');
    row.push(dec(s.night_25_minutes), dec(s.night_40_minutes), s.has_diet ? 'JA' : '—');
    return row;
  });

  // Totals foot row
  const totalManual = shifts.reduce((a, s) => a + (s.manual_minutes || 0), 0);
  const totalN25 = shifts.reduce((a, s) => a + s.night_25_minutes, 0);
  const totalN40 = shifts.reduce((a, s) => a + s.night_40_minutes, 0);
  const totalSpesen = shifts.filter((s) => s.has_diet).length;
  const foot = [
    '', 'SUMME', '', '',
    summary.total_work_hm,
    summary.total_driving_hm,
    '',
    summary.total_break_hm,
  ];
  if (hasManual) foot.push(hm(totalManual));
  foot.push(dec(totalN25), dec(totalN40), String(totalSpesen));

  const spesenCol = hasManual ? 11 : 10;

  autoTable(doc, {
    startY: y,
    head,
    body,
    foot: [foot],
    styles: { fontSize: 7, cellPadding: 1.8, lineWidth: 0.1, lineColor: [226, 232, 240], valign: 'middle' },
    headStyles: { fillColor: C.primary, textColor: 255, fontStyle: 'bold', fontSize: 6.5, cellPadding: 2.5 },
    footStyles: { fillColor: C.primary, textColor: 255, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 10 },
      1: { cellWidth: 18 },
      4: { fontStyle: 'bold', halign: 'center' },
      5: { halign: 'center' },
      6: { halign: 'center' },
      7: { halign: 'center' },
      ...(hasManual ? { 8: { halign: 'center' } } : {}),
      [spesenCol - 2]: { halign: 'right' },
      [spesenCol - 1]: { halign: 'right' },
      [spesenCol]: { halign: 'center', fontStyle: 'bold' },
    },
    didParseCell: (data: any) => {
      if (data.section !== 'body') return;
      const shift = shifts[data.row.index];
      if (!shift) return;
      const wd = shift.weekday;
      if (['So', 'Nd', 'Sa', 'Su'].includes(wd)) {
        data.cell.styles.fillColor = C.weekendBg;
      }
      if (data.column.index === spesenCol && shift.has_diet) {
        data.cell.styles.textColor = C.success;
        data.cell.styles.fontStyle = 'bold';
      }
      // Manual highlight
      if (hasManual && data.column.index === 8 && (shift.manual_minutes || 0) > 0) {
        data.cell.styles.textColor = C.orange;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: M, right: M },
  });

  drawFooter(c);
  doc.save(`Fahreranalyse_${safeName(driverName)}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
//  2) SETTLEMENT PDF — Monatsabrechnung
// ═══════════════════════════════════════════════════════════════

interface SettlementDriverData {
  driver_name: string;
  card_number: string;
  personal_nr: string;
  diet_rate: number;
  summary: {
    total_work_minutes: number;
    total_work_hm: string;
    total_driving_minutes: number;
    total_driving_hm: string;
    night_25_minutes: number;
    night_25_hm: string;
    night_40_minutes: number;
    night_40_hm: string;
    diet_count: number;
    effective_diet_count: number;
    vma_amount: number;
    total_shifts: number;
    total_break_minutes: number;
    total_break_hm: string;
  };
}

export async function generateSettlementPdf(period: string, drivers: SettlementDriverData[]) {
  const c = await ctx('landscape');
  const { doc, W, M } = c;

  const [year, mon] = period.split('-');
  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const monthLabel = `${monthNames[parseInt(mon) - 1]} ${year}`;

  let y = drawHeader(c, `Monatsabrechnung — ${monthLabel}`, `${drivers.length} Fahrer  ·  Abrechnungszeitraum ${period}`);

  // ── Totals ──
  let tWork = 0, tN25 = 0, tN40 = 0, tSpesen = 0, tVma = 0, tShifts = 0;
  for (const d of drivers) {
    tWork += d.summary.total_work_minutes;
    tN25 += d.summary.night_25_minutes;
    tN40 += d.summary.night_40_minutes;
    tSpesen += d.summary.effective_diet_count;
    tVma += d.summary.vma_amount;
    tShifts += d.summary.total_shifts;
  }

  const cw6 = (W - 2 * M - 20) / 6;
  y += 1;
  drawCard(doc, M, y, cw6, 16, 'Fahrer', String(drivers.length), C.primary);
  drawCard(doc, M + (cw6 + 4), y, cw6, 16, 'Schichten', String(tShifts), C.accent);
  drawCard(doc, M + 2 * (cw6 + 4), y, cw6, 16, 'Arbeitszeit', hm(tWork), C.primaryLight);
  drawCard(doc, M + 3 * (cw6 + 4), y, cw6, 16, 'Nacht 25%', dec(tN25), C.purple);
  drawCard(doc, M + 4 * (cw6 + 4), y, cw6, 16, 'Nacht 40%', dec(tN40), C.danger);
  drawCard(doc, M + 5 * (cw6 + 4), y, cw6, 16, 'VMA Summe', `${tVma.toFixed(2)} €`, C.warning);
  y += 20;

  // ── Drivers table ──
  y = drawSection(doc, M, y, 'Fahrerübersicht');

  const head = [['Nr', 'Fahrer', 'Pers.Nr.', 'Schichten', 'AZ', 'Lenk.', 'N25%', 'N40%', 'Spesen', 'Satz €', 'VMA €']];
  const body = drivers.map((d, i) => [
    String(i + 1),
    d.driver_name,
    d.personal_nr || '—',
    String(d.summary.total_shifts),
    d.summary.total_work_hm,
    d.summary.total_driving_hm,
    dec(d.summary.night_25_minutes),
    dec(d.summary.night_40_minutes),
    String(d.summary.effective_diet_count),
    d.diet_rate.toFixed(2),
    d.summary.vma_amount.toFixed(2),
  ]);

  autoTable(doc, {
    startY: y,
    head,
    body,
    foot: [[
      '', 'SUMME', '', String(tShifts), hm(tWork), '',
      dec(tN25), dec(tN40), String(tSpesen), '', tVma.toFixed(2),
    ]],
    styles: { fontSize: 7.5, cellPadding: 2.2, lineWidth: 0.1, lineColor: [226, 232, 240] },
    headStyles: { fillColor: C.primary, textColor: 255, fontStyle: 'bold', fontSize: 7, cellPadding: 2.8 },
    footStyles: { fillColor: C.primary, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { fontStyle: 'bold' },
      3: { halign: 'center' },
      4: { halign: 'center', fontStyle: 'bold' },
      5: { halign: 'center' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'center' },
      9: { halign: 'right' },
      10: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: M, right: M },
  });

  drawFooter(c);
  doc.save(`Abrechnung_${period}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
//  3) COMPLIANCE PDF — EU 561/2006
// ═══════════════════════════════════════════════════════════════

export interface ComplianceViolation {
  date: string;
  weekday: string;
  type: 'daily_driving' | 'daily_work' | 'short_break' | 'rest_period' | 'weekly_driving';
  description: string;
  actual: string;
  limit: string;
  severity: 'warning' | 'violation';
}

export interface ComplianceReport {
  driverName: string;
  cardNumber: string;
  period: string;
  totalShifts: number;
  violations: ComplianceViolation[];
  score: number;
}

export function analyzeCompliance(
  driverName: string,
  cardNumber: string,
  shifts: Shift[],
): ComplianceReport {
  const violations: ComplianceViolation[] = [];
  const period = shifts.length > 0
    ? `${shifts[0].shift_date} — ${shifts[shifts.length - 1].shift_date}`
    : '';

  for (const s of shifts) {
    if (s.driving_minutes > 600) {
      violations.push({ date: s.shift_date, weekday: s.weekday, type: 'daily_driving',
        description: 'Tägliche Lenkzeit über 10h (absolutes Maximum)',
        actual: `${dec(s.driving_minutes)}h`, limit: '10:00h', severity: 'violation' });
    } else if (s.driving_minutes > 540) {
      violations.push({ date: s.shift_date, weekday: s.weekday, type: 'daily_driving',
        description: 'Tägliche Lenkzeit über 9h (max. 2x pro Woche)',
        actual: `${dec(s.driving_minutes)}h`, limit: '9:00h', severity: 'warning' });
    }

    if (s.duration_minutes > 660) {
      violations.push({ date: s.shift_date, weekday: s.weekday, type: 'daily_work',
        description: 'Tägliche Arbeitszeit über 11h',
        actual: `${dec(s.duration_minutes)}h`, limit: '10:00h', severity: 'violation' });
    } else if (s.duration_minutes > 600) {
      violations.push({ date: s.shift_date, weekday: s.weekday, type: 'daily_work',
        description: 'Tägliche Arbeitszeit über 10h (Ausgleich erforderlich)',
        actual: `${dec(s.duration_minutes)}h`, limit: '10:00h', severity: 'warning' });
    }

    if (s.driving_minutes > 270 && s.break_minutes < 45) {
      violations.push({ date: s.shift_date, weekday: s.weekday, type: 'short_break',
        description: 'Pause unter 45min bei über 4,5h Lenkzeit',
        actual: `${s.break_minutes}min`, limit: '45min', severity: 'violation' });
    }
  }

  // Weekly driving
  const weekMap = new Map<string, number>();
  for (const s of shifts) {
    const d = new Date(s.shift_date);
    const ws = new Date(d); ws.setDate(d.getDate() - d.getDay());
    const k = ws.toISOString().slice(0, 10);
    weekMap.set(k, (weekMap.get(k) || 0) + s.driving_minutes);
  }
  for (const [wk, mins] of weekMap) {
    if (mins > 56 * 60) {
      violations.push({ date: wk, weekday: 'KW', type: 'weekly_driving',
        description: 'Wöchentliche Lenkzeit über 56h',
        actual: `${dec(mins)}h`, limit: '56:00h', severity: 'violation' });
    }
  }

  // Rest periods
  for (let i = 1; i < shifts.length; i++) {
    const pe = shifts[i - 1].shift_end;
    const cs = shifts[i].shift_start;
    if (pe && cs) {
      const prev = new Date(pe.replace(' ', 'T'));
      const curr = new Date(cs.replace(' ', 'T'));
      const rest = (curr.getTime() - prev.getTime()) / 60000;
      if (rest > 0 && rest < 9 * 60) {
        violations.push({ date: shifts[i].shift_date, weekday: shifts[i].weekday, type: 'rest_period',
          description: 'Ruhezeit unter 9h (Min: 11h, reduziert 9h max 3x/Woche)',
          actual: `${dec(rest)}h`, limit: '11:00h (9:00h)', severity: 'violation' });
      } else if (rest >= 9 * 60 && rest < 11 * 60) {
        violations.push({ date: shifts[i].shift_date, weekday: shifts[i].weekday, type: 'rest_period',
          description: 'Verkürzte Ruhezeit (9–11h, max 3x pro Woche)',
          actual: `${dec(rest)}h`, limit: '11:00h', severity: 'warning' });
      }
    }
  }

  const vC = violations.filter((v) => v.severity === 'violation').length;
  const wC = violations.filter((v) => v.severity === 'warning').length;
  const score = Math.max(0, 100 - vC * 15 - wC * 5);
  violations.sort((a, b) => a.date.localeCompare(b.date));

  return { driverName, cardNumber, period, totalShifts: shifts.length, violations, score };
}

export async function generateCompliancePdf(report: ComplianceReport) {
  const c = await ctx('portrait');
  const { doc, W, M } = c;

  const vCount = report.violations.filter((v) => v.severity === 'violation').length;
  const wCount = report.violations.filter((v) => v.severity === 'warning').length;
  const scoreColor = report.score >= 80 ? C.success : report.score >= 50 ? C.warning : C.danger;

  let y = drawHeader(c, `Compliance-Bericht`, `${report.driverName}  ·  ${report.cardNumber}  ·  ${report.period}`);

  // ── Score card (large) ──
  y += 1;
  const cw4 = (W - 2 * M - 12) / 4;

  // Big score
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, cw4, 26, 2, 2, 'F');
  doc.setFillColor(...scoreColor);
  doc.roundedRect(M, y, 2.5, 26, 1.2, 1.2, 'F');
  doc.rect(M + 1.5, y, 1, 26, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(...C.gray);
  doc.text('COMPLIANCE SCORE', M + 6, y + 6);
  doc.setFontSize(22);
  doc.setTextColor(...scoreColor);
  doc.text(`${report.score}%`, M + 6, y + 19);
  // Status text
  doc.setFontSize(6);
  doc.setTextColor(...C.gray);
  doc.text(report.score >= 80 ? 'GUT' : report.score >= 50 ? 'PRÜFEN' : 'KRITISCH', M + 6, y + 23.5);

  drawCard(doc, M + cw4 + 4, y + 4, cw4, 18, 'Gepr. Schichten', String(report.totalShifts), C.primary);
  drawCard(doc, M + 2 * (cw4 + 4), y + 4, cw4, 18, 'Verstöße', String(vCount), C.danger);
  drawCard(doc, M + 3 * (cw4 + 4), y + 4, cw4, 18, 'Warnungen', String(wCount), C.warning);

  y += 30;

  // ── EU regulation reference ──
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.gray);
  doc.text('Prüfung gem. VO (EG) Nr. 561/2006, Richtlinie 2002/15/EG, ArbZG §3, FPersV', M, y);
  y += 5;

  if (report.violations.length === 0) {
    y += 8;
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(M, y, W - 2 * M, 22, 3, 3, 'F');
    doc.setFillColor(...C.success);
    doc.roundedRect(M, y, 3, 22, 1.5, 1.5, 'F');
    doc.rect(M + 1.5, y, 1.5, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...C.success);
    doc.text('Keine Verstöße festgestellt', M + 10, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.gray);
    doc.text('Alle Lenk- und Ruhezeiten entsprechen den gesetzlichen Vorschriften.', M + 10, y + 17);
  } else {
    y = drawSection(doc, M, y, 'Festgestellte Verstöße und Warnungen');

    const head = [['', 'Datum', 'Tag', 'Kategorie', 'Beschreibung', 'IST-Wert', 'Grenzwert']];
    const tbody = report.violations.map((v) => [
      v.severity === 'violation' ? '!' : '~',
      v.date,
      v.weekday,
      v.type === 'daily_driving' ? 'Lenkzeit'
        : v.type === 'daily_work' ? 'Arbeitszeit'
        : v.type === 'short_break' ? 'Pause'
        : v.type === 'rest_period' ? 'Ruhezeit' : 'Woche',
      v.description,
      v.actual,
      v.limit,
    ]);

    autoTable(doc, {
      startY: y,
      head,
      body: tbody,
      styles: { fontSize: 7, cellPadding: 2.2, lineWidth: 0.1, lineColor: [226, 232, 240] },
      headStyles: { fillColor: C.dark, textColor: 255, fontStyle: 'bold', fontSize: 6.5, cellPadding: 2.8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 6, fontStyle: 'bold' },
        1: { cellWidth: 20 },
        2: { cellWidth: 10, halign: 'center' },
        3: { cellWidth: 20, fontStyle: 'bold' },
        5: { halign: 'center', fontStyle: 'bold' },
        6: { halign: 'center' },
      },
      didParseCell: (data: any) => {
        if (data.section !== 'body') return;
        const v = report.violations[data.row.index];
        if (!v) return;
        const isViol = v.severity === 'violation';
        if (data.column.index === 0) {
          data.cell.styles.textColor = isViol ? C.danger : C.warning;
        }
        if (data.column.index === 5) {
          data.cell.styles.textColor = isViol ? C.danger : C.warning;
        }
        // Full row tint for violations
        if (isViol && data.row.index % 2 === 0) {
          data.cell.styles.fillColor = [254, 242, 242];
        }
      },
      margin: { left: M, right: M },
    });

    // ── Legal reference ──
    const legY = (doc as any).lastAutoTable.finalY + 8;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.15);
    doc.line(M, legY - 2, W - M, legY - 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...C.dark);
    doc.text('Rechtsgrundlage', M, legY + 1);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C.gray);
    const laws = [
      'VO (EG) Nr. 561/2006 — Lenk- und Ruhezeiten im Straßenverkehr',
      'Richtlinie 2002/15/EG — Arbeitszeit im Straßentransport',
      'ArbZG §3 — Tägliche Arbeitszeit max. 10 Stunden',
      'FPersV — Fahrpersonalverordnung',
    ];
    laws.forEach((law, i) => {
      doc.text(`·  ${law}`, M + 2, legY + 5 + i * 3.5);
    });
  }

  drawFooter(c);
  doc.save(`Compliance_${safeName(report.driverName)}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
//  4) VERSTÖSSE PDF — Official violation document with signature
//     Matches transitet.eu format exactly
// ═══════════════════════════════════════════════════════════════

/** Violation severity categories per EU regulation */
type VerstossKategorie = 'MSI' | 'VSI' | 'SI' | 'MI' | '-';

/** Format Euro amount with consistent alignment: "1.234,50 €" */
function fmtEur(val: number): string {
  const parts = val.toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intPart},${parts[1]} \u20AC`;
}

interface VerstossEntry {
  datum: string;        // DD.MM.YYYY
  zeit: string;         // HH:MM or HH:MM - HH:MM
  beschreibung: string;
  rechtsgrundlage: string;
  bussgeldFahrer: number;
  bussgeldUnternehmen: number;
  kategorie: VerstossKategorie;
}

interface VerstossType {
  beschreibung: string;
  msi: number;
  vsi: number;
  si: number;
  mi: number;
  anzahl: number;
  bussgeldFahrer: number;
  bussgeldUnternehmen: number;
}

/**
 * Analyze shifts and produce Verstöße entries following EU VO 165/2014, FPersV, ArbZG
 */
/**
 * Comprehensive violation analysis following:
 * - VO (EG) Nr. 561/2006 — Lenk- und Ruhezeiten
 * - EU VO 165/2014 — Fahrtenschreiber
 * - ArbZG §§ 3,4 — Arbeitszeitgesetz
 * - FPersV — Fahrpersonalverordnung
 * - Richtlinie 2002/15/EG — Arbeitszeit Straßentransport
 * - BKatV / LV 48 — Bußgeldkatalog Fahrpersonalrecht
 *
 * Severity thresholds per Annex III Directive 2006/22/EC (amended by 2016/403 & 2022/694):
 *   MI  = Minor Infringement
 *   SI  = Serious Infringement
 *   VSI = Very Serious Infringement
 *   MSI = Most Serious Infringement
 */
export interface VerstosseOptions {
  excludeManualEntry?: boolean;
}

/**
 * Check Art. 7 continuous driving and break compliance using driving_segments.
 * Returns violations for continuous driving exceeding 4.5h without proper break,
 * with proper split-break recognition (15min + 30min).
 */
function checkContinuousDriving(
  s: Shift,
  datum: string,
  zeitRange: string,
  V: typeof violationTexts['de'],
): VerstossEntry[] {
  const results: VerstossEntry[] = [];
  const segments = s.driving_segments;
  if (!segments || segments.length === 0) return results;

  const breaks = s.break_segments || [];

  // Build a timeline of driving and break events sorted by start time
  type Event = { start: Date; end: Date; type: 'drive' | 'break'; minutes: number };
  const events: Event[] = [];
  for (const seg of segments) {
    events.push({
      start: new Date(seg.start.replace(' ', 'T')),
      end: new Date(seg.end.replace(' ', 'T')),
      type: 'drive',
      minutes: seg.duration_minutes,
    });
  }
  for (const b of breaks) {
    events.push({
      start: new Date(b.start.replace(' ', 'T')),
      end: new Date(b.end.replace(' ', 'T')),
      type: 'break',
      minutes: b.duration_minutes,
    });
  }
  events.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Track accumulated driving since last valid break reset
  let accDriving = 0;
  let accBreak = 0; // accumulated break parts for split break
  let firstPartTaken = false; // whether a ≥15min break part was taken

  for (const ev of events) {
    if (ev.type === 'drive') {
      accDriving += ev.minutes;
    } else {
      // Break event
      if (ev.minutes >= 45) {
        // Full 45min break — resets driving counter
        accDriving = 0;
        accBreak = 0;
        firstPartTaken = false;
      } else if (!firstPartTaken && ev.minutes >= 15) {
        // First part of split break (≥15min)
        firstPartTaken = true;
        accBreak = ev.minutes;
      } else if (firstPartTaken && ev.minutes >= 30) {
        // Second part of split break (≥30min) — valid split, resets
        accDriving = 0;
        accBreak = 0;
        firstPartTaken = false;
      } else {
        // Break too short to count as valid split part
        accBreak += ev.minutes;
        if (accBreak >= 45) {
          accDriving = 0;
          accBreak = 0;
          firstPartTaken = false;
        }
      }
    }

    // Check if continuous driving exceeded 4.5h (270min)
    if (accDriving > 270) {
      // Determine severity per Regulation 2016/403 Annex III
      // MI: 4h30 < driving ≤ 5h; SI: 5h < driving ≤ 6h; VSI: 6h+
      let kat: VerstossKategorie;
      let fahrer: number;
      let unt: number;
      if (accDriving > 360) {
        kat = 'VSI'; fahrer = 250; unt = 750;
      } else if (accDriving > 300) {
        kat = 'SI'; fahrer = 150; unt = 450;
      } else {
        kat = 'MI'; fahrer = 50; unt = 0;
      }
      const shortfall = 45 - Math.min(accBreak, 44);
      results.push({
        datum, zeit: zeitRange,
        beschreibung: V.continuousDriving(hm(accDriving), shortfall),
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 7',
        bussgeldFahrer: fahrer, bussgeldUnternehmen: unt, kategorie: kat,
      });
      // Only report once per shift
      return results;
    }
  }
  return results;
}


export function analyzeVerstoesse(
  driverName: string,
  cardNumber: string,
  shifts: Shift[],
  lang: VerstosseLang = 'de',
  options: VerstosseOptions = {},
): { entries: VerstossEntry[]; types: VerstossType[]; period: string } {
  const entries: VerstossEntry[] = [];
  const V = violationTexts[lang];

  const fmtDatum = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  };

  const fmtTime = (dt: string) => {
    if (!dt) return '';
    const parts = dt.split(' ');
    return parts.length > 1 ? parts[1].slice(0, 5) : dt.slice(0, 5);
  };

  // Get Monday date string for a given date
  const getMonday = (dateStr: string): string => {
    const d = new Date(dateStr);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    return monday.toISOString().slice(0, 10);
  };

  // ════════════════════════════════════════════════════════════════
  //  SEVERITY HELPERS — per Regulation (EU) 2016/403 Annex III
  //  (amended by 2022/694 and Directive 2024/846)
  // ════════════════════════════════════════════════════════════════

  // Art. 6.1 — Daily driving time (9h limit, or 10h when extension allowed)
  // 9h limit: MI <60min over, SI 60-120min, VSI >120min, MSI ≥270min (50%+) without break
  function dailyDrivingKat(overMin: number, limit: 9 | 10): { kat: VerstossKategorie; fahrer: number; unt: number } {
    const msiThreshold = limit * 60 * 0.5; // 50% over = MSI
    if (overMin >= msiThreshold) return { kat: 'MSI', fahrer: Math.ceil(overMin / 30) * 90, unt: Math.ceil(overMin / 30) * 270 };
    if (overMin >= 120) return { kat: 'VSI', fahrer: Math.ceil(overMin / 30) * 60, unt: Math.ceil(overMin / 30) * 180 };
    if (overMin >= 60) return { kat: 'SI', fahrer: Math.ceil(overMin / 30) * 30, unt: Math.ceil(overMin / 30) * 90 };
    return { kat: 'MI', fahrer: 30, unt: 90 };
  }

  // Art. 6.2 — Weekly driving time (56h limit)
  // MI: <4h over, SI: 4-9h, VSI: 9-14h, MSI: ≥14h (25%+)
  function weeklyDrivingKat(overMin: number): { kat: VerstossKategorie; fahrer: number; unt: number } {
    if (overMin >= 14 * 60) return { kat: 'MSI', fahrer: 500, unt: 1500 };
    if (overMin >= 9 * 60) return { kat: 'VSI', fahrer: 375, unt: 1125 };
    if (overMin >= 4 * 60) return { kat: 'SI', fahrer: 250, unt: 750 };
    return { kat: 'MI', fahrer: 100, unt: 300 };
  }

  // Art. 6.3 — Bi-weekly driving time (90h limit)
  // MI: <10h over, SI: 10-15h, VSI: 15-22h30, MSI: ≥22h30 (25%+)
  function biWeeklyDrivingKat(overMin: number): { kat: VerstossKategorie; fahrer: number; unt: number } {
    if (overMin >= 22 * 60 + 30) return { kat: 'MSI', fahrer: 500, unt: 1500 };
    if (overMin >= 15 * 60) return { kat: 'VSI', fahrer: 375, unt: 1125 };
    if (overMin >= 10 * 60) return { kat: 'SI', fahrer: 250, unt: 750 };
    return { kat: 'MI', fahrer: 100, unt: 300 };
  }

  // Art. 8.2 — Daily rest (11h regular, 9h reduced)
  // Regular (11h): MI: 10-11h, SI: 8h30-10h, VSI: <8h30
  // Reduced (9h): MI: 8-9h, SI: 7-8h, VSI: <7h
  function dailyRestKat(restMin: number, isReduced: boolean): { kat: VerstossKategorie; fahrer: number; unt: number } {
    if (isReduced) {
      if (restMin < 7 * 60) return { kat: 'VSI', fahrer: 500, unt: 1500 };
      if (restMin < 8 * 60) return { kat: 'SI', fahrer: 250, unt: 750 };
      return { kat: 'MI', fahrer: 100, unt: 300 };
    }
    if (restMin < 8.5 * 60) return { kat: 'VSI', fahrer: 500, unt: 1500 };
    if (restMin < 10 * 60) return { kat: 'SI', fahrer: 250, unt: 750 };
    return { kat: 'MI', fahrer: 100, unt: 300 };
  }

  // Art. 8.6 — Weekly rest (45h regular, 24h reduced)
  // Regular (45h): MI: 42-45h, SI: 36-42h, VSI: <36h
  // Reduced (24h): MI: 22-24h, SI: 20-22h, VSI: <20h
  function weeklyRestKat(restMin: number, isReduced: boolean): { kat: VerstossKategorie; fahrer: number; unt: number } {
    if (isReduced) {
      if (restMin < 20 * 60) return { kat: 'VSI', fahrer: 500, unt: 1500 };
      if (restMin < 22 * 60) return { kat: 'SI', fahrer: 250, unt: 750 };
      return { kat: 'MI', fahrer: 100, unt: 300 };
    }
    if (restMin < 36 * 60) return { kat: 'VSI', fahrer: 500, unt: 1500 };
    if (restMin < 42 * 60) return { kat: 'SI', fahrer: 250, unt: 750 };
    return { kat: 'MI', fahrer: 100, unt: 300 };
  }


  // ════════════════════════════════════════════════════════════════
  //  PER-SHIFT VIOLATIONS
  // ════════════════════════════════════════════════════════════════
  for (const s of shifts) {
    const datum = fmtDatum(s.shift_date);
    const startTime = fmtTime(s.shift_start);
    const endTime = fmtTime(s.shift_end);
    const zeitRange = `${startTime} - ${endTime}`;

    // ── 1) EU VO 165/2014 Art. 34(3) — Manuelle Eingabe fehlt/verspätet ──
    if (!options.excludeManualEntry && (s.manual_minutes || 0) > 0) {
      entries.push({
        datum, zeit: startTime,
        beschreibung: V.manualEntry(),
        rechtsgrundlage: 'EU VO 165/2014 Art. 34 Abs. 3',
        bussgeldFahrer: 37.50, bussgeldUnternehmen: 0, kategorie: 'MI',
      });
    }

    // ── 2) EU VO 165/2014 Art. 34(1) — Fahrzeugüberprüfung nicht dokumentiert ──
    if (s.driving_minutes > 0 && s.work_only_minutes <= 0 && s.duration_minutes > 30) {
      const diffMin = s.duration_minutes - s.driving_minutes - s.break_minutes - (s.avail_minutes || 0);
      entries.push({
        datum, zeit: startTime,
        beschreibung: V.vehicleCheck(diffMin > 0 ? hm(Math.abs(diffMin)) : ''),
        rechtsgrundlage: 'EU VO 165/2014 Art. 34 Abs. 1',
        bussgeldFahrer: 50, bussgeldUnternehmen: 0, kategorie: 'VSI',
      });
    }

    // ── 3) VO (EG) 561/2006 Art. 6.1 — Tägliche Lenkzeit ──
    // Max 9h, twice per week up to 10h
    if (s.driving_minutes > 540) {
      const ueber = s.driving_minutes - 540;
      const limit = s.driving_minutes > 600 ? 10 : 9;
      const effectiveOver = limit === 10 ? s.driving_minutes - 600 : ueber;
      if (effectiveOver > 0) {
        const k = dailyDrivingKat(effectiveOver, limit as 9 | 10);
        entries.push({
          datum, zeit: startTime,
          beschreibung: V.dailyDriving(String(limit), hm(effectiveOver)),
          rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 6 Abs. 1',
          bussgeldFahrer: k.fahrer, bussgeldUnternehmen: k.unt, kategorie: k.kat,
        });
      }
    }

    // ── 4) VO (EG) 561/2006 Art. 7 — Continuous driving & break compliance ──
    // Use driving_segments for precise check if available
    if (s.driving_segments && s.driving_segments.length > 0) {
      const art7violations = checkContinuousDriving(s, datum, zeitRange, V);
      entries.push(...art7violations);
    } else {
      // Fallback: simple check using total driving vs total break
      if (s.driving_minutes > 270 && s.break_minutes < 45) {
        const shortfall = 45 - s.break_minutes;
        let kat: VerstossKategorie;
        let fahrer: number;
        let unt: number;
        if (s.driving_minutes > 360) {
          kat = 'VSI'; fahrer = 250; unt = 750;
        } else if (s.driving_minutes > 300) {
          kat = 'SI'; fahrer = 150; unt = 450;
        } else {
          kat = 'MI'; fahrer = 50; unt = 0;
        }
        entries.push({
          datum, zeit: zeitRange,
          beschreibung: V.breakAfterDriving(s.break_minutes, shortfall),
          rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 7',
          bussgeldFahrer: fahrer, bussgeldUnternehmen: unt, kategorie: kat,
        });
      }
    }

    // ── 5) ArbZG § 4 — Ruhepause bei Arbeitszeit > 6h ──
    if (s.duration_minutes > 360 && s.break_minutes < 30) {
      const shortfall = 30 - s.break_minutes;
      entries.push({
        datum, zeit: zeitRange,
        beschreibung: V.breakAfter6h(s.break_minutes, shortfall),
        rechtsgrundlage: 'ArbZG § 4',
        bussgeldFahrer: 0, bussgeldUnternehmen: 60, kategorie: '-',
      });
    }
    if (s.duration_minutes > 540 && s.break_minutes < 45) {
      entries.push({
        datum, zeit: zeitRange,
        beschreibung: V.breakAfter9h(s.break_minutes),
        rechtsgrundlage: 'ArbZG § 4',
        bussgeldFahrer: 0, bussgeldUnternehmen: 120, kategorie: '-',
      });
    }

    // ── 6) ArbZG § 3 — Tägliche Arbeitszeit > 10h ──
    if (s.duration_minutes > 600) {
      const ueber = s.duration_minutes - 600;
      const busUnt = ueber > 120 ? 250 : ueber > 60 ? 150 : 75;
      entries.push({
        datum, zeit: zeitRange,
        beschreibung: V.dailyWorkExceeded(hm(ueber)),
        rechtsgrundlage: 'ArbZG § 3',
        bussgeldFahrer: 0, bussgeldUnternehmen: busUnt, kategorie: '-',
      });
    }

    // ── 7) Richtlinie 2002/15/EG Art. 7 — Nachtarbeit > 10h in 24h ──
    if ((s.night_25_minutes + s.night_40_minutes) > 0 && s.duration_minutes > 600) {
      entries.push({
        datum, zeit: zeitRange,
        beschreibung: V.nightWork(hm(s.duration_minutes)),
        rechtsgrundlage: 'Richtlinie 2002/15/EG Art. 7',
        bussgeldFahrer: 0, bussgeldUnternehmen: 150, kategorie: 'SI',
      });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  INTER-SHIFT: TÄGLICHE RUHEZEIT (Art. 8.2)
  // ════════════════════════════════════════════════════════════════
  // Regular: 11h, Reduced (max 3x between weekly rests): 9h
  // Also: Art. 8.4 — Split daily rest: 3h + 9h = valid alternative

  const allGaps: { start: string; end: string; restMin: number; index: number }[] = [];
  let reducedDailyRestCount = 0;

  for (let i = 1; i < shifts.length; i++) {
    const pe = shifts[i - 1].shift_end;
    const cs = shifts[i].shift_start;
    if (!pe || !cs) continue;

    const prev = new Date(pe.replace(' ', 'T'));
    const curr = new Date(cs.replace(' ', 'T'));
    const restMin = (curr.getTime() - prev.getTime()) / 60000;
    if (restMin > 0) allGaps.push({ start: pe, end: cs, restMin, index: i });
    if (restMin <= 0 || restMin > 24 * 60) continue;

    // Check for split daily rest (Art. 8.4): 3h + 9h within 24h
    // Look for a short rest (≥3h) earlier in the same 24h period
    let splitRestValid = false;
    if (restMin >= 9 * 60 && i >= 2) {
      const prevGapEnd = shifts[i - 1].shift_start;
      const prevGapStart = shifts[i - 2].shift_end;
      if (prevGapStart && prevGapEnd) {
        const pStart = new Date(prevGapStart.replace(' ', 'T'));
        const pEnd = new Date(prevGapEnd.replace(' ', 'T'));
        const prevRestMin = (pEnd.getTime() - pStart.getTime()) / 60000;
        // Check if both rests are within 24h of each other and first part ≥3h
        const totalSpanMin = (curr.getTime() - pStart.getTime()) / 60000;
        if (prevRestMin >= 180 && totalSpanMin <= 24 * 60) {
          splitRestValid = true; // Valid split rest: 3h + 9h
        }
      }
    }

    if (splitRestValid) {
      // Valid split daily rest per Art. 8.4 — no violation
      continue;
    }

    if (restMin < 9 * 60) {
      // Below even the reduced minimum (9h) — definite violation
      const k = dailyRestKat(restMin, true);
      entries.push({
        datum: fmtDatum(shifts[i].shift_date), zeit: fmtTime(cs),
        beschreibung: V.dailyRestBelow9h(hm(restMin), hm(9 * 60 - restMin)),
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 2',
        bussgeldFahrer: k.fahrer, bussgeldUnternehmen: k.unt, kategorie: k.kat,
      });
    } else if (restMin < 11 * 60) {
      reducedDailyRestCount++;
      // Reduced rest (9-11h) — allowed max 3x between weekly rests
      if (reducedDailyRestCount > 3) {
        const k = dailyRestKat(restMin, false);
        entries.push({
          datum: fmtDatum(shifts[i].shift_date), zeit: fmtTime(cs),
          beschreibung: V.reducedRestOver3x(hm(restMin), hm(11 * 60 - restMin)),
          rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 2',
          bussgeldFahrer: k.fahrer, bussgeldUnternehmen: k.unt, kategorie: k.kat,
        });
      }
    }

    // Reset reduced count at weekly rest boundaries
    if (restMin >= 24 * 60) {
      reducedDailyRestCount = 0;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  WEEKLY: Wöchentliche Lenkzeit (Art. 6.2)
  // ════════════════════════════════════════════════════════════════
  const weekDrivingMap = new Map<string, { total: number; dates: string[] }>();
  for (const s of shifts) {
    const wk = getMonday(s.shift_date);
    if (!weekDrivingMap.has(wk)) weekDrivingMap.set(wk, { total: 0, dates: [] });
    const w = weekDrivingMap.get(wk)!;
    w.total += s.driving_minutes;
    w.dates.push(s.shift_date);
  }

  for (const [weekStart, data] of weekDrivingMap) {
    // Art. 6.2 — Weekly driving > 56h
    if (data.total > 56 * 60) {
      const ueber = data.total - 56 * 60;
      const k = weeklyDrivingKat(ueber);
      entries.push({
        datum: fmtDatum(weekStart), zeit: V.calendarWeek(data.dates.length),
        beschreibung: V.weeklyDriving(hm(data.total), hm(ueber)),
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 6 Abs. 2',
        bussgeldFahrer: k.fahrer, bussgeldUnternehmen: k.unt, kategorie: k.kat,
      });
    }

    // Art. 6.1 — More than 2x extended daily driving (>9h) in same week
    const extended = shifts.filter(s => {
      return getMonday(s.shift_date) === weekStart && s.driving_minutes > 540 && s.driving_minutes <= 600;
    });
    if (extended.length > 2) {
      entries.push({
        datum: fmtDatum(weekStart), zeit: V.calendarWeekShort(),
        beschreibung: V.extendedDrivingOver2x(extended.length),
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 6 Abs. 1',
        bussgeldFahrer: 100, bussgeldUnternehmen: 300, kategorie: 'SI',
      });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  BI-WEEKLY: Doppelwoche Lenkzeit (Art. 6.3)
  // ════════════════════════════════════════════════════════════════
  const weekKeys = Array.from(weekDrivingMap.keys()).sort();
  for (let i = 0; i < weekKeys.length - 1; i++) {
    const w1 = weekDrivingMap.get(weekKeys[i])!;
    const w2 = weekDrivingMap.get(weekKeys[i + 1])!;
    const biWeekTotal = w1.total + w2.total;
    if (biWeekTotal > 90 * 60) {
      const ueber = biWeekTotal - 90 * 60;
      const k = biWeeklyDrivingKat(ueber);
      entries.push({
        datum: fmtDatum(weekKeys[i]), zeit: V.biWeek(),
        beschreibung: V.biWeeklyDriving(hm(biWeekTotal), hm(ueber)),
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 6 Abs. 3',
        bussgeldFahrer: k.fahrer, bussgeldUnternehmen: k.unt, kategorie: k.kat,
      });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  WEEKLY REST (Art. 8.6)
  // ════════════════════════════════════════════════════════════════
  // Regular: 45h, Reduced: min 24h (must compensate within 3 weeks)
  // Max 6 x 24h periods without weekly rest
  // In any 2 consecutive weeks: at least one regular (≥45h) weekly rest

  interface WeeklyRestInfo {
    date: string;
    restMin: number;
    isRegular: boolean;
    weekStart: string;
  }
  const weeklyRests: WeeklyRestInfo[] = [];

  if (shifts.length > 1) {
    let lastWeeklyRestDate = shifts[0].shift_date;

    for (const gap of allGaps) {
      if (gap.restMin >= 24 * 60) {
        const restDate = gap.end.split(' ')[0] || gap.end.slice(0, 10);
        const isRegular = gap.restMin >= 45 * 60;
        weeklyRests.push({
          date: restDate,
          restMin: gap.restMin,
          isRegular,
          weekStart: getMonday(restDate),
        });

        if (!isRegular) {
          // Reduced weekly rest — note it (compensation needed within 3 weeks)
          const k = weeklyRestKat(gap.restMin, true);
          if (gap.restMin < 24 * 60) {
            entries.push({
              datum: fmtDatum(restDate), zeit: hm(gap.restMin),
              beschreibung: V.insufficientWeeklyRest(hm(gap.restMin)),
              rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 6',
              bussgeldFahrer: k.fahrer, bussgeldUnternehmen: k.unt, kategorie: k.kat,
            });
          } else {
            entries.push({
              datum: fmtDatum(restDate), zeit: hm(gap.restMin),
              beschreibung: V.reducedWeeklyRest(hm(gap.restMin)),
              rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 6',
              bussgeldFahrer: 0, bussgeldUnternehmen: 0, kategorie: 'MI',
            });
          }
        }
        lastWeeklyRestDate = restDate;
      } else {
        // Check if too many days since last weekly rest (max 6 x 24h)
        const gapDate = gap.end.split(' ')[0] || gap.end.slice(0, 10);
        const daysSince = (new Date(gapDate).getTime() - new Date(lastWeeklyRestDate).getTime()) / (24 * 60 * 60000);
        if (daysSince > 6) {
          entries.push({
            datum: fmtDatum(gapDate), zeit: '',
            beschreibung: V.noWeeklyRest(Math.round(daysSince)),
            rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 6',
            bussgeldFahrer: 500, bussgeldUnternehmen: 1500, kategorie: 'VSI',
          });
          lastWeeklyRestDate = gapDate;
        }
      }
    }

    // Art. 8.6 — In any 2 consecutive weeks, at least one weekly rest must be regular (≥45h)
    for (let i = 0; i < weekKeys.length - 1; i++) {
      const wk1 = weekKeys[i];
      const wk2 = weekKeys[i + 1];
      const restsInW1 = weeklyRests.filter(r => r.weekStart === wk1);
      const restsInW2 = weeklyRests.filter(r => r.weekStart === wk2);
      const allRestsInPair = [...restsInW1, ...restsInW2];
      if (allRestsInPair.length >= 2 && !allRestsInPair.some(r => r.isRegular)) {
        entries.push({
          datum: fmtDatum(wk1), zeit: V.biWeek(),
          beschreibung: V.twoConsecutiveReducedWeeklyRest(),
          rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 6',
          bussgeldFahrer: 250, bussgeldUnternehmen: 750, kategorie: 'VSI',
        });
      }
    }

    // Art. 8.6 — Weekly rest compensation tracking
    // Reduced weekly rest must be compensated within 3 weeks
    for (const wr of weeklyRests) {
      if (wr.isRegular || wr.restMin >= 45 * 60) continue;
      const compensationNeeded = 45 * 60 - wr.restMin;
      const wrDate = new Date(wr.date);
      const deadlineDate = new Date(wrDate);
      deadlineDate.setDate(deadlineDate.getDate() + 21); // 3 weeks

      // Look for compensation rest (attached to a rest of ≥9h)
      const compensationFound = allGaps.some(g => {
        const gDate = new Date((g.end.split(' ')[0]) || g.end.slice(0, 10));
        return gDate > wrDate && gDate <= deadlineDate && g.restMin >= (9 * 60 + compensationNeeded);
      });

      // Only flag if the deadline is within our data range and not compensated
      const lastShiftDate = new Date(shifts[shifts.length - 1].shift_date);
      if (!compensationFound && deadlineDate <= lastShiftDate) {
        entries.push({
          datum: fmtDatum(wr.date), zeit: '',
          beschreibung: V.weeklyRestCompensationMissing(hm(compensationNeeded), fmtDatum(deadlineDate.toISOString().slice(0, 10))),
          rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 6',
          bussgeldFahrer: 250, bussgeldUnternehmen: 750, kategorie: 'SI',
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  WEEKLY WORKING TIME (Richtlinie 2002/15/EG Art. 4)
  // ════════════════════════════════════════════════════════════════
  for (const [weekStart] of weekDrivingMap) {
    const weekShifts = shifts.filter(s => getMonday(s.shift_date) === weekStart);
    const weekWorkMin = weekShifts.reduce((a, s) => a + s.duration_minutes, 0);

    if (weekWorkMin > 60 * 60) {
      const ueber = weekWorkMin - 60 * 60;
      entries.push({
        datum: fmtDatum(weekStart), zeit: V.calendarWeek(weekShifts.length),
        beschreibung: V.weeklyWorkExceeded(hm(weekWorkMin), hm(ueber)),
        rechtsgrundlage: 'Richtlinie 2002/15/EG Art. 4, ArbZG § 3',
        bussgeldFahrer: 0, bussgeldUnternehmen: ueber > 120 ? 500 : 250, kategorie: ueber > 120 ? 'VSI' : 'SI',
      });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  SORT + AGGREGATE
  // ════════════════════════════════════════════════════════════════
  entries.sort((a, b) => {
    const [da, ma, ya] = a.datum.split('.');
    const [db, mb, yb] = b.datum.split('.');
    return `${ya}${ma}${da}`.localeCompare(`${yb}${mb}${db}`);
  });

  const typeMap = new Map<string, VerstossType>();
  for (const e of entries) {
    const key = e.rechtsgrundlage;
    if (!typeMap.has(key)) {
      typeMap.set(key, {
        beschreibung: e.beschreibung.split('.')[0].split(';')[0],
        msi: 0, vsi: 0, si: 0, mi: 0,
        anzahl: 0, bussgeldFahrer: 0, bussgeldUnternehmen: 0,
      });
    }
    const t = typeMap.get(key)!;
    t.anzahl += 1;
    t.bussgeldFahrer += e.bussgeldFahrer;
    t.bussgeldUnternehmen += e.bussgeldUnternehmen;
    if (e.kategorie === 'MSI') t.msi += 1;
    else if (e.kategorie === 'VSI') t.vsi += 1;
    else if (e.kategorie === 'SI') t.si += 1;
    else if (e.kategorie === 'MI') t.mi += 1;
  }

  const period = shifts.length > 0
    ? `${fmtDatum(shifts[0].shift_date)} - ${fmtDatum(shifts[shifts.length - 1].shift_date)}`
    : '';

  return { entries, types: Array.from(typeMap.values()), period };
}

/**
 * Generate Verstöße PDF matching the official transitet.eu format:
 * - Summary table with violation categories + fines
 * - Detailed violation list with legal references
 * - Legal disclaimer paragraphs
 * - Signature area (Bemerkung)
 */
export type VerstosseLang = 'de' | 'pl' | 'en' | 'el';

// ── Violation description translations ──
// Each violation gets a function that takes dynamic params and returns a translated string.
const violationTexts: Record<VerstosseLang, {
  manualEntry: () => string;
  vehicleCheck: (shortfall: string) => string;
  dailyDriving: (limit: string, excess: string) => string;
  breakAfterDriving: (breakMin: number, shortfall: number) => string;
  continuousDriving: (accDriving: string, shortfall: number) => string;
  breakAfter6h: (breakMin: number, shortfall: number) => string;
  breakAfter9h: (breakMin: number) => string;
  dailyWorkExceeded: (excess: string) => string;
  nightWork: (workTime: string) => string;
  dailyRestBelow9h: (restTime: string, shortfall: string) => string;
  reducedRestOver3x: (restTime: string, shortfall: string) => string;
  reducedRestAllowed: (restTime: string, count: number) => string;
  weeklyDriving: (total: string, excess: string) => string;
  extendedDrivingOver2x: (count: number) => string;
  biWeeklyDriving: (total: string, excess: string) => string;
  reducedWeeklyRest: (restTime: string) => string;
  insufficientWeeklyRest: (restTime: string) => string;
  noWeeklyRest: (days: number) => string;
  twoConsecutiveReducedWeeklyRest: () => string;
  weeklyRestCompensationMissing: (compensationTime: string, deadline: string) => string;
  weeklyWorkExceeded: (total: string, excess: string) => string;
  calendarWeek: (days: number) => string;
  calendarWeekShort: () => string;
  biWeek: () => string;
}> = {
  de: {
    manualEntry: () => 'Landeingabe zu Schichtbeginn fehlt oder zu sp\u00e4t erfolgt',
    vehicleCheck: (s) => `\u00dcberpr\u00fcfung des Fahrzeugs vor Abfahrt nicht als Arbeitszeit dokumentiert.${s ? ` Unterschreitung von ${s}` : ''}`,
    dailyDriving: (limit, excess) => `T\u00e4gliche Lenkzeit von ${limit} Stunden \u00fcberschritten. \u00dcberschreitung von ${excess}`,
    breakAfterDriving: (bm, sf) => `Fahrtunterbrechung von mind. 45 Min. nach 4,5h Lenkzeit nicht eingehalten. Pause nur ${bm} Min. Unterschreitung um ${sf} Min.`,
    continuousDriving: (acc, sf) => `Ununterbrochene Lenkzeit von ${acc} ohne ausreichende Pause. Fehlende Pausenzeit: ${sf} Min. (mind. 45 Min. oder 15+30 Min. Aufteilung erforderlich)`,
    breakAfter6h: (bm, sf) => `Arbeitszeit von 6 Std. ohne Ruhepause von mind. 30 Min. Pause nur ${bm} Min., Unterschreitung um ${sf} Min.`,
    breakAfter9h: (bm) => `Arbeitszeit \u00fcber 9 Std. ohne Ruhepause von mind. 45 Min. Pause nur ${bm} Min.`,
    dailyWorkExceeded: (excess) => `T\u00e4gliche Arbeitszeit von 10 Stunden \u00fcberschritten. \u00dcberschreitung von ${excess}`,
    nightWork: (wt) => `T\u00e4gliche Arbeitszeit bei Nachtarbeit von 10 Stunden \u00fcberschritten. Arbeitszeit ${wt}`,
    dailyRestBelow9h: (rt, sf) => `T\u00e4gliche Ruhezeit unterschritten. Ruhezeit nur ${rt} (Minimum 11h, reduziert 9h). Unterschreitung um ${sf}`,
    reducedRestOver3x: (rt, sf) => `Verk\u00fcrzte t\u00e4gliche Ruhezeit (${rt}) \u2014 mehr als 3x zwischen w\u00f6chentlichen Ruhezeiten. Unterschreitung um ${sf}`,
    reducedRestAllowed: (rt, n) => `Verk\u00fcrzte t\u00e4gliche Ruhezeit (${rt} statt 11h). Reduzierung Nr. ${n}/3 erlaubt`,
    weeklyDriving: (t, e) => `W\u00f6chentliche Lenkzeit von 56 Stunden \u00fcberschritten. Lenkzeit ${t}, \u00dcberschreitung ${e}`,
    extendedDrivingOver2x: (n) => `Verl\u00e4ngerung der t\u00e4glichen Lenkzeit auf 10h mehr als 2x in der Woche (${n}x statt max. 2x)`,
    biWeeklyDriving: (t, e) => `Lenkzeit in der Doppelwoche von 90 Stunden \u00fcberschritten. Lenkzeit ${t}, \u00dcberschreitung ${e}`,
    reducedWeeklyRest: (rt) => `Verk\u00fcrzte w\u00f6chentliche Ruhezeit (${rt} statt 45h). Ausgleich innerhalb von 3 Wochen erforderlich`,
    insufficientWeeklyRest: (rt) => `W\u00f6chentliche Ruhezeit unter 24h. Nur ${rt} — Mindestens 24h erforderlich`,
    noWeeklyRest: (d) => `Keine w\u00f6chentliche Ruhezeit innerhalb von 6 x 24h. Letzte w\u00f6chentliche Ruhezeit vor ${d} Tagen`,
    twoConsecutiveReducedWeeklyRest: () => 'Zwei aufeinanderfolgende Wochen ohne regul\u00e4re w\u00f6chentliche Ruhezeit (45h). In jeder Doppelwoche muss mind. eine regul\u00e4re Ruhezeit genommen werden',
    weeklyRestCompensationMissing: (ct, dl) => `Ausgleich f\u00fcr verk\u00fcrzte w\u00f6chentliche Ruhezeit nicht innerhalb von 3 Wochen nachgeholt. Fehlender Ausgleich: ${ct}. Frist: ${dl}`,
    weeklyWorkExceeded: (t, e) => `W\u00f6chentliche Arbeitszeit von 60 Stunden \u00fcberschritten. Arbeitszeit ${t}, \u00dcberschreitung ${e}`,
    calendarWeek: (d) => `KW (${d} Tage)`,
    calendarWeekShort: () => 'KW',
    biWeek: () => 'Doppelwoche',
  },
  pl: {
    manualEntry: () => 'Brak wpisu kraju na pocz\u0105tku zmiany lub wpis op\u00f3\u017aniony',
    vehicleCheck: (s) => `Kontrola pojazdu przed wyjazdem nie udokumentowana jako czas pracy.${s ? ` Brakuje ${s}` : ''}`,
    dailyDriving: (limit, excess) => `Przekroczenie dziennego czasu prowadzenia ${limit} godzin. Przekroczenie o ${excess}`,
    breakAfterDriving: (bm, sf) => `Przerwa min. 45 min. po 4,5h jazdy nie zosta\u0142a zachowana. Przerwa tylko ${bm} min. Brakuje ${sf} min.`,
    continuousDriving: (acc, sf) => `Nieprzerwany czas prowadzenia ${acc} bez wystarczaj\u0105cej przerwy. Brakuj\u0105cy czas przerwy: ${sf} min. (wymagane min. 45 min. lub podzia\u0142 15+30 min.)`,
    breakAfter6h: (bm, sf) => `Czas pracy 6 godz. bez przerwy min. 30 min. Przerwa tylko ${bm} min., brakuje ${sf} min.`,
    breakAfter9h: (bm) => `Czas pracy ponad 9 godz. bez przerwy min. 45 min. Przerwa tylko ${bm} min.`,
    dailyWorkExceeded: (excess) => `Przekroczenie dziennego czasu pracy 10 godzin. Przekroczenie o ${excess}`,
    nightWork: (wt) => `Przekroczenie dziennego czasu pracy przy pracy nocnej 10 godzin. Czas pracy ${wt}`,
    dailyRestBelow9h: (rt, sf) => `Dzienny czas odpoczynku zbyt kr\u00f3tki. Odpoczynek tylko ${rt} (minimum 11h, skr\u00f3cony 9h). Brakuje ${sf}`,
    reducedRestOver3x: (rt, sf) => `Skr\u00f3cony dzienny odpoczynek (${rt}) \u2014 ponad 3x mi\u0119dzy tygodniowymi odpoczynkami. Brakuje ${sf}`,
    reducedRestAllowed: (rt, n) => `Skr\u00f3cony dzienny odpoczynek (${rt} zamiast 11h). Skr\u00f3cenie nr ${n}/3 dozwolone`,
    weeklyDriving: (t, e) => `Przekroczenie tygodniowego czasu prowadzenia 56 godzin. Czas prowadzenia ${t}, przekroczenie ${e}`,
    extendedDrivingOver2x: (n) => `Wyd\u0142u\u017cenie dziennego czasu prowadzenia do 10h ponad 2x w tygodniu (${n}x zamiast max. 2x)`,
    biWeeklyDriving: (t, e) => `Przekroczenie czasu prowadzenia w podw\u00f3jnym tygodniu 90 godzin. Czas prowadzenia ${t}, przekroczenie ${e}`,
    reducedWeeklyRest: (rt) => `Skr\u00f3cony tygodniowy odpoczynek (${rt} zamiast 45h). Wyr\u00f3wnanie w ci\u0105gu 3 tygodni wymagane`,
    insufficientWeeklyRest: (rt) => `Tygodniowy odpoczynek poni\u017cej 24h. Tylko ${rt} \u2014 wymagane minimum 24h`,
    noWeeklyRest: (d) => `Brak tygodniowego odpoczynku w ci\u0105gu 6 x 24h. Ostatni tygodniowy odpoczynek ${d} dni temu`,
    twoConsecutiveReducedWeeklyRest: () => 'Dwa kolejne tygodnie bez regularnego tygodniowego odpoczynku (45h). W ka\u017cdym podw\u00f3jnym tygodniu wymagany jest min. jeden regularny odpoczynek',
    weeklyRestCompensationMissing: (ct, dl) => `Wyr\u00f3wnanie za skr\u00f3cony tygodniowy odpoczynek nie zosta\u0142o odebrane w ci\u0105gu 3 tygodni. Brakuj\u0105ce wyr\u00f3wnanie: ${ct}. Termin: ${dl}`,
    weeklyWorkExceeded: (t, e) => `Przekroczenie tygodniowego czasu pracy 60 godzin. Czas pracy ${t}, przekroczenie ${e}`,
    calendarWeek: (d) => `Tydz. (${d} dni)`,
    calendarWeekShort: () => 'Tydz.',
    biWeek: () => 'Podw. tydz.',
  },
  en: {
    manualEntry: () => 'Country entry at shift start missing or delayed',
    vehicleCheck: (s) => `Vehicle check before departure not documented as working time.${s ? ` Shortfall of ${s}` : ''}`,
    dailyDriving: (limit, excess) => `Daily driving time of ${limit} hours exceeded. Excess of ${excess}`,
    breakAfterDriving: (bm, sf) => `Break of min. 45 min. after 4.5h driving not observed. Break only ${bm} min. Shortfall ${sf} min.`,
    continuousDriving: (acc, sf) => `Continuous driving of ${acc} without sufficient break. Missing break time: ${sf} min. (min. 45 min. or 15+30 min. split required)`,
    breakAfter6h: (bm, sf) => `Working time of 6h without rest break of min. 30 min. Break only ${bm} min., shortfall ${sf} min.`,
    breakAfter9h: (bm) => `Working time over 9h without rest break of min. 45 min. Break only ${bm} min.`,
    dailyWorkExceeded: (excess) => `Daily working time of 10 hours exceeded. Excess of ${excess}`,
    nightWork: (wt) => `Daily working time for night work of 10 hours exceeded. Working time ${wt}`,
    dailyRestBelow9h: (rt, sf) => `Daily rest period insufficient. Rest only ${rt} (minimum 11h, reduced 9h). Shortfall of ${sf}`,
    reducedRestOver3x: (rt, sf) => `Reduced daily rest (${rt}) \u2014 more than 3x between weekly rests. Shortfall of ${sf}`,
    reducedRestAllowed: (rt, n) => `Reduced daily rest (${rt} instead of 11h). Reduction no. ${n}/3 permitted`,
    weeklyDriving: (t, e) => `Weekly driving time of 56 hours exceeded. Driving time ${t}, excess ${e}`,
    extendedDrivingOver2x: (n) => `Extension of daily driving time to 10h more than 2x per week (${n}x instead of max. 2x)`,
    biWeeklyDriving: (t, e) => `Bi-weekly driving time of 90 hours exceeded. Driving time ${t}, excess ${e}`,
    reducedWeeklyRest: (rt) => `Reduced weekly rest (${rt} instead of 45h). Compensation within 3 weeks required`,
    insufficientWeeklyRest: (rt) => `Weekly rest below 24h. Only ${rt} \u2014 minimum 24h required`,
    noWeeklyRest: (d) => `No weekly rest within 6 x 24h. Last weekly rest ${d} days ago`,
    twoConsecutiveReducedWeeklyRest: () => 'Two consecutive weeks without regular weekly rest (45h). At least one regular weekly rest required in every two consecutive weeks',
    weeklyRestCompensationMissing: (ct, dl) => `Compensation for reduced weekly rest not taken within 3 weeks. Missing compensation: ${ct}. Deadline: ${dl}`,
    weeklyWorkExceeded: (t, e) => `Weekly working time of 60 hours exceeded. Working time ${t}, excess ${e}`,
    calendarWeek: (d) => `CW (${d} days)`,
    calendarWeekShort: () => 'CW',
    biWeek: () => 'Bi-week',
  },
  el: {
    manualEntry: () => '\u039b\u03b5\u03af\u03c0\u03b5\u03b9 \u03b7 \u03ba\u03b1\u03c4\u03b1\u03c7\u03ce\u03c1\u03b7\u03c3\u03b7 \u03c7\u03ce\u03c1\u03b1\u03c2 \u03c3\u03c4\u03b7\u03bd \u03ad\u03bd\u03b1\u03c1\u03be\u03b7 \u03b2\u03ac\u03c1\u03b4\u03b9\u03b1\u03c2 \u03ae \u03b5\u03af\u03bd\u03b1\u03b9 \u03ba\u03b1\u03b8\u03c5\u03c3\u03c4\u03b5\u03c1\u03b7\u03bc\u03ad\u03bd\u03b7',
    vehicleCheck: (s) => `\u0388\u03bb\u03b5\u03b3\u03c7\u03bf\u03c2 \u03bf\u03c7\u03ae\u03bc\u03b1\u03c4\u03bf\u03c2 \u03c0\u03c1\u03b9\u03bd \u03c4\u03b7\u03bd \u03b1\u03bd\u03b1\u03c7\u03ce\u03c1\u03b7\u03c3\u03b7 \u03b4\u03b5\u03bd \u03ba\u03b1\u03c4\u03b1\u03b3\u03c1\u03ac\u03c6\u03b7\u03ba\u03b5 \u03c9\u03c2 \u03c7\u03c1\u03cc\u03bd\u03bf\u03c2 \u03b5\u03c1\u03b3\u03b1\u03c3\u03af\u03b1\u03c2.${s ? ` \u0388\u03bb\u03bb\u03b5\u03b9\u03c8\u03b7 ${s}` : ''}`,
    dailyDriving: (limit, excess) => `\u03a5\u03c0\u03ad\u03c1\u03b2\u03b1\u03c3\u03b7 \u03b7\u03bc\u03b5\u03c1\u03ae\u03c3\u03b9\u03bf\u03c5 \u03c7\u03c1\u03cc\u03bd\u03bf\u03c5 \u03bf\u03b4\u03ae\u03b3\u03b7\u03c3\u03b7\u03c2 ${limit} \u03c9\u03c1\u03ce\u03bd. \u03a5\u03c0\u03ad\u03c1\u03b2\u03b1\u03c3\u03b7 \u03ba\u03b1\u03c4\u03ac ${excess}`,
    breakAfterDriving: (bm, sf) => `\u0394\u03b9\u03ac\u03bb\u03b5\u03b9\u03bc\u03bc\u03b1 \u03c4\u03bf\u03c5\u03bb. 45 \u03bb\u03b5\u03c0. \u03bc\u03b5\u03c4\u03ac \u03b1\u03c0\u03cc 4,5\u03c9 \u03bf\u03b4\u03ae\u03b3\u03b7\u03c3\u03b7\u03c2 \u03b4\u03b5\u03bd \u03c4\u03b7\u03c1\u03ae\u03b8\u03b7\u03ba\u03b5. \u0394\u03b9\u03ac\u03bb\u03b5\u03b9\u03bc\u03bc\u03b1 \u03bc\u03cc\u03bd\u03bf ${bm} \u03bb\u03b5\u03c0. \u0388\u03bb\u03bb\u03b5\u03b9\u03c8\u03b7 ${sf} \u03bb\u03b5\u03c0.`,
    continuousDriving: (acc, sf) => `\u0391\u03b4\u03b9\u03ac\u03ba\u03bf\u03c0\u03b7 \u03bf\u03b4\u03ae\u03b3\u03b7\u03c3\u03b7 ${acc} \u03c7\u03c9\u03c1\u03af\u03c2 \u03b5\u03c0\u03b1\u03c1\u03ba\u03ad\u03c2 \u03b4\u03b9\u03ac\u03bb\u03b5\u03b9\u03bc\u03bc\u03b1. \u0388\u03bb\u03bb\u03b5\u03b9\u03c8\u03b7: ${sf} \u03bb\u03b5\u03c0. (\u03b5\u03bb\u03ac\u03c7. 45 \u03bb\u03b5\u03c0. \u03ae 15+30 \u03bb\u03b5\u03c0.)`,
    breakAfter6h: (bm, sf) => `\u03a7\u03c1\u03cc\u03bd\u03bf\u03c2 \u03b5\u03c1\u03b3\u03b1\u03c3\u03af\u03b1\u03c2 6 \u03c9\u03c1. \u03c7\u03c9\u03c1\u03af\u03c2 \u03b4\u03b9\u03ac\u03bb\u03b5\u03b9\u03bc\u03bc\u03b1 \u03c4\u03bf\u03c5\u03bb. 30 \u03bb\u03b5\u03c0. \u0394\u03b9\u03ac\u03bb\u03b5\u03b9\u03bc\u03bc\u03b1 \u03bc\u03cc\u03bd\u03bf ${bm} \u03bb\u03b5\u03c0., \u03ad\u03bb\u03bb\u03b5\u03b9\u03c8\u03b7 ${sf} \u03bb\u03b5\u03c0.`,
    breakAfter9h: (bm) => `\u03a7\u03c1\u03cc\u03bd\u03bf\u03c2 \u03b5\u03c1\u03b3\u03b1\u03c3\u03af\u03b1\u03c2 \u03ac\u03bd\u03c9 9 \u03c9\u03c1. \u03c7\u03c9\u03c1\u03af\u03c2 \u03b4\u03b9\u03ac\u03bb\u03b5\u03b9\u03bc\u03bc\u03b1 \u03c4\u03bf\u03c5\u03bb. 45 \u03bb\u03b5\u03c0. \u0394\u03b9\u03ac\u03bb\u03b5\u03b9\u03bc\u03bc\u03b1 \u03bc\u03cc\u03bd\u03bf ${bm} \u03bb\u03b5\u03c0.`,
    dailyWorkExceeded: (excess) => `\u03a5\u03c0\u03ad\u03c1\u03b2\u03b1\u03c3\u03b7 \u03b7\u03bc\u03b5\u03c1\u03ae\u03c3\u03b9\u03bf\u03c5 \u03c7\u03c1\u03cc\u03bd\u03bf\u03c5 \u03b5\u03c1\u03b3\u03b1\u03c3\u03af\u03b1\u03c2 10 \u03c9\u03c1\u03ce\u03bd. \u03a5\u03c0\u03ad\u03c1\u03b2\u03b1\u03c3\u03b7 \u03ba\u03b1\u03c4\u03ac ${excess}`,
    nightWork: (wt) => `\u03a5\u03c0\u03ad\u03c1\u03b2\u03b1\u03c3\u03b7 \u03b7\u03bc\u03b5\u03c1\u03ae\u03c3\u03b9\u03bf\u03c5 \u03c7\u03c1\u03cc\u03bd\u03bf\u03c5 \u03b5\u03c1\u03b3\u03b1\u03c3\u03af\u03b1\u03c2 \u03bd\u03c5\u03c7\u03c4. \u03b5\u03c1\u03b3\u03b1\u03c3\u03af\u03b1\u03c2 10 \u03c9\u03c1\u03ce\u03bd. \u03a7\u03c1\u03cc\u03bd\u03bf\u03c2 \u03b5\u03c1\u03b3. ${wt}`,
    dailyRestBelow9h: (rt, sf) => `\u0391\u03bd\u03b5\u03c0\u03b1\u03c1\u03ba\u03ae\u03c2 \u03b7\u03bc\u03b5\u03c1\u03ae\u03c3\u03b9\u03b1 \u03b1\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7. \u0391\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7 \u03bc\u03cc\u03bd\u03bf ${rt} (\u03b5\u03bb\u03ac\u03c7. 11\u03c9, \u03bc\u03b5\u03b9\u03c9\u03bc. 9\u03c9). \u0388\u03bb\u03bb\u03b5\u03b9\u03c8\u03b7 ${sf}`,
    reducedRestOver3x: (rt, sf) => `\u039c\u03b5\u03b9\u03c9\u03bc\u03ad\u03bd\u03b7 \u03b7\u03bc\u03b5\u03c1\u03ae\u03c3\u03b9\u03b1 \u03b1\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7 (${rt}) \u2014 \u03c0\u03ac\u03bd\u03c9 \u03b1\u03c0\u03cc 3\u03c6 \u03bc\u03b5\u03c4\u03b1\u03be\u03cd \u03b5\u03b2\u03b4. \u03b1\u03bd\u03b1\u03c0\u03b1\u03cd\u03c3\u03b5\u03c9\u03bd. \u0388\u03bb\u03bb\u03b5\u03b9\u03c8\u03b7 ${sf}`,
    reducedRestAllowed: (rt, n) => `\u039c\u03b5\u03b9\u03c9\u03bc\u03ad\u03bd\u03b7 \u03b7\u03bc\u03b5\u03c1\u03ae\u03c3\u03b9\u03b1 \u03b1\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7 (${rt} \u03b1\u03bd\u03c4\u03af 11\u03c9). \u039c\u03b5\u03af\u03c9\u03c3\u03b7 \u03b1\u03c1. ${n}/3 \u03b5\u03c0\u03b9\u03c4\u03c1\u03ad\u03c0\u03b5\u03c4\u03b1\u03b9`,
    weeklyDriving: (t, e) => `\u03a5\u03c0\u03ad\u03c1\u03b2\u03b1\u03c3\u03b7 \u03b5\u03b2\u03b4\u03bf\u03bc\u03b1\u03b4\u03b9\u03b1\u03af\u03bf\u03c5 \u03c7\u03c1\u03cc\u03bd\u03bf\u03c5 \u03bf\u03b4\u03ae\u03b3\u03b7\u03c3\u03b7\u03c2 56 \u03c9\u03c1\u03ce\u03bd. \u03a7\u03c1. \u03bf\u03b4\u03ae\u03b3\u03b7\u03c3\u03b7\u03c2 ${t}, \u03c5\u03c0\u03ad\u03c1\u03b2. ${e}`,
    extendedDrivingOver2x: (n) => `\u03a0\u03b1\u03c1\u03ac\u03c4\u03b1\u03c3\u03b7 \u03b7\u03bc\u03b5\u03c1\u03ae\u03c3\u03b9\u03bf\u03c5 \u03c7\u03c1\u03cc\u03bd\u03bf\u03c5 \u03bf\u03b4\u03ae\u03b3\u03b7\u03c3\u03b7\u03c2 \u03c3\u03b5 10\u03c9 \u03c0\u03ac\u03bd\u03c9 \u03b1\u03c0\u03cc 2\u03c6/\u03b5\u03b2\u03b4. (${n}\u03c6 \u03b1\u03bd\u03c4\u03af \u03bc\u03ad\u03b3. 2\u03c6)`,
    biWeeklyDriving: (t, e) => `\u03a5\u03c0\u03ad\u03c1\u03b2\u03b1\u03c3\u03b7 \u03c7\u03c1\u03cc\u03bd\u03bf\u03c5 \u03bf\u03b4\u03ae\u03b3\u03b7\u03c3\u03b7\u03c2 \u03b4\u03b9\u03c0\u03bb\u03ae\u03c2 \u03b5\u03b2\u03b4\u03bf\u03bc\u03ac\u03b4\u03b1\u03c2 90 \u03c9\u03c1\u03ce\u03bd. \u03a7\u03c1. \u03bf\u03b4\u03ae\u03b3. ${t}, \u03c5\u03c0\u03ad\u03c1\u03b2. ${e}`,
    reducedWeeklyRest: (rt) => `\u039c\u03b5\u03b9\u03c9\u03bc\u03ad\u03bd\u03b7 \u03b5\u03b2\u03b4\u03bf\u03bc\u03b1\u03b4\u03b9\u03b1\u03af\u03b1 \u03b1\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7 (${rt} \u03b1\u03bd\u03c4\u03af 45\u03c9). \u0391\u03bd\u03c4\u03b9\u03c3\u03c4\u03ac\u03b8\u03bc\u03b9\u03c3\u03b7 \u03b5\u03bd\u03c4\u03cc\u03c2 3 \u03b5\u03b2\u03b4.`,
    insufficientWeeklyRest: (rt) => `\u0395\u03b2\u03b4\u03bf\u03bc\u03b1\u03b4\u03b9\u03b1\u03af\u03b1 \u03b1\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7 \u03ba\u03ac\u03c4\u03c9 \u03b1\u03c0\u03cc 24\u03c9. \u039c\u03cc\u03bd\u03bf ${rt} \u2014 \u03b5\u03bb\u03ac\u03c7\u03b9\u03c3\u03c4\u03bf 24\u03c9`,
    noWeeklyRest: (d) => `\u039a\u03b1\u03bc\u03af\u03b1 \u03b5\u03b2\u03b4\u03bf\u03bc\u03b1\u03b4\u03b9\u03b1\u03af\u03b1 \u03b1\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7 \u03b5\u03bd\u03c4\u03cc\u03c2 6 x 24\u03c9. \u03a4\u03b5\u03bb\u03b5\u03c5\u03c4\u03b1\u03af\u03b1 \u03b5\u03b2\u03b4. \u03b1\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7 ${d} \u03b7\u03bc. \u03c0\u03c1\u03b9\u03bd`,
    twoConsecutiveReducedWeeklyRest: () => '\u0394\u03cd\u03bf \u03b4\u03b9\u03b1\u03b4\u03bf\u03c7\u03b9\u03ba\u03ad\u03c2 \u03b5\u03b2\u03b4\u03bf\u03bc\u03ac\u03b4\u03b5\u03c2 \u03c7\u03c9\u03c1\u03af\u03c2 \u03ba\u03b1\u03bd\u03bf\u03bd\u03b9\u03ba\u03ae \u03b5\u03b2\u03b4. \u03b1\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7 (45\u03c9). \u0391\u03c0\u03b1\u03b9\u03c4\u03b5\u03af\u03c4\u03b1\u03b9 \u03c4\u03bf\u03c5\u03bb. \u03bc\u03af\u03b1 \u03ba\u03b1\u03bd\u03bf\u03bd\u03b9\u03ba\u03ae \u03b1\u03bd\u03ac \u03b4\u03cd\u03bf \u03b5\u03b2\u03b4.',
    weeklyRestCompensationMissing: (ct, dl) => `\u0391\u03bd\u03c4\u03b9\u03c3\u03c4\u03ac\u03b8\u03bc\u03b9\u03c3\u03b7 \u03b3\u03b9\u03b1 \u03bc\u03b5\u03b9\u03c9\u03bc\u03ad\u03bd\u03b7 \u03b5\u03b2\u03b4. \u03b1\u03bd\u03ac\u03c0\u03b1\u03c5\u03c3\u03b7 \u03b4\u03b5\u03bd \u03b5\u03bb\u03ae\u03c6\u03b8\u03b7 \u03b5\u03bd\u03c4\u03cc\u03c2 3 \u03b5\u03b2\u03b4. \u0388\u03bb\u03bb\u03b5\u03b9\u03c8\u03b7: ${ct}. \u03a0\u03c1\u03bf\u03b8\u03b5\u03c3\u03bc\u03af\u03b1: ${dl}`,
    weeklyWorkExceeded: (t, e) => `\u03a5\u03c0\u03ad\u03c1\u03b2\u03b1\u03c3\u03b7 \u03b5\u03b2\u03b4\u03bf\u03bc\u03b1\u03b4\u03b9\u03b1\u03af\u03bf\u03c5 \u03c7\u03c1\u03cc\u03bd\u03bf\u03c5 \u03b5\u03c1\u03b3\u03b1\u03c3\u03af\u03b1\u03c2 60 \u03c9\u03c1\u03ce\u03bd. \u03a7\u03c1. \u03b5\u03c1\u03b3. ${t}, \u03c5\u03c0\u03ad\u03c1\u03b2. ${e}`,
    calendarWeek: (d) => `\u0395\u0392\u0394 (${d} \u03b7\u03bc.)`,
    calendarWeekShort: () => '\u0395\u0392\u0394',
    biWeek: () => '\u0394\u03b9\u03c0\u03bb\u03ae \u03b5\u03b2\u03b4.',
  },
};

const verstosseI18n: Record<VerstosseLang, {
  docTitle: string;
  violationDetails: string;
  driver: string;
  cardNr: string;
  selectedPeriod: string;
  createdAt: string;
  summaryHeader: string;
  count: string;
  fineDriver: string;
  fineCompany: string;
  total: string;
  disclaimer1: string;
  disclaimer2: string;
  disclaimer3: string;
  remark: string;
  placeDate: string;
  signDriver: string;
  signResponsible: string;
  pageOf: string;
  detDate: string;
  detTime: string;
  detDescription: string;
  detLegalBasis: string;
  detCategory: string;
}> = {
  de: {
    docTitle: 'Verstöße-Dokument',
    violationDetails: 'Verstöße Details:',
    driver: 'Fahrer',
    cardNr: 'Karten-Nr.',
    selectedPeriod: 'Selektierte Periode',
    createdAt: 'Erstellt am',
    summaryHeader: 'Verstöße nach EU-Recht, der FPersV und dem ArbZG mit Bußgeldhöhe.',
    count: 'Anzahl',
    fineDriver: 'Bußgeld Fahrer',
    fineCompany: 'Bußgeld Unternehmen',
    total: 'Gesamt',
    disclaimer1: 'Der/Die unterzeichnende Fahrer/Fahrerin, bestätigt hiermit, dass er/sie über die hier aufgelisteten Verstöße in Kenntnis gesetzt wurde und dass er/sie belehrt und aufgefordert wurde, zukünftig die gesetzlichen Lenk- und Ruhezeiten sowie die Bestimmungen des Arbeitszeitgesetzes einzuhalten.',
    disclaimer2: 'Wir weisen darauf hin, dass die aufgelisteten Verstöße ohne Eingabe von Toleranzen ermittelt wurden und alle aufgetretenen Verstöße gegen die Lenk- und Ruhezeiten, das Arbeitszeitgesetz und zusätzliche Prüfungen, wie fehlende Abfahrtskontrollen und fehlende Ortseingaben darstellen.',
    disclaimer3: 'Bei Kontrollen ist es daher möglich, dass entweder Toleranzen berücksichtigt werden, oder aber nur einzelne Gesetze zur Überprüfung ausgewählt werden. Daher können die Anzahl der bei externen Kontrollen aufgelisteten Verstöße deutlich von dieser Aufstellung abweichen.',
    remark: 'Bemerkung:',
    placeDate: 'Ort, Datum',
    signDriver: 'Unterschrift Fahrer/Fahrerin',
    signResponsible: 'Unterschrift Verantwortlicher',
    pageOf: 'Seite',
    detDate: 'Datum',
    detTime: 'Zeit',
    detDescription: 'Beschreibung',
    detLegalBasis: 'Rechtliche Grundlagen',
    detCategory: 'Kategorie',
  },
  pl: {
    docTitle: 'Dokument naruszeń',
    violationDetails: 'Szczegóły naruszeń:',
    driver: 'Kierowca',
    cardNr: 'Nr karty',
    selectedPeriod: 'Wybrany okres',
    createdAt: 'Utworzono',
    summaryHeader: 'Naruszenia wg prawa UE, FPersV i ArbZG z wysokością kar.',
    count: 'Ilość',
    fineDriver: 'Kara kierowca',
    fineCompany: 'Kara firma',
    total: 'Razem',
    disclaimer1: 'Niżej podpisany kierowca potwierdza niniejszym, że został poinformowany o wymienionych tutaj naruszeniach oraz że został pouczony i wezwany do przestrzegania w przyszłości ustawowych czasów prowadzenia pojazdu i odpoczynku oraz przepisów ustawy o czasie pracy.',
    disclaimer2: 'Zwracamy uwagę, że wymienione naruszenia zostały ustalone bez uwzględnienia tolerancji i obejmują wszystkie stwierdzone naruszenia dotyczące czasów prowadzenia pojazdu i odpoczynku, ustawy o czasie pracy oraz dodatkowych kontroli, takich jak brakujące kontrole przed wyjazdem i brakujące wpisy miejscowości.',
    disclaimer3: 'Podczas kontroli drogowych możliwe jest, że zostaną uwzględnione tolerancje lub że zostaną sprawdzone tylko wybrane przepisy. Dlatego liczba naruszeń stwierdzonych podczas kontroli zewnętrznych może znacznie odbiegać od niniejszego zestawienia.',
    remark: 'Uwagi:',
    placeDate: 'Miejscowość, data',
    signDriver: 'Podpis kierowcy',
    signResponsible: 'Podpis osoby odpowiedzialnej',
    pageOf: 'Strona',
    detDate: 'Data',
    detTime: 'Czas',
    detDescription: 'Opis',
    detLegalBasis: 'Podstawa prawna',
    detCategory: 'Kategoria',
  },
  en: {
    docTitle: 'Violations Document',
    violationDetails: 'Violation Details:',
    driver: 'Driver',
    cardNr: 'Card No.',
    selectedPeriod: 'Selected period',
    createdAt: 'Created on',
    summaryHeader: 'Violations under EU law, FPersV and ArbZG with fine amounts.',
    count: 'Count',
    fineDriver: 'Fine Driver',
    fineCompany: 'Fine Company',
    total: 'Total',
    disclaimer1: 'The undersigned driver hereby confirms that he/she has been informed about the violations listed herein and that he/she has been instructed and requested to comply with the statutory driving and rest times as well as the provisions of the Working Time Act in the future.',
    disclaimer2: 'We point out that the listed violations were determined without input of tolerances and represent all violations that occurred against driving and rest times, the Working Time Act and additional checks, such as missing departure checks and missing location entries.',
    disclaimer3: 'During inspections, it is possible that tolerances are taken into account or that only individual laws are selected for review. Therefore, the number of violations listed during external inspections may differ significantly from this compilation.',
    remark: 'Remarks:',
    placeDate: 'Place, Date',
    signDriver: 'Driver Signature',
    signResponsible: 'Responsible Person Signature',
    pageOf: 'Page',
    detDate: 'Date',
    detTime: 'Time',
    detDescription: 'Description',
    detLegalBasis: 'Legal Basis',
    detCategory: 'Category',
  },
  el: {
    docTitle: 'Έγγραφο Παραβάσεων',
    violationDetails: 'Λεπτομέρειες Παραβάσεων:',
    driver: 'Οδηγός',
    cardNr: 'Αρ. Κάρτας',
    selectedPeriod: 'Επιλεγμένη περίοδος',
    createdAt: 'Δημιουργήθηκε',
    summaryHeader: 'Παραβάσεις σύμφωνα με το δίκαιο της ΕΕ, FPersV και ArbZG με ύψος προστίμων.',
    count: 'Αριθμός',
    fineDriver: 'Πρόστιμο Οδηγού',
    fineCompany: 'Πρόστιμο Εταιρείας',
    total: 'Σύνολο',
    disclaimer1: 'Ο/Η υπογράφων/ουσα οδηγός επιβεβαιώνει ότι ενημερώθηκε για τις παραβάσεις που αναφέρονται στο παρόν και ότι του/της ζητήθηκε να τηρεί στο μέλλον τους νόμιμους χρόνους οδήγησης και ανάπαυσης καθώς και τις διατάξεις του νόμου περί χρόνου εργασίας.',
    disclaimer2: 'Επισημαίνουμε ότι οι αναφερόμενες παραβάσεις προσδιορίστηκαν χωρίς ανοχές και αντιπροσωπεύουν όλες τις παραβάσεις που σημειώθηκαν σχετικά με τους χρόνους οδήγησης και ανάπαυσης, τον νόμο περί χρόνου εργασίας και πρόσθετους ελέγχους.',
    disclaimer3: 'Κατά τη διάρκεια ελέγχων, είναι πιθανό να ληφθούν υπόψη ανοχές ή να επιλεγούν μόνο μεμονωμένοι νόμοι προς εξέταση. Ως εκ τούτου, ο αριθμός των παραβάσεων κατά τους εξωτερικούς ελέγχους μπορεί να διαφέρει σημαντικά.',
    remark: 'Παρατηρήσεις:',
    placeDate: 'Τόπος, Ημερομηνία',
    signDriver: 'Υπογραφή Οδηγού',
    signResponsible: 'Υπογραφή Υπεύθυνου',
    pageOf: 'Σελίδα',
    detDate: 'Ημερομηνία',
    detTime: 'Ώρα',
    detDescription: 'Περιγραφή',
    detLegalBasis: 'Νομική Βάση',
    detCategory: 'Κατηγορία',
  },
};

export async function generateVerstossePdf(
  driverName: string,
  cardNumber: string,
  shifts: Shift[],
  lang: VerstosseLang = 'de',
  options: VerstosseOptions = {},
) {
  const { entries, types, period } = analyzeVerstoesse(driverName, cardNumber, shifts, lang, options);
  const L = verstosseI18n[lang];

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Load Inter font for beautiful multi-language PDF
  const interFonts = await loadInterFonts();
  const fontFamily = interFonts ? 'Inter' : 'helvetica';
  if (interFonts) {
    registerInterFont(doc, interFonts);
    doc.setFont('Inter', 'normal');
  }
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 7; // narrow margins for full-width layout
  const now = new Date();
  const erstelltAm = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // ── Totals ──
  let totalFahrer = 0, totalUnternehmen = 0;
  for (const e of entries) { totalFahrer += e.bussgeldFahrer; totalUnternehmen += e.bussgeldUnternehmen; }

  // ═══ PAGE HEADER ═══
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(L.docTitle, W - M, 9, { align: 'right' });

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(40, 40, 40);
  doc.text(`${L.driver}: ${driverName}`, W - M, 13.5, { align: 'right' });
  doc.text(`${L.cardNr}: ${cardNumber}`, W - M, 17.5, { align: 'right' });

  // Left-aligned header
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  doc.text(L.violationDetails, M, 9);

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(7);
  doc.text(`${L.selectedPeriod} ${period}`, M, 13.5);
  doc.text(`${L.createdAt} ${erstelltAm}`, M, 17.5);

  let y = 21;

  // ═══ SUMMARY TABLE ═══
  const summHead = [[
    { content: L.summaryHeader, colSpan: 1 },
    'MSI', 'VSI', 'SI', 'MI', L.count,
    L.fineDriver, L.fineCompany,
  ]];

  const summBody = types.map((t) => [
    t.beschreibung,
    String(t.msi), String(t.vsi), String(t.si), String(t.mi), String(t.anzahl),
    fmtEur(t.bussgeldFahrer),
    fmtEur(t.bussgeldUnternehmen),
  ]);

  const totalAnzahl = entries.length;
  const totalMsi = types.reduce((a, t) => a + t.msi, 0);
  const totalVsi = types.reduce((a, t) => a + t.vsi, 0);
  const totalSi = types.reduce((a, t) => a + t.si, 0);
  const totalMi = types.reduce((a, t) => a + t.mi, 0);

  autoTable(doc, {
    startY: y,
    head: summHead,
    body: summBody,
    foot: [[
      { content: L.total, styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      String(totalMsi), String(totalVsi), String(totalSi), String(totalMi), String(totalAnzahl),
      fmtEur(totalFahrer),
      fmtEur(totalUnternehmen),
    ]],
    styles: {
      font: fontFamily,
      fontSize: 5.5,
      cellPadding: { top: 0.7, bottom: 0.7, left: 1.2, right: 1.2 },
      lineWidth: 0.15,
      lineColor: [180, 180, 180],
      textColor: [40, 40, 40],
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: [30, 30, 30],
      fontStyle: 'bold',
      fontSize: 5.5,
    },
    footStyles: {
      fillColor: [245, 245, 245],
      textColor: [30, 30, 30],
      fontStyle: 'bold',
      fontSize: 5.5,
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'center', cellWidth: 12 },
      2: { halign: 'center', cellWidth: 12 },
      3: { halign: 'center', cellWidth: 12 },
      4: { halign: 'center', cellWidth: 12 },
      5: { halign: 'center', cellWidth: 14, fontStyle: 'bold' },
      6: { halign: 'right', cellWidth: 26 },
      7: { halign: 'right', cellWidth: 30 },
    },
    margin: { left: M, right: M },
    tableLineColor: [180, 180, 180],
    tableLineWidth: 0.15,
  });

  y = (doc as any).lastAutoTable.finalY + 3;

  // ═══ DETAIL TABLE ═══
  const detailHead = [[
    L.detDate, L.detTime, L.detDescription, L.detLegalBasis,
    L.fineDriver, L.fineCompany, L.detCategory,
  ]];

  const detailBody: string[][] = [];

  // Totals as first row
  detailBody.push([
    '', '', '', '',
    fmtEur(totalFahrer),
    fmtEur(totalUnternehmen),
    '',
  ]);

  for (const e of entries) {
    detailBody.push([
      e.datum,
      e.zeit,
      e.beschreibung,
      e.rechtsgrundlage,
      fmtEur(e.bussgeldFahrer),
      fmtEur(e.bussgeldUnternehmen),
      e.kategorie,
    ]);
  }

  autoTable(doc, {
    startY: y,
    head: detailHead,
    body: detailBody,
    styles: {
      font: fontFamily,
      fontSize: 5,
      cellPadding: { top: 0.5, bottom: 0.5, left: 1, right: 1 },
      lineWidth: 0.12,
      lineColor: [200, 200, 200],
      textColor: [40, 40, 40],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: [30, 30, 30],
      fontStyle: 'bold',
      fontSize: 5,
      cellPadding: { top: 0.8, bottom: 0.8, left: 1, right: 1 },
    },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 14 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 48 },
      4: { halign: 'right', cellWidth: 22 },
      5: { halign: 'right', cellWidth: 26 },
      6: { halign: 'center', cellWidth: 14 },
    },
    didParseCell: (data: any) => {
      if (data.section !== 'body') return;
      if (data.row.index === 0) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [245, 245, 245];
      }
    },
    margin: { left: M, right: M },
    tableLineColor: [200, 200, 200],
    tableLineWidth: 0.15,
  });

  y = (doc as any).lastAutoTable.finalY + 3;

  // ═══ LEGAL DISCLAIMER TEXT ═══
  const disclaimerTexts = [L.disclaimer1, L.disclaimer2, L.disclaimer3];

  // Check if we need a new page for the disclaimer + signature
  const neededSpace = 40;
  if (y + neededSpace > H - 8) {
    doc.addPage('a4', 'landscape');
    y = 8;
  }

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(5);
  doc.setTextColor(50, 50, 50);

  for (const txt of disclaimerTexts) {
    const lines = doc.splitTextToSize(txt, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 2.2 + 0.8;
  }

  y += 2;

  // ═══ BEMERKUNG + SIGNATURE (3 columns) ═══
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(6);
  doc.setTextColor(30, 30, 30);
  doc.text(L.remark, M, y);
  y += 4;

  // Remark line (full width)
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.2);
  doc.line(M, y, W - M, y);
  y += 7;

  // 3 signature columns
  const colW = (W - 2 * M) / 3;
  const col1 = M;
  const col2 = M + colW;
  const col3 = M + colW * 2;
  const lineLen = colW - 10;

  doc.setLineWidth(0.3);
  doc.line(col1, y, col1 + lineLen, y);
  doc.line(col2 + 5, y, col2 + 5 + lineLen, y);
  doc.line(col3 + 10, y, col3 + 10 + lineLen, y);
  y += 3;
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(100, 100, 100);
  doc.text(L.placeDate, col1, y);
  doc.text(L.signDriver, col2 + 5, y);
  doc.text(L.signResponsible, col3 + 10, y);

  // ═══ FOOTER on all pages ═══
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(5);
    doc.setTextColor(100, 100, 100);
    doc.text('LTS Logistik GmbH \u2014 Tachopru\u0308fung', M, H - 4);
    doc.text(`${L.pageOf} ${i} / ${pages}`, W - M, H - 4, { align: 'right' });
  }

  doc.save(`Verstoesse_${safeName(driverName)}_${new Date().toISOString().slice(0, 10)}.pdf`);
  return { totalEntries: entries.length, totalFahrer, totalUnternehmen };
}

// ═══════════════════════════════════════════════════════════════
//  5) ARBEITSZEITNACHWEIS PDF — Court-ready work time document
//     Single landscape A4, full-width table + compliance text
// ═══════════════════════════════════════════════════════════════

export async function generateArbeitszeitnachweisePdf(
  driverName: string,
  cardNumber: string,
  summary: Summary,
  shifts: Shift[],
) {
  const fonts = await loadInterFonts();
  const c = await ctx('landscape');
  const { doc, W, M, H } = c;

  if (fonts) {
    registerInterFont(doc, fonts);
    doc.setFont('Inter', 'normal');
  }

  const font = fonts ? 'Inter' : 'helvetica';
  const m = 14; // consistent margins

  const periodStr = shifts.length > 0
    ? `${shifts[0].shift_date} – ${shifts[shifts.length - 1].shift_date}`
    : '';

  const allVehicles = [...new Set(shifts.flatMap((s) => s.vehicles))];
  const weekendDays = ['So', 'Sa', 'Nd'];

  let y = drawHeader(c, 'Arbeitszeitnachweis', `${driverName}  ·  Kartennr. ${cardNumber}  ·  ${periodStr}`);

  // ── Driver info block — structured, not crammed ──
  y += 2;
  const col1x = m;
  const col1vx = m + 24;
  const col2x = m + 95;
  const col2vx = m + 119;

  doc.setFontSize(7.5);

  doc.setFont(font, 'bold');
  doc.setTextColor(...C.dark);
  doc.text('Fahrer:', col1x, y);
  doc.setFont(font, 'normal');
  doc.setTextColor(...C.dark);
  doc.text(driverName, col1vx, y);

  doc.setFont(font, 'bold');
  doc.text('Zeitraum:', col2x, y);
  doc.setFont(font, 'normal');
  doc.text(periodStr, col2vx, y);

  y += 4.5;

  doc.setFont(font, 'bold');
  doc.text('Kartennummer:', col1x, y);
  doc.setFont(font, 'normal');
  doc.text(cardNumber, col1vx, y);

  if (allVehicles.length > 0) {
    doc.setFont(font, 'bold');
    doc.text('Fahrzeuge:', col2x, y);
    doc.setFont(font, 'normal');
    doc.text(allVehicles.join(', '), col2vx, y);
  }

  y += 6;

  // ── Thin separator ──
  doc.setDrawColor(210, 218, 228);
  doc.setLineWidth(0.2);
  doc.line(m, y, W - m, y);
  y += 4;

  // ════════════════════════════════════════
  //  SHIFTS TABLE — full width, polished
  // ════════════════════════════════════════

  const tableW = W - 2 * m;
  const shiftHead = [['Tag', 'Datum', 'Beginn', 'Ende', 'Dauer', 'Lenkzeit', 'Arbeit', 'Bereitsch.', 'Pause', 'N25%', 'N40%', 'Spesen']];
  const shiftBody = shifts.map((s) => [
    s.weekday,
    s.shift_date,
    s.shift_start?.split(' ')[1] || s.shift_start,
    s.shift_end?.split(' ')[1] || s.shift_end,
    s.duration_hm,
    s.driving_hm,
    s.work_only_hm,
    s.avail_hm || '—',
    s.break_hm,
    s.night_25_hm || '—',
    s.night_40_hm || '—',
    s.has_diet ? '✓' : '',
  ]);

  // Totals row
  const availMin = summary.total_avail_minutes || 0;
  shiftBody.push([
    '', 'SUMME', '', '',
    hm(shifts.reduce((a, s) => a + s.duration_minutes, 0)),
    summary.total_driving_hm,
    hm(shifts.reduce((a, s) => a + s.work_only_minutes, 0)),
    summary.total_avail_hm || hm(availMin),
    summary.total_break_hm,
    summary.night_25_hm,
    summary.night_40_hm,
    String(summary.diet_count),
  ]);

  // Dynamic font size to fit on one page
  const rowCount = shiftBody.length;
  // Reserve space: footer ~10, compliance ~18, signatures ~16, spacing ~10
  const reserveBelow = 54;
  const availH = H - reserveBelow - y;
  // Row height ≈ fontSize * 0.65 + 2 * padding
  const maxFontForFit = Math.max(5, Math.min(7, (availH / rowCount - 2) / 0.65));
  const tblFont = Math.round(maxFontForFit * 10) / 10;
  const tblPad = tblFont >= 6.5 ? 1.5 : tblFont >= 5.5 ? 1.2 : 1;

  autoTable(doc, {
    startY: y,
    head: shiftHead,
    body: shiftBody,
    theme: 'grid',
    tableWidth: tableW,
    styles: {
      font: font,
      fontSize: tblFont,
      cellPadding: tblPad,
      textColor: C.dark,
      lineColor: [210, 218, 228],
      lineWidth: 0.15,
      overflow: 'ellipsize',
    },
    headStyles: {
      fillColor: C.primary,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: tblFont,
      cellPadding: tblPad + 0.3,
    },
    columnStyles: {
      0:  { cellWidth: 'auto' },
      1:  { cellWidth: 'auto' },
      2:  { cellWidth: 'auto' },
      3:  { cellWidth: 'auto' },
      4:  { halign: 'right' },
      5:  { halign: 'right' },
      6:  { halign: 'right' },
      7:  { halign: 'right' },
      8:  { halign: 'right' },
      9:  { halign: 'right' },
      10: { halign: 'right' },
      11: { halign: 'center' },
    },
    margin: { left: m, right: m },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didParseCell(data) {
      if (data.section === 'body') {
        const isLastRow = data.row.index === shiftBody.length - 1;
        if (isLastRow) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [226, 232, 240];
          data.cell.styles.textColor = C.dark;
        } else {
          const wd = String(shiftBody[data.row.index][0]);
          if (weekendDays.includes(wd)) {
            data.cell.styles.fillColor = C.weekendBg;
          }
        }
        if (data.column.index === 9 && String(data.cell.raw) !== '—' && !isLastRow) {
          data.cell.styles.textColor = [79, 70, 229];
        }
        if (data.column.index === 10 && String(data.cell.raw) !== '—' && !isLastRow) {
          data.cell.styles.textColor = C.purple;
        }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY;

  // ════════════════════════════════════════
  //  COMPLIANCE TEXT — with breathing room
  // ════════════════════════════════════════

  y += 8;

  // Subtle separator
  doc.setDrawColor(210, 218, 228);
  doc.setLineWidth(0.2);
  doc.line(m, y, W - m, y);
  y += 5;

  doc.setFont(font, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.dark);
  doc.text('Ergebnis der Auswertung', m, y);
  y += 5;

  doc.setFont(font, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(60, 65, 75);
  const complianceText =
    'Die Auswertung der digitalen Fahrerkarte hat ergeben, dass im oben genannten Zeitraum keine Verstöße gegen die Vorschriften ' +
    'der VO (EG) Nr. 561/2006 (Lenk- und Ruhezeiten), des ArbZG §§ 3, 4 (Arbeitszeit, Pausen), der Richtlinie 2002/15/EG ' +
    '(Nachtarbeit) sowie der VO (EU) Nr. 165/2014 (Fahrtenschreiber) und der FPersV (Fahrpersonalverordnung) festgestellt wurden.';
  const textMaxW = W - 2 * m;
  const lines = doc.splitTextToSize(complianceText, textMaxW);
  doc.text(lines, m, y);
  y += lines.length * 3.8;

  y += 6;

  // ════════════════════════════════════════
  //  SIGNATURES — with proper spacing
  // ════════════════════════════════════════

  const sigW = (W - 2 * m - 40) / 3;
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.3);
  doc.line(m, y, m + sigW, y);
  doc.line(m + sigW + 20, y, m + 2 * sigW + 20, y);
  doc.line(m + 2 * (sigW + 20), y, m + 3 * sigW + 40, y);

  doc.setFont(font, 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.gray);
  doc.text('Ort, Datum', m, y + 4);
  doc.text('Unterschrift Verantwortlicher', m + sigW + 20, y + 4);
  doc.text('Unterschrift Fahrer', m + 2 * (sigW + 20), y + 4);

  // ── Footer ──
  drawFooter(c);

  doc.save(`Arbeitszeitnachweis_${safeName(driverName)}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
//  FLEET: vehicle mileage (Kilometerstand / Kilometerleistung)
//  + vehicle activity — branded PDF exports
// ═══════════════════════════════════════════════════════════════

function fmtKmPdf(n: number | null | undefined): string {
  if (n == null) return '–';
  return Math.round(n).toLocaleString('de-DE');
}

function fmtTsPdf(ts: string | null | undefined): string {
  if (!ts) return '–';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function ddmmyyyy(s: string): string {
  if (!s) return '–';
  const [y, m, d] = s.split('-');
  return d && m && y ? `${d}.${m}.${y}` : s;
}

function weekdayShort(date: string): string {
  const d = new Date(date + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()];
}

// ── Minimalist / premium styling, dedicated to the fleet exports only
//    (intentionally NOT the colored shared header/cards used elsewhere). ──

const F = {
  ink: [17, 24, 39] as [number, number, number],
  mut: [107, 114, 128] as [number, number, number],
  line: [229, 231, 235] as [number, number, number],
  red: [220, 38, 38] as [number, number, number],
};

function fleetHeader(c: Ctx, title: string, subtitle?: string): number {
  const { doc, W, M, logo } = c;
  const top = 15;
  let x = M;
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', M, top - 3, 22, 9.5);
      x = M + 26;
    } catch {
      /* skip */
    }
  }
  // tiny red brand mark + company name (the only colour on the page)
  doc.setFillColor(...F.red);
  doc.rect(x, top - 2.4, 1.6, 1.6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...F.mut);
  doc.text('LTS LOGISTIK GMBH', x + 3, top - 1);
  // date, right
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...F.mut);
  doc.text(fmtNow(), W - M, top - 1, { align: 'right' });
  // title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...F.ink);
  doc.text(title, M, top + 9);
  let yy = top + 9;
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...F.mut);
    doc.text(subtitle, M, top + 15);
    yy = top + 15;
  }
  const ry = yy + 4.5;
  doc.setDrawColor(...F.ink);
  doc.setLineWidth(0.3);
  doc.line(M, ry, W - M, ry);
  return ry + 7;
}

function fleetFooter(c: Ctx) {
  const { doc, W, H, M } = c;
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...F.line);
    doc.setLineWidth(0.2);
    doc.line(M, H - 9, W - M, H - 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...F.mut);
    doc.text('LTS Logistik GmbH', M, H - 5.5);
    doc.text(`${i} / ${pages}`, W - M, H - 5.5, { align: 'right' });
  }
}

function fleetMetrics(c: Ctx, y: number, items: { label: string; value: string }[]): number {
  const { doc, W, M } = c;
  const n = items.length;
  const gap = 8;
  const cw = (W - 2 * M - gap * (n - 1)) / n;
  items.forEach((it, i) => {
    const x = M + i * (cw + gap);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(...F.ink);
    doc.text(it.value, x, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...F.mut);
    doc.text(it.label.toUpperCase(), x, y + 11);
    if (i < n - 1) {
      doc.setDrawColor(...F.line);
      doc.setLineWidth(0.2);
      doc.line(x + cw + gap / 2, y - 1, x + cw + gap / 2, y + 10.5);
    }
  });
  return y + 17;
}

function fleetSection(c: Ctx, y: number, label: string): number {
  const { doc, M } = c;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...F.ink);
  doc.text(label, M, y);
  return y + 3;
}

// Horizontal-rule-only table (no fills, no vertical lines) for a clean look.
function fleetTable(
  c: Ctx,
  startY: number,
  head: string[][],
  body: (string | number)[][],
  foot: (string | number)[][] | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columnStyles: any,
): number {
  const { doc, M } = c;
  autoTable(doc, {
    startY,
    head,
    body,
    foot,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 2.6, bottom: 2.6, left: 2, right: 2 }, textColor: F.ink },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: F.mut, cellPadding: { top: 1, bottom: 3, left: 2, right: 2 } },
    footStyles: { fontStyle: 'bold', fontSize: 8.5, textColor: F.ink, cellPadding: { top: 3, bottom: 1, left: 2, right: 2 } },
    columnStyles,
    margin: { left: M, right: M },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didDrawCell: (d: any) => {
      const { cell, section } = d;
      if (section === 'head') {
        doc.setDrawColor(...F.ink);
        doc.setLineWidth(0.4);
        doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
      } else if (section === 'body') {
        doc.setDrawColor(...F.line);
        doc.setLineWidth(0.1);
        doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
      } else if (section === 'foot') {
        doc.setDrawColor(...F.ink);
        doc.setLineWidth(0.3);
        doc.line(cell.x, cell.y, cell.x + cell.width, cell.y);
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable.finalY;
}

// ── 1) Current odometer readings ──

export interface OdoCurrentRow {
  vehicle_name: string;
  license_plate: string | null;
  odometer_km: number | null;
  updated_at: string | null;
}

export async function generateOdometerCurrentPdf(rows: OdoCurrentRow[]) {
  const c = await ctx('portrait');
  const { doc } = c;
  const y = fleetHeader(c, 'Kilometerstand', `Aktuelle Stände · ${rows.length} Fahrzeuge`);

  fleetTable(
    c,
    y,
    [['Fahrzeug', 'Kennzeichen', 'Kilometerstand', 'Aktualisiert']],
    rows.map((r) => [r.vehicle_name, r.license_plate || '–', `${fmtKmPdf(r.odometer_km)} km`, fmtTsPdf(r.updated_at)]),
    undefined,
    {
      0: { fontStyle: 'bold' },
      2: { halign: 'right', fontStyle: 'bold' },
      3: { halign: 'right', textColor: F.mut, fontSize: 7.5 },
    },
  );

  fleetFooter(c);
  doc.save(`Kilometerstand_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── 2) Mileage over a date range (per vehicle) ──

export interface OdoRangeDay {
  date: string;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
  driven_km: number | null;
  readings_count: number;
}
export interface OdoRangeVehicle {
  vehicle_name: string;
  license_plate: string | null;
  days: OdoRangeDay[];
}

export async function generateOdometerRangePdf(
  vehicles: OdoRangeVehicle[],
  dateFrom: string,
  dateTo: string,
) {
  const c = await ctx('portrait');
  const { doc, H, M } = c;
  let y = fleetHeader(c, 'Kilometerleistung', `${ddmmyyyy(dateFrom)} – ${ddmmyyyy(dateTo)}`);

  const grand = vehicles.reduce((s, v) => s + v.days.reduce((a, d) => a + (d.driven_km || 0), 0), 0);
  y = fleetMetrics(c, y, [
    { label: 'Fahrzeuge', value: String(vehicles.length) },
    { label: 'Gesamt-Kilometer', value: `${fmtKmPdf(grand)} km` },
  ]);
  y += 3;

  for (const v of vehicles) {
    const total = v.days.reduce((a, d) => a + (d.driven_km || 0), 0);
    if (y > H - 40) {
      doc.addPage();
      y = M + 4;
    }
    y = fleetSection(c, y, `${v.vehicle_name}${v.license_plate ? `   ${v.license_plate}` : ''}`);
    y = fleetTable(
      c,
      y,
      [['Datum', 'Start km', 'Ende km', 'Gefahren', 'Messungen']],
      v.days.map((d) => [
        `${weekdayShort(d.date)} ${ddmmyyyy(d.date)}`,
        fmtKmPdf(d.odometer_start_km),
        fmtKmPdf(d.odometer_end_km),
        d.driven_km != null ? `${fmtKmPdf(d.driven_km)} km` : '–',
        String(d.readings_count),
      ]),
      [['Summe', '', '', `${fmtKmPdf(total)} km`, '']],
      {
        1: { halign: 'right', textColor: F.mut },
        2: { halign: 'right', textColor: F.mut },
        3: { halign: 'right', fontStyle: 'bold' },
        4: { halign: 'center', textColor: F.mut, fontSize: 7.5 },
      },
    ) + 9;
  }

  fleetFooter(c);
  doc.save(`Kilometerleistung_${dateFrom}_${dateTo}.pdf`);
}

// ── 3) Vehicle activity (saved reports) ──

export interface VehiclesPdfDay {
  date: string;
  begin_driving: string;
  last_driving: string;
  duration_hm: string;
  distance_km: number;
  last_location?: string;
}
export interface VehiclesPdfGroup {
  name: string;
  plate: string;
  tour?: string;
  period?: string;
  days: VehiclesPdfDay[];
  totalKm: number;
  totalMinutes: number;
}

export async function generateVehiclesActivityPdf(groups: VehiclesPdfGroup[], periodStr: string) {
  const c = await ctx('landscape');
  const { doc, H, M } = c;
  let y = fleetHeader(c, 'Fahrzeug-Aktivität', periodStr);

  const totalKm = groups.reduce((s, g) => s + (g.totalKm || 0), 0);
  const totalMin = groups.reduce((s, g) => s + (g.totalMinutes || 0), 0);
  y = fleetMetrics(c, y, [
    { label: 'Fahrzeuge', value: String(groups.length) },
    { label: 'Gesamt-Kilometer', value: `${fmtKmPdf(totalKm)} km` },
    { label: 'Gesamt-Fahrzeit', value: hm(totalMin) },
  ]);
  y += 3;

  for (const g of groups) {
    if (y > H - 40) {
      doc.addPage();
      y = M + 4;
    }
    const label = [g.name, g.plate, g.tour, g.period].filter(Boolean).join('   ');
    y = fleetSection(c, y, label);
    y = fleetTable(
      c,
      y,
      [['Datum', 'Tag', 'Letzte Position', 'Strecke', 'Beginn Fahrt', 'Letzte Fahrt', 'Dauer']],
      g.days.map((d) => [
        ddmmyyyy(d.date),
        weekdayShort(d.date),
        (d.last_location || '–').slice(0, 60),
        `${fmtKmPdf(d.distance_km)} km`,
        d.begin_driving || '–',
        d.last_driving || '–',
        d.duration_hm || '–',
      ]),
      [['Summe', '', '', `${fmtKmPdf(g.totalKm)} km`, '', '', hm(g.totalMinutes)]],
      {
        0: { fontStyle: 'bold', cellWidth: 24 },
        1: { halign: 'center', cellWidth: 14 },
        3: { halign: 'right', fontStyle: 'bold', cellWidth: 26 },
        4: { halign: 'center', cellWidth: 28 },
        5: { halign: 'center', cellWidth: 28 },
        6: { halign: 'center', fontStyle: 'bold', cellWidth: 22 },
      },
    ) + 9;
  }

  fleetFooter(c);
  doc.save(`Fahrzeug-Aktivitaet_${safeName(periodStr)}.pdf`);
}

// ── 3b) KM averages (daily / weekly / monthly) — minimal one-page sheet ──

const kmDec = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export async function generateVehicleAveragesPdf(
  vehicles: VehicleAvgInput[],
  opts: { subtitle?: string; filename?: string } = {},
) {
  const aggs = computeVehicleAverages(vehicles);
  const multi = aggs.length > 1;
  const c = await ctx(multi ? 'landscape' : 'portrait');
  const { doc } = c;

  const sub = opts.subtitle
    || (aggs.length === 1
      ? [aggs[0].vehicle, aggs[0].plate].filter(Boolean).join('   ·   ')
      : `${aggs.length} Fahrzeuge`);
  let y = fleetHeader(c, 'Kilometer – Durchschnitte', sub);

  // Fleet-level averages = total ÷ count at each granularity.
  const gKm = aggs.reduce((s, a) => s + a.totalKm, 0);
  const gDays = aggs.reduce((s, a) => s + a.activeDays, 0);
  const gWeeks = aggs.reduce((s, a) => s + a.weeks, 0);
  const gMonths = aggs.reduce((s, a) => s + a.months, 0);
  const fAvgDay = gKm / (gDays || 1);
  const fAvgWeek = gKm / (gWeeks || 1);
  const fAvgMonth = gKm / (gMonths || 1);

  y = fleetMetrics(c, y, [
    { label: 'Ø km / Tag', value: kmDec(fAvgDay) },
    { label: 'Ø km / Woche', value: kmDec(fAvgWeek) },
    { label: 'Ø km / Monat', value: kmDec(fAvgMonth) },
  ]) + 3;

  if (multi) {
    fleetTable(
      c,
      y,
      [['Fahrzeug', 'Tage', 'Wochen', 'Monate', 'Ø km/Tag', 'Ø km/Woche', 'Ø km/Monat', 'Gesamt km']],
      aggs.map((a) => [
        a.vehicle, a.activeDays, a.weeks, a.months,
        kmDec(a.avgKmDay), kmDec(a.avgKmWeek), kmDec(a.avgKmMonth), kmDec(a.totalKm),
      ]),
      [['Gesamt', gDays, gWeeks, gMonths, kmDec(fAvgDay), kmDec(fAvgWeek), kmDec(fAvgMonth), kmDec(gKm)]],
      {
        0: { fontStyle: 'bold' },
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right', fontStyle: 'bold' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right', fontStyle: 'bold' },
      },
    );
  } else if (aggs.length === 1) {
    const a = aggs[0];
    y = fleetSection(c, y, 'Pro Kalenderwoche (KW)') + 1;
    fleetTable(
      c,
      y,
      [['KW', 'Zeitraum', 'Tage', 'Ø km/Tag', 'Gesamt km']],
      a.weekRows.map((w) => [w.label, w.range, w.days, kmDec(w.avgKmDay), kmDec(w.km)]),
      [['Summe', '', a.activeDays, kmDec(a.avgKmDay), kmDec(a.totalKm)]],
      {
        0: { fontStyle: 'bold', cellWidth: 22 },
        1: { textColor: F.mut },
        2: { halign: 'right', cellWidth: 22 },
        3: { halign: 'right', fontStyle: 'bold', cellWidth: 32 },
        4: { halign: 'right', cellWidth: 32 },
      },
    );
  }

  fleetFooter(c);
  const fname = opts.filename
    || (aggs.length === 1 ? `Durchschnitte_${safeName(aggs[0].vehicle)}` : 'KM_Durchschnitte');
  doc.save(`${fname}.pdf`);
}

// ── 4) Driver list ──

export interface DriverPdfRow {
  name: string;
  card_number: string;
  latest_download: string;
  days_since: number | null;
  file_count: number;
}

export async function generateDriversPdf(rows: DriverPdfRow[]) {
  const c = await ctx('portrait');
  const { doc } = c;
  const y = fleetHeader(c, 'Fahrerliste', `${rows.length} Fahrer`);

  const dOnly = (s: string) => {
    if (!s) return '–';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '–' : d.toLocaleDateString('de-DE');
  };

  fleetTable(
    c,
    y,
    [['Fahrer', 'Kartennummer', 'Letzter Download', 'Tage', 'Dateien']],
    rows.map((r) => [
      r.name,
      r.card_number || '–',
      dOnly(r.latest_download),
      r.days_since == null ? '–' : String(r.days_since),
      String(r.file_count),
    ]),
    undefined,
    {
      0: { fontStyle: 'bold' },
      1: { textColor: F.mut },
      2: { halign: 'right', textColor: F.mut },
      3: { halign: 'right', fontStyle: 'bold' },
      4: { halign: 'center', textColor: F.mut },
    },
  );

  fleetFooter(c);
  doc.save(`Fahrerliste_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── 5) Stundenzettel — DATEV "Vorlage zur Dokumentation der täglichen Arbeitszeit" ──

export interface StundenzettelDatevDay {
  day: number;
  start: string;   // "HH:MM"
  end: string;     // "HH:MM"
  pause: number;   // minutes
  code: string;    // '', K, U, UU, F, …
}

export interface StundenzettelDatevInput {
  firma: string;
  name: string;
  persNr?: string;
  year: number;
  month: number;           // 1-12
  days: StundenzettelDatevDay[];
  locale?: 'de' | 'pl';    // weekday abbreviations follow the UI locale
}

const STZ_WD_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const STZ_WD_PL = ['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
const STZ_MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function stzToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  return m ? +m[1] * 60 + +m[2] : null;
}

export async function generateStundenzettelDatevPdf(input: StundenzettelDatevInput) {
  const c = await ctx('portrait');
  const { doc, W, M } = c;

  // Inter font so Polish weekday abbreviations (śr, niedz…) render correctly.
  const fonts = await loadInterFonts();
  if (fonts) registerInterFont(doc, fonts);
  const FONT = fonts ? 'Inter' : 'helvetica';

  const wd = (input.locale === 'pl' ? STZ_WD_PL : STZ_WD_DE);
  const count = new Date(input.year, input.month, 0).getDate();
  const byDay = new Map(input.days.map((d) => [d.day, d]));

  // ── Title + brand ──
  doc.setFont(FONT, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 30);
  doc.text('Vorlage zur Dokumentation der täglichen Arbeitszeit', M, 15);
  if (c.logo) {
    try { doc.addImage(c.logo, 'PNG', W - M - 34, 8, 34, 15); } catch { /* skip */ }
  }

  // ── Header fields (label + boxed value) ──
  const box = (x: number, y: number, w: number, h: number, value: string) => {
    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, h);
    if (value) {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(40, 40, 40);
      doc.text(value, x + w / 2, y + h / 2 + 1.4, { align: 'center' });
    }
  };
  const label = (s: string, x: number, y: number) => {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(40, 40, 40);
    doc.text(s, x, y);
  };

  let hy = 22;
  label('Firma:', M, hy + 4);
  box(M + 42, hy, W - M - (M + 42), 6.5, input.firma);
  hy += 9;
  label('Name des Mitarbeiters:', M, hy + 4);
  box(M + 42, hy, W - M - (M + 42), 6.5, input.name);
  hy += 9;
  label('Pers.-Nr.:', M, hy + 4);
  box(M + 42, hy, 28, 6.5, input.persNr || '');
  label('Monat/Jahr:', M + 82, hy + 4);
  box(M + 116, hy, W - M - (M + 116), 6.5, `${STZ_MONTHS_DE[input.month - 1]} ${String(input.year).slice(-2)}`);
  hy += 11;

  // ── Day grid ──
  let sumNet = 0;
  const body = [];
  for (let d = 1; d <= count; d++) {
    const rec = byDay.get(d);
    const dow = new Date(input.year, input.month - 1, d).getDay();
    const kal = `${wd[dow]}, ${String(d).padStart(2, '0')}`;
    const codeUp = (rec?.code || '').toUpperCase();
    let beginn = '';
    let ende = '';
    let gross = 0;
    let net = 0;
    let pauseMin = 0;
    if (rec && !codeUp) {
      const s = stzToMin(rec.start);
      const e0 = stzToMin(rec.end);
      if (s !== null && e0 !== null) {
        let e = e0;
        if (e <= s) e += 1440;
        gross = e - s;
        pauseMin = Math.max(0, rec.pause || 0);
        net = Math.max(0, gross - pauseMin);
        beginn = rec.start;
        ende = rec.end;
      }
    }
    sumNet += net;
    body.push([
      kal,
      beginn,
      ende,
      hm(gross),
      '',
      codeUp,
      '',
      pauseMin > 0 ? hm(pauseMin) : '',
      hm(net),
    ]);
  }

  autoTable(doc, {
    startY: hy,
    head: [[
      'Kalendertag',
      'Beginn\n(Uhrzeit)',
      'Ende\n(Uhrzeit)',
      'Dauer\n(Summe)',
      'aufgezeichnet\nam:',
      '*',
      'Bemerkungen',
      { content: 'Pause', colSpan: 2 },
    ]],
    body,
    theme: 'grid',
    styles: { font: FONT, fontSize: 8, cellPadding: { top: 0.85, bottom: 0.85, left: 2, right: 2 }, lineColor: [120, 120, 120], lineWidth: 0.15, textColor: [30, 30, 30], valign: 'middle' },
    headStyles: { font: FONT, fontStyle: 'bold', fontSize: 7.5, fillColor: [210, 210, 210], textColor: [30, 30, 30], halign: 'center', valign: 'middle', lineColor: [120, 120, 120], lineWidth: 0.15 },
    columnStyles: {
      0: { cellWidth: 20, halign: 'left' },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 24, halign: 'center' },
      5: { cellWidth: 8, halign: 'center', fontStyle: 'bold' },
      6: { cellWidth: 40, halign: 'left' },
      7: { cellWidth: 18, halign: 'right' },
      8: { cellWidth: 18, halign: 'right' },
    },
    margin: { left: M, right: M },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let y = (doc as any).lastAutoTable.finalY + 5;

  // ── Summe ──
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(40, 40, 40);
  doc.text('Summe:', M + 44, y, { align: 'right' });
  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.text(hm(sumNet), M + 50, y);
  doc.setDrawColor(30, 30, 30);
  doc.setLineWidth(0.4);
  const sw = doc.getTextWidth(hm(sumNet));
  doc.line(M + 50, y + 1.5, M + 50 + sw + 4, y + 1.5);

  // ── Signatures ──
  y += 14;
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.25);
  const sig = (x0: number, w1: number, w2: number, l1: string, l2: string) => {
    doc.line(x0, y, x0 + w1, y);
    doc.line(x0 + w1 + 6, y, x0 + w1 + 6 + w2, y);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(l1, x0, y + 4);
    doc.text(l2, x0 + w1 + 6, y + 4);
  };
  const half = (W - 2 * M) / 2;
  sig(M + 4, 26, half - 40, 'Datum', 'Unterschrift des Arbeitnehmers');
  sig(M + half + 4, 26, half - 40, 'Datum', 'Unterschrift des Arbeitgebers');

  // ── Legend ──
  y += 12;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(40, 40, 40);
  doc.text('* Tragen Sie in diese Spalte eines der folgenden Kürzel ein, wenn es für diesen Kalendertag zutrifft:', M, y);
  y += 4;
  // Schlüssel box
  doc.setFillColor(210, 210, 210);
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.2);
  doc.rect(M + 40, y, 42, 22, 'FD');
  doc.setTextColor(40, 40, 40);
  doc.text('Schlüssel', M + 40 + 21, y + 12.5, { align: 'center' });
  // key list with a separating vertical line
  const lx = M + 92;
  doc.line(lx + 8, y, lx + 8, y + 22);
  const keys: [string, string][] = [['K', 'Krank'], ['U', 'Urlaub'], ['UU', 'unbezahlter Urlaub'], ['F', 'Feiertag']];
  keys.forEach(([k, v], i) => {
    const ky = y + 5.5 + i * 5;
    doc.setFont(FONT, 'bold');
    doc.text(k, lx, ky);
    doc.setFont(FONT, 'normal');
    doc.text(v, lx + 12, ky);
  });

  const fname = `Arbeitszeit_${safeName(input.name || 'Mitarbeiter')}_${input.year}-${String(input.month).padStart(2, '0')}`;
  doc.save(`${fname}.pdf`);
}

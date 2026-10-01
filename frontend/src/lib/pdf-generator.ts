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

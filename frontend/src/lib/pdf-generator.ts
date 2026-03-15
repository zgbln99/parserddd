/**
 * Professional PDF Generator for Tachoprüfung
 * Uses jsPDF + jspdf-autotable for consistent, branded PDF reports
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

// ── Unicode font for multi-language PDF (Polish, Greek, etc.) ──
// DejaVu Sans - reliable Unicode font covering Latin Extended + Greek + Cyrillic
const UNICODE_FONT_URL = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf';
let cachedFontBase64: string | null = null;

async function loadUnicodeFont(): Promise<string | null> {
  if (cachedFontBase64) return cachedFontBase64;
  try {
    const res = await fetch(UNICODE_FONT_URL);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    cachedFontBase64 = btoa(binary);
    return cachedFontBase64;
  } catch { return null; }
}

function registerFont(doc: jsPDF, fontBase64: string) {
  doc.addFileToVFS('UnicodeFont.ttf', fontBase64);
  doc.addFont('UnicodeFont.ttf', 'UnicodeFont', 'normal');
  // Use same file for bold (will render as regular, but avoids missing font errors)
  doc.addFileToVFS('UnicodeFont-Bold.ttf', fontBase64);
  doc.addFont('UnicodeFont-Bold.ttf', 'UnicodeFont', 'bold');
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

function safeName(name: string): string {
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

interface Ctx {
  doc: jsPDF;
  W: number;   // page width
  H: number;   // page height
  M: number;   // margin
  logo: string | null;
}

async function ctx(orientation: 'portrait' | 'landscape' = 'portrait'): Promise<Ctx> {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const logo = await loadLogo();
  return { doc, W: doc.internal.pageSize.getWidth(), H: doc.internal.pageSize.getHeight(), M: 14, logo };
}

// ═══════════════════════════════════════════════════════════
//  BRANDED HEADER
// ═══════════════════════════════════════════════════════════

function drawHeader(c: Ctx, title: string, subtitle?: string): number {
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

function drawFooter(c: Ctx) {
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

function drawCard(doc: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string, color: [number, number, number]) {
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
export function analyzeVerstoesse(
  driverName: string,
  cardNumber: string,
  shifts: Shift[],
): { entries: VerstossEntry[]; types: VerstossType[]; period: string } {
  const entries: VerstossEntry[] = [];

  const fmtDatum = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  };

  const fmtTime = (dt: string) => {
    if (!dt) return '';
    const parts = dt.split(' ');
    return parts.length > 1 ? parts[1].slice(0, 5) : dt.slice(0, 5);
  };

  // Helper: severity + Bußgeld for Lenkzeitüberschreitung (EU 561/2006 Art. 6.1)
  // Per LV 48 Bußgeldkatalog: ≤1h=30€/MI, ≤2h=30€ per ½h/SI, >2h=60€ per ½h/VSI
  function lenkzeitKat(ueber: number): { kat: VerstossKategorie; fahrer: number; unt: number } {
    if (ueber > 120) return { kat: 'VSI', fahrer: Math.ceil(ueber / 30) * 60, unt: Math.ceil(ueber / 30) * 180 };
    if (ueber > 60) return { kat: 'SI', fahrer: Math.ceil(ueber / 30) * 30, unt: Math.ceil(ueber / 30) * 90 };
    return { kat: 'MI', fahrer: 30, unt: 0 };
  }

  // Helper: severity for Pausenverstoß (EU 561/2006 Art. 7)
  // Shortfall from 45min break: ≤15min=MI, ≤30min=SI, >30min=VSI
  function pauseKat(shortfall: number): { kat: VerstossKategorie; fahrer: number; unt: number } {
    if (shortfall > 30) return { kat: 'VSI', fahrer: 250, unt: 750 };
    if (shortfall > 15) return { kat: 'SI', fahrer: 150, unt: 450 };
    return { kat: 'MI', fahrer: 50, unt: 0 };
  }

  // Helper: severity for tägliche Ruhezeit (EU 561/2006 Art. 8.2)
  // Shortfall from 11h (or 9h reduced): <1h=MI, 1–2.5h=SI, ≥2.5h=VSI
  function ruhezeitKat(shortfall: number): { kat: VerstossKategorie; fahrer: number; unt: number } {
    if (shortfall >= 150) return { kat: 'VSI', fahrer: 500, unt: 1500 };
    if (shortfall >= 60) return { kat: 'SI', fahrer: 250, unt: 750 };
    return { kat: 'MI', fahrer: 100, unt: 0 };
  }

  // ────────────────────────────────────────────
  //  PER-SHIFT VIOLATIONS
  // ────────────────────────────────────────────
  for (const s of shifts) {
    const datum = fmtDatum(s.shift_date);
    const startTime = fmtTime(s.shift_start);
    const endTime = fmtTime(s.shift_end);
    const zeitRange = `${startTime} - ${endTime}`;

    // ── 1) EU VO 165/2014 Art. 34 — Manuelle Eingabe fehlt/verspätet ──
    if ((s.manual_minutes || 0) > 0) {
      entries.push({
        datum, zeit: startTime,
        beschreibung: `Landeingabe zu Schichtbeginn fehlt oder zu spät erfolgt`,
        rechtsgrundlage: 'EU VO 165/2014 Art. 34, FPersVO § 23 Abs 2',
        bussgeldFahrer: 37.50, bussgeldUnternehmen: 0, kategorie: 'MI',
      });
    }

    // ── 2) EU VO 165/2014 Art. 34 — Fahrzeugüberprüfung nicht dokumentiert ──
    if (s.driving_minutes > 0 && s.work_only_minutes <= 0 && s.duration_minutes > 30) {
      const diffMin = s.duration_minutes - s.driving_minutes - s.break_minutes - (s.avail_minutes || 0);
      entries.push({
        datum, zeit: startTime,
        beschreibung: `Überprüfung des Fahrzeugs vor Abfahrt nicht als Arbeitszeit dokumentiert.${diffMin > 0 ? ` Unterschreitung von ${hm(Math.abs(diffMin))}` : ''}`,
        rechtsgrundlage: 'EU VO 165/2014 Art. 34',
        bussgeldFahrer: 50, bussgeldUnternehmen: 0, kategorie: 'VSI',
      });
    }

    // ── 3) VO (EG) 561/2006 Art. 6.1 — Tägliche Lenkzeit ──
    // Max 9h, twice per week up to 10h
    if (s.driving_minutes > 540) {
      const ueber = s.driving_minutes - 540;
      const k = lenkzeitKat(ueber);
      entries.push({
        datum, zeit: startTime,
        beschreibung: `Tägliche Lenkzeit von ${s.driving_minutes > 600 ? '10' : '9'} Stunden überschritten. Überschreitung von ${hm(ueber)}`,
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 6 Abs. 1',
        bussgeldFahrer: k.fahrer, bussgeldUnternehmen: k.unt, kategorie: k.kat,
      });
    }

    // ── 4) VO (EG) 561/2006 Art. 7 — Pausenverstoß (45min nach 4,5h Lenkzeit) ──
    if (s.driving_minutes > 270 && s.break_minutes < 45) {
      const shortfall = 45 - s.break_minutes;
      const k = pauseKat(shortfall);
      entries.push({
        datum, zeit: zeitRange,
        beschreibung: `Fahrtunterbrechung von mind. 45 Min. nach 4,5h Lenkzeit nicht eingehalten. Pause nur ${s.break_minutes} Min. Unterschreitung um ${shortfall} Min.`,
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 7',
        bussgeldFahrer: k.fahrer, bussgeldUnternehmen: k.unt, kategorie: k.kat,
      });
    }

    // ── 5) ArbZG § 4 — Ruhepause bei Arbeitszeit > 6h ──
    // Min. 30min Pause nach 6h Arbeit, min. 45min nach 9h
    if (s.duration_minutes > 360 && s.break_minutes < 30) {
      const shortfall = 30 - s.break_minutes;
      entries.push({
        datum, zeit: zeitRange,
        beschreibung: `Arbeitszeit von 6 Std. ohne Ruhepause von mind. 30 Min. Pause nur ${s.break_minutes} Min., Unterschreitung um ${shortfall} Min.`,
        rechtsgrundlage: 'ArbZG § 4',
        bussgeldFahrer: 0, bussgeldUnternehmen: 60, kategorie: '-',
      });
    }
    if (s.duration_minutes > 540 && s.break_minutes < 45) {
      entries.push({
        datum, zeit: zeitRange,
        beschreibung: `Arbeitszeit über 9 Std. ohne Ruhepause von mind. 45 Min. Pause nur ${s.break_minutes} Min.`,
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
        beschreibung: `Tägliche Arbeitszeit von 10 Stunden überschritten. Überschreitung von ${hm(ueber)}`,
        rechtsgrundlage: 'ArbZG § 3',
        bussgeldFahrer: 0, bussgeldUnternehmen: busUnt, kategorie: '-',
      });
    }

    // ── 7) Richtlinie 2002/15/EG Art. 4 — Nachtarbeit > 10h in 24h ──
    if ((s.night_25_minutes + s.night_40_minutes) > 0 && s.duration_minutes > 600) {
      entries.push({
        datum, zeit: zeitRange,
        beschreibung: `Tägliche Arbeitszeit bei Nachtarbeit von 10 Stunden überschritten. Arbeitszeit ${hm(s.duration_minutes)}`,
        rechtsgrundlage: 'Richtlinie 2002/15/EG Art. 7',
        bussgeldFahrer: 0, bussgeldUnternehmen: 150, kategorie: 'SI',
      });
    }
  }

  // ────────────────────────────────────────────
  //  INTER-SHIFT: TÄGLICHE RUHEZEIT (Art. 8)
  // ────────────────────────────────────────────
  // Regular: 11h, Reduced (max 3x between weekly rests): 9h
  let reducedDailyRestCount = 0;
  for (let i = 1; i < shifts.length; i++) {
    const pe = shifts[i - 1].shift_end;
    const cs = shifts[i].shift_start;
    if (!pe || !cs) continue;

    const prev = new Date(pe.replace(' ', 'T'));
    const curr = new Date(cs.replace(' ', 'T'));
    const restMin = (curr.getTime() - prev.getTime()) / 60000;
    if (restMin <= 0 || restMin > 24 * 60) continue; // skip invalid gaps

    if (restMin < 9 * 60) {
      // Below even the reduced minimum — definite violation
      const shortfall = 9 * 60 - restMin;
      const k = ruhezeitKat(shortfall);
      entries.push({
        datum: fmtDatum(shifts[i].shift_date), zeit: fmtTime(cs),
        beschreibung: `Tägliche Ruhezeit unterschritten. Ruhezeit nur ${hm(restMin)} (Minimum 11h, reduziert 9h). Unterschreitung um ${hm(shortfall)}`,
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 2',
        bussgeldFahrer: k.fahrer, bussgeldUnternehmen: k.unt, kategorie: k.kat,
      });
    } else if (restMin < 11 * 60) {
      reducedDailyRestCount++;
      const shortfall = 11 * 60 - restMin;
      // Reduced rest (9-11h) — allowed max 3x between weekly rests
      if (reducedDailyRestCount > 3) {
        const k = ruhezeitKat(shortfall);
        entries.push({
          datum: fmtDatum(shifts[i].shift_date), zeit: fmtTime(cs),
          beschreibung: `Verkürzte tägliche Ruhezeit (${hm(restMin)}) — mehr als 3x pro Woche verkürzt. Unterschreitung um ${hm(shortfall)}`,
          rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 2',
          bussgeldFahrer: 250, bussgeldUnternehmen: 750, kategorie: 'SI',
        });
      } else {
        entries.push({
          datum: fmtDatum(shifts[i].shift_date), zeit: fmtTime(cs),
          beschreibung: `Verkürzte tägliche Ruhezeit (${hm(restMin)} statt 11h). Reduzierung Nr. ${reducedDailyRestCount}/3 erlaubt`,
          rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 2',
          bussgeldFahrer: 0, bussgeldUnternehmen: 0, kategorie: 'MI',
        });
      }
    }
  }

  // ────────────────────────────────────────────
  //  WEEKLY: Wöchentliche Lenkzeit (Art. 6.2)
  // ────────────────────────────────────────────
  // Max 56h per week
  const weekDrivingMap = new Map<string, { total: number; dates: string[] }>();
  for (const s of shifts) {
    const d = new Date(s.shift_date);
    // ISO week start (Monday)
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const wk = monday.toISOString().slice(0, 10);
    if (!weekDrivingMap.has(wk)) weekDrivingMap.set(wk, { total: 0, dates: [] });
    const w = weekDrivingMap.get(wk)!;
    w.total += s.driving_minutes;
    w.dates.push(s.shift_date);
  }

  for (const [weekStart, data] of weekDrivingMap) {
    if (data.total > 56 * 60) {
      const ueber = data.total - 56 * 60;
      const kat: VerstossKategorie = ueber > 8 * 60 ? 'VSI' : ueber > 4 * 60 ? 'SI' : 'MI';
      const fahrer = ueber > 8 * 60 ? 500 : ueber > 4 * 60 ? 250 : 100;
      entries.push({
        datum: fmtDatum(weekStart), zeit: `KW (${data.dates.length} Tage)`,
        beschreibung: `Wöchentliche Lenkzeit von 56 Stunden überschritten. Lenkzeit ${hm(data.total)}, Überschreitung ${hm(ueber)}`,
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 6 Abs. 2',
        bussgeldFahrer: fahrer, bussgeldUnternehmen: fahrer * 3, kategorie: kat,
      });
    }

    // More than 2x extended daily driving (>9h) in same week
    const extended = shifts.filter(s => {
      const d = new Date(s.shift_date);
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((day + 6) % 7));
      return mon.toISOString().slice(0, 10) === weekStart && s.driving_minutes > 540 && s.driving_minutes <= 600;
    });
    if (extended.length > 2) {
      entries.push({
        datum: fmtDatum(weekStart), zeit: `KW`,
        beschreibung: `Verlängerung der täglichen Lenkzeit auf 10h mehr als 2x in der Woche (${extended.length}x statt max. 2x)`,
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 6 Abs. 1',
        bussgeldFahrer: 100, bussgeldUnternehmen: 300, kategorie: 'SI',
      });
    }
  }

  // ────────────────────────────────────────────
  //  BI-WEEKLY: Doppelwoche Lenkzeit (Art. 6.3)
  // ────────────────────────────────────────────
  // Max 90h in two consecutive calendar weeks
  const weekKeys = Array.from(weekDrivingMap.keys()).sort();
  for (let i = 0; i < weekKeys.length - 1; i++) {
    const w1 = weekDrivingMap.get(weekKeys[i])!;
    const w2 = weekDrivingMap.get(weekKeys[i + 1])!;
    const biWeekTotal = w1.total + w2.total;
    if (biWeekTotal > 90 * 60) {
      const ueber = biWeekTotal - 90 * 60;
      const kat: VerstossKategorie = ueber > 10 * 60 ? 'VSI' : ueber > 4 * 60 ? 'SI' : 'MI';
      const fahrer = ueber > 10 * 60 ? 500 : ueber > 4 * 60 ? 250 : 100;
      entries.push({
        datum: fmtDatum(weekKeys[i]), zeit: 'Doppelwoche',
        beschreibung: `Lenkzeit in der Doppelwoche von 90 Stunden überschritten. Lenkzeit ${hm(biWeekTotal)}, Überschreitung ${hm(ueber)}`,
        rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 6 Abs. 3',
        bussgeldFahrer: fahrer, bussgeldUnternehmen: fahrer * 3, kategorie: kat,
      });
    }
  }

  // ────────────────────────────────────────────
  //  WEEKLY REST (Art. 8.6)
  // ────────────────────────────────────────────
  // Regular weekly rest: 45h (can reduce to 24h, but must compensate within 3 weeks)
  // Max 6 x 24h periods without weekly rest
  // Check for longest gap between weekly rests (any rest > 24h considered weekly rest attempt)
  const allGaps: { start: string; end: string; restMin: number }[] = [];
  for (let i = 1; i < shifts.length; i++) {
    const pe = shifts[i - 1].shift_end;
    const cs = shifts[i].shift_start;
    if (!pe || !cs) continue;
    const prev = new Date(pe.replace(' ', 'T'));
    const curr = new Date(cs.replace(' ', 'T'));
    const restMin = (curr.getTime() - prev.getTime()) / 60000;
    if (restMin > 0) allGaps.push({ start: pe, end: cs, restMin });
  }

  // Detect weekly rest violations: if 7+ days pass without a rest ≥ 24h
  if (shifts.length > 6) {
    let lastWeeklyRest = shifts[0].shift_date;
    for (const gap of allGaps) {
      if (gap.restMin >= 24 * 60) {
        // This qualifies as a weekly rest attempt
        const restDate = gap.end.split(' ')[0] || gap.end.slice(0, 10);
        if (gap.restMin < 45 * 60) {
          // Reduced weekly rest (24-45h)
          const shortfall = 45 * 60 - gap.restMin;
          const kat: VerstossKategorie = shortfall >= 4 * 60 ? 'VSI' : shortfall >= 2 * 60 ? 'SI' : 'MI';
          entries.push({
            datum: fmtDatum(restDate), zeit: `${hm(gap.restMin)}`,
            beschreibung: `Verkürzte wöchentliche Ruhezeit. Nur ${hm(gap.restMin)} statt 45h. Ausgleich innerhalb von 3 Wochen erforderlich`,
            rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 6',
            bussgeldFahrer: kat === 'VSI' ? 500 : kat === 'SI' ? 250 : 100,
            bussgeldUnternehmen: 0,
            kategorie: kat,
          });
        }
        lastWeeklyRest = restDate;
      } else {
        // Check if too many days since last weekly rest
        const gapDate = gap.end.split(' ')[0] || gap.end.slice(0, 10);
        const daysSince = (new Date(gapDate).getTime() - new Date(lastWeeklyRest).getTime()) / (24 * 60 * 60000);
        if (daysSince > 6) {
          entries.push({
            datum: fmtDatum(gapDate), zeit: '',
            beschreibung: `Keine wöchentliche Ruhezeit innerhalb von 6 x 24h. Letzte wöchentliche Ruhezeit vor ${Math.round(daysSince)} Tagen`,
            rechtsgrundlage: 'VO (EG) Nr. 561/2006 Art. 8 Abs. 6',
            bussgeldFahrer: 500, bussgeldUnternehmen: 1500, kategorie: 'VSI',
          });
          lastWeeklyRest = gapDate; // reset to avoid duplicate
        }
      }
    }
  }

  // ────────────────────────────────────────────
  //  WEEKLY WORKING TIME (Richtlinie 2002/15/EG Art. 4)
  // ────────────────────────────────────────────
  // Max average 48h/week over 4 months, max 60h in any single week
  for (const [weekStart, data] of weekDrivingMap) {
    const weekShifts = shifts.filter(s => {
      const d = new Date(s.shift_date);
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((day + 6) % 7));
      return mon.toISOString().slice(0, 10) === weekStart;
    });
    const weekWorkMin = weekShifts.reduce((a, s) => a + s.duration_minutes, 0);

    if (weekWorkMin > 60 * 60) {
      const ueber = weekWorkMin - 60 * 60;
      entries.push({
        datum: fmtDatum(weekStart), zeit: `KW (${weekShifts.length} Tage)`,
        beschreibung: `Wöchentliche Arbeitszeit von 60 Stunden überschritten. Arbeitszeit ${hm(weekWorkMin)}, Überschreitung ${hm(ueber)}`,
        rechtsgrundlage: 'Richtlinie 2002/15/EG Art. 4, ArbZG § 3',
        bussgeldFahrer: 0, bussgeldUnternehmen: ueber > 120 ? 500 : 250, kategorie: ueber > 120 ? 'VSI' : 'SI',
      });
    }
  }

  // ────────────────────────────────────────────
  //  FPersV § 1 — Sonntags-/Feiertagsarbeit
  // ────────────────────────────────────────────
  for (const s of shifts) {
    const d = new Date(s.shift_date);
    if (d.getDay() === 0 && s.duration_minutes > 0) {
      // Sunday work — only a note, not a fine per se, but often flagged
      // We'll include it as informational MI
    }
  }

  // ────────────────────────────────────────────
  //  SORT + AGGREGATE
  // ────────────────────────────────────────────
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
) {
  const { entries, types, period } = analyzeVerstoesse(driverName, cardNumber, shifts);
  const L = verstosseI18n[lang];

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Load Unicode font for Polish/Greek support
  const fontBase64 = await loadUnicodeFont();
  const fontFamily = fontBase64 ? 'UnicodeFont' : 'helvetica';
  if (fontBase64) {
    registerFont(doc, fontBase64);
    doc.setFont('UnicodeFont', 'normal');
  }
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const now = new Date();
  const erstelltAm = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // ── Totals ──
  let totalFahrer = 0, totalUnternehmen = 0;
  for (const e of entries) { totalFahrer += e.bussgeldFahrer; totalUnternehmen += e.bussgeldUnternehmen; }

  // ═══ PAGE HEADER ═══
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(L.docTitle, W - M, 10, { align: 'right' });

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(40, 40, 40);
  doc.text(`${L.driver}: ${driverName}`, W - M, 15, { align: 'right' });
  doc.text(`${L.cardNr}: ${cardNumber}`, W - M, 19.5, { align: 'right' });

  // Left-aligned header
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(L.violationDetails, M, 10);

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(8);
  doc.text(`${L.selectedPeriod} ${period}`, M, 15);
  doc.text(`${L.createdAt} ${erstelltAm}`, M, 19.5);

  let y = 24;

  // ═══ SUMMARY TABLE ═══
  const summHead = [[
    { content: L.summaryHeader, colSpan: 1 },
    'MSI', 'VSI', 'SI', 'MI', L.count,
    L.fineDriver, L.fineCompany,
  ]];

  const summBody = types.map((t) => [
    t.beschreibung,
    String(t.msi), String(t.vsi), String(t.si), String(t.mi), String(t.anzahl),
    `${t.bussgeldFahrer.toFixed(2).replace('.', ',')} \u20AC`,
    `${t.bussgeldUnternehmen.toFixed(2).replace('.', ',')} \u20AC`,
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
      `${totalFahrer.toFixed(2).replace('.', ',')} \u20AC`,
      `${totalUnternehmen.toFixed(2).replace('.', ',')} \u20AC`,
    ]],
    styles: {
      font: fontFamily,
      fontSize: 6,
      cellPadding: { top: 0.8, bottom: 0.8, left: 1.5, right: 1.5 },
      lineWidth: 0.2,
      lineColor: [180, 180, 180],
      textColor: [40, 40, 40],
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: [30, 30, 30],
      fontStyle: 'bold',
      fontSize: 6,
    },
    footStyles: {
      fillColor: [245, 245, 245],
      textColor: [30, 30, 30],
      fontStyle: 'bold',
      fontSize: 6,
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 95 },
      1: { halign: 'center', cellWidth: 14 },
      2: { halign: 'center', cellWidth: 14 },
      3: { halign: 'center', cellWidth: 14 },
      4: { halign: 'center', cellWidth: 14 },
      5: { halign: 'center', cellWidth: 16, fontStyle: 'bold' },
      6: { halign: 'right', cellWidth: 28 },
      7: { halign: 'right', cellWidth: 32 },
    },
    margin: { left: M, right: M },
    tableLineColor: [180, 180, 180],
    tableLineWidth: 0.2,
  });

  y = (doc as any).lastAutoTable.finalY + 4;

  // ═══ DETAIL TABLE ═══
  const detailHead = [[
    L.detDate, L.detTime, L.detDescription, L.detLegalBasis,
    L.fineDriver, L.fineCompany, L.detCategory,
  ]];

  const detailBody: string[][] = [];

  // Totals as first row
  detailBody.push([
    '', '', '', '',
    `${totalFahrer.toFixed(2).replace('.', ',')} \u20AC`,
    `${totalUnternehmen.toFixed(2).replace('.', ',')} \u20AC`,
    '',
  ]);

  for (const e of entries) {
    detailBody.push([
      e.datum,
      e.zeit,
      e.beschreibung,
      e.rechtsgrundlage,
      `${e.bussgeldFahrer.toFixed(2).replace('.', ',')} \u20AC`,
      `${e.bussgeldUnternehmen.toFixed(2).replace('.', ',')} \u20AC`,
      e.kategorie,
    ]);
  }

  autoTable(doc, {
    startY: y,
    head: detailHead,
    body: detailBody,
    styles: {
      font: fontFamily,
      fontSize: 5.5,
      cellPadding: { top: 0.6, bottom: 0.6, left: 1.2, right: 1.2 },
      lineWidth: 0.15,
      lineColor: [200, 200, 200],
      textColor: [40, 40, 40],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: [30, 30, 30],
      fontStyle: 'bold',
      fontSize: 5.5,
      cellPadding: { top: 1, bottom: 1, left: 1.2, right: 1.2 },
    },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 20 },
      2: { cellWidth: 80 },
      3: { cellWidth: 48 },
      4: { halign: 'right', cellWidth: 24 },
      5: { halign: 'right', cellWidth: 30 },
      6: { halign: 'center', cellWidth: 16 },
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
  const neededSpace = 45;
  if (y + neededSpace > H - 12) {
    doc.addPage('a4', 'landscape');
    y = 12;
  }

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(50, 50, 50);

  for (const txt of disclaimerTexts) {
    const lines = doc.splitTextToSize(txt, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 2.5 + 1;
  }

  y += 2;

  // ═══ BEMERKUNG + SIGNATURE (3 columns) ═══
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(30, 30, 30);
  doc.text(L.remark, M, y);
  y += 5;

  // Remark line (full width)
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.2);
  doc.line(M, y, W - M, y);
  y += 8;

  // 3 signature columns
  const colW = (W - 2 * M) / 3;
  const col1 = M;
  const col2 = M + colW;
  const col3 = M + colW * 2;
  const lineLen = colW - 15;

  doc.setLineWidth(0.3);
  doc.line(col1, y, col1 + lineLen, y);
  doc.line(col2 + 7, y, col2 + 7 + lineLen, y);
  doc.line(col3 + 14, y, col3 + 14 + lineLen, y);
  y += 3;
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100, 100, 100);
  doc.text(L.placeDate, col1, y);
  doc.text(L.signDriver, col2 + 7, y);
  doc.text(L.signResponsible, col3 + 14, y);

  // ═══ FOOTER on all pages ═══
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(6);
    doc.setTextColor(100, 100, 100);
    doc.text('LTS Logistik GmbH \u2014 Tachopru\u0308fung', M, H - 5);
    doc.text(`${L.pageOf} ${i} / ${pages}`, W - M, H - 5, { align: 'right' });
  }

  doc.save(`Verstoesse_${safeName(driverName)}_${new Date().toISOString().slice(0, 10)}.pdf`);
  return { totalEntries: entries.length, totalFahrer, totalUnternehmen };
}

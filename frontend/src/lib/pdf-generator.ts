/**
 * Professional PDF Generator for Tachoprüfung
 * Uses jsPDF + jspdf-autotable for consistent, branded PDF reports
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── Brand colors ──
const BRAND = {
  primary: [30, 64, 175] as [number, number, number],       // indigo-800
  primaryLight: [99, 102, 241] as [number, number, number],  // indigo-500
  accent: [16, 185, 129] as [number, number, number],        // emerald-500
  danger: [220, 38, 38] as [number, number, number],         // red-600
  warning: [245, 158, 11] as [number, number, number],       // amber-500
  success: [21, 128, 61] as [number, number, number],        // green-700
  dark: [15, 23, 42] as [number, number, number],            // slate-900
  gray: [100, 116, 139] as [number, number, number],         // slate-500
  lightGray: [241, 245, 249] as [number, number, number],    // slate-100
  white: [255, 255, 255] as [number, number, number],
  weekendBg: [254, 242, 242] as [number, number, number],    // rose-50
};

const LOGO_URL = 'https://lfrfrp.stripocdn.email/content/guids/CABINET_862a1b05e2f09e6cca20d3b1bce9a4ee0b92caa7a66ee37aabdb90e233f8e4dc/images/image_6.png';

let cachedLogo: string | null = null;

async function loadLogo(): Promise<string | null> {
  if (cachedLogo) return cachedLogo;
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        cachedLogo = reader.result as string;
        resolve(cachedLogo);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function fmtDate(): string {
  return new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, '').trim() || 'Export';
}

interface PdfContext {
  doc: jsPDF;
  pageW: number;
  pageH: number;
  margin: number;
  logoData: string | null;
}

async function createPdfContext(orientation: 'portrait' | 'landscape' = 'portrait'): Promise<PdfContext> {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const logoData = await loadLogo();
  return {
    doc,
    pageW: doc.internal.pageSize.getWidth(),
    pageH: doc.internal.pageSize.getHeight(),
    margin: 15,
    logoData,
  };
}

function addHeader(ctx: PdfContext, title: string, subtitle?: string) {
  const { doc, pageW, margin, logoData } = ctx;
  const y = margin;

  // Top accent bar
  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 0, pageW, 3, 'F');

  // Logo
  let textX = margin;
  if (logoData) {
    try {
      doc.addImage(logoData, 'PNG', margin, y + 2, 28, 12);
      textX = margin + 32;
    } catch {
      // Logo failed to load, skip
    }
  }

  // Company name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.gray);
  doc.text('LTS Logistik GmbH', textX, y + 5);

  // Title
  doc.setFontSize(16);
  doc.setTextColor(...BRAND.dark);
  doc.text(title, textX, y + 12);

  // Subtitle
  if (subtitle) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.gray);
    doc.text(subtitle, textX, y + 17);
  }

  // Date on right
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.gray);
  doc.text(fmtDate(), pageW - margin, y + 5, { align: 'right' });

  // Separator line
  const sepY = y + 21;
  doc.setDrawColor(...BRAND.primaryLight);
  doc.setLineWidth(0.5);
  doc.line(margin, sepY, pageW - margin, sepY);

  return sepY + 4;
}

function addFooter(ctx: PdfContext) {
  const { doc, pageW, pageH, margin } = ctx;
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);

    // Bottom accent bar
    doc.setFillColor(...BRAND.primary);
    doc.rect(0, pageH - 3, pageW, 3, 'F');

    // Footer text
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.gray);
    doc.text('LTS Logistik GmbH — Tachoprüfung', margin, pageH - 5);
    doc.text(`Seite ${i} / ${pages}`, pageW - margin, pageH - 5, { align: 'right' });
    doc.text('Vertraulich — Nur zum internen Gebrauch', pageW / 2, pageH - 5, { align: 'center' });
  }
}

function addMetricCard(doc: jsPDF, x: number, y: number, w: number, label: string, value: string, color: [number, number, number] = BRAND.primary) {
  // Card background
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, 18, 2, 2, 'F');

  // Left accent bar
  doc.setFillColor(...color);
  doc.rect(x, y, 1.5, 18, 'F');

  // Label
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND.gray);
  doc.text(label.toUpperCase(), x + 5, y + 6);

  // Value
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...color);
  doc.text(value, x + 5, y + 14);
}

// ═════════════════════════════════════════════════════════════════
//  ANALYSIS PDF — Single driver report
// ═════════════════════════════════════════════════════════════════

interface AnalysisSummary {
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
}

interface ShiftRow {
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
}

export async function generateAnalysisPdf(
  driverName: string,
  cardNumber: string,
  summary: AnalysisSummary,
  shifts: ShiftRow[],
) {
  const ctx = await createPdfContext('portrait');
  const { doc, pageW, margin } = ctx;

  const startY = addHeader(ctx, driverName, `Kartennr: ${cardNumber} — ${shifts.length} Schichten`);

  // ── Metric cards ──
  const cardW = (pageW - 2 * margin - 8) / 3;
  let y = startY + 2;

  addMetricCard(doc, margin, y, cardW, 'Arbeitszeit', summary.total_work_hm, BRAND.primary);
  addMetricCard(doc, margin + cardW + 4, y, cardW, 'Lenkzeit', summary.total_driving_hm, BRAND.accent);
  addMetricCard(doc, margin + 2 * (cardW + 4), y, cardW, 'Pausen', summary.total_break_hm, BRAND.gray);

  y += 22;

  addMetricCard(doc, margin, y, cardW, 'Nacht 25%', `${(summary.night_25_minutes / 60).toFixed(2)}h (${summary.night_25_hm})`, BRAND.primaryLight);
  addMetricCard(doc, margin + cardW + 4, y, cardW, 'Nacht 40%', `${(summary.night_40_minutes / 60).toFixed(2)}h (${summary.night_40_hm})`, [124, 58, 237]);
  addMetricCard(doc, margin + 2 * (cardW + 4), y, cardW, 'Diäten', String(summary.diet_count), BRAND.warning);

  y += 24;

  // ── Shifts table ──
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND.dark);
  doc.text('Schichtübersicht', margin, y);
  y += 3;

  const tableHead = [['Tag', 'Datum', 'Start', 'Ende', 'Dauer', 'Fahrt', 'Arbeit', 'Pause', 'N25%', 'N40%', 'Diät']];

  const tableBody = shifts.map((s) => [
    s.weekday,
    s.shift_date,
    s.shift_start?.split(' ')[1] || s.shift_start,
    s.shift_end?.split(' ')[1] || s.shift_end,
    s.duration_hm,
    s.driving_hm,
    s.work_only_hm,
    s.break_hm,
    (s.night_25_minutes / 60).toFixed(2),
    (s.night_40_minutes / 60).toFixed(2),
    s.has_diet ? 'JA' : '—',
  ]);

  autoTable(doc, {
    startY: y,
    head: tableHead,
    body: tableBody,
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      lineWidth: 0.1,
      lineColor: [226, 232, 240],
    },
    headStyles: {
      fillColor: BRAND.primary,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 7,
      cellPadding: 3,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 12 },
      4: { fontStyle: 'bold' },
      10: { halign: 'center' },
    },
    didParseCell: (data: any) => {
      if (data.section !== 'body') return;
      const shift = shifts[data.row.index];
      if (!shift) return;
      // Weekend rows
      const wd = shift.weekday;
      if (['So', 'Nd', 'Sa', 'Su'].includes(wd)) {
        data.cell.styles.fillColor = BRAND.weekendBg;
      }
      // Diet YES green
      if (data.column.index === 10 && shift.has_diet) {
        data.cell.styles.textColor = BRAND.success;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: margin, right: margin },
  });

  // ── Vehicle info ──
  const allVehicles = [...new Set(shifts.flatMap((s) => s.vehicles))];
  if (allVehicles.length > 0) {
    const finalY = (doc as any).lastAutoTable.finalY + 6;
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.gray);
    doc.text(`Fahrzeuge: ${allVehicles.join(', ')}`, margin, finalY);
  }

  addFooter(ctx);

  const fileName = `${safeName(driverName)}_Analyse_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}

// ═════════════════════════════════════════════════════════════════
//  SETTLEMENT PDF — Monthly batch report
// ═════════════════════════════════════════════════════════════════

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
  const ctx = await createPdfContext('landscape');
  const { doc, pageW, margin } = ctx;

  const [year, mon] = period.split('-');
  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const monthLabel = `${monthNames[parseInt(mon) - 1]} ${year}`;

  const startY = addHeader(ctx, `Monatsabrechnung — ${monthLabel}`, `${drivers.length} Fahrer · Abrechnungszeitraum ${period}`);

  // ── Totals summary ──
  let totalWork = 0, totalN25 = 0, totalN40 = 0, totalDiets = 0, totalVma = 0, totalShifts = 0;
  for (const d of drivers) {
    totalWork += d.summary.total_work_minutes;
    totalN25 += d.summary.night_25_minutes;
    totalN40 += d.summary.night_40_minutes;
    totalDiets += d.summary.effective_diet_count;
    totalVma += d.summary.vma_amount;
    totalShifts += d.summary.total_shifts;
  }

  const cardW2 = (pageW - 2 * margin - 20) / 6;
  let y = startY + 2;
  addMetricCard(doc, margin, y, cardW2, 'Fahrer', String(drivers.length), BRAND.primary);
  addMetricCard(doc, margin + (cardW2 + 4) * 1, y, cardW2, 'Schichten', String(totalShifts), BRAND.accent);
  addMetricCard(doc, margin + (cardW2 + 4) * 2, y, cardW2, 'Arbeitszeit', `${Math.floor(totalWork / 60)}:${String(totalWork % 60).padStart(2, '0')}`, BRAND.primaryLight);
  addMetricCard(doc, margin + (cardW2 + 4) * 3, y, cardW2, 'Nacht 25%', (totalN25 / 60).toFixed(2), [124, 58, 237]);
  addMetricCard(doc, margin + (cardW2 + 4) * 4, y, cardW2, 'Nacht 40%', (totalN40 / 60).toFixed(2), BRAND.danger);
  addMetricCard(doc, margin + (cardW2 + 4) * 5, y, cardW2, 'VMA Summe', `${totalVma.toFixed(2)} €`, BRAND.warning);

  y += 24;

  // ── Drivers table ──
  const head = [['Nr', 'Fahrer', 'Pers.Nr.', 'Schichten', 'Arbeitszeit', 'Lenkzeit', 'N25%', 'N40%', 'Diäten', 'Satz €', 'VMA €']];
  const body = drivers.map((d, i) => [
    String(i + 1),
    d.driver_name,
    d.personal_nr || '—',
    String(d.summary.total_shifts),
    d.summary.total_work_hm,
    d.summary.total_driving_hm,
    (d.summary.night_25_minutes / 60).toFixed(2),
    (d.summary.night_40_minutes / 60).toFixed(2),
    String(d.summary.effective_diet_count),
    d.diet_rate.toFixed(2),
    d.summary.vma_amount.toFixed(2),
  ]);

  autoTable(doc, {
    startY: y,
    head,
    body,
    styles: {
      fontSize: 7.5,
      cellPadding: 2.5,
      lineWidth: 0.1,
      lineColor: [226, 232, 240],
    },
    headStyles: {
      fillColor: BRAND.primary,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 7,
      cellPadding: 3,
    },
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
    // Totals row
    foot: [[
      '', 'SUMME', '', String(totalShifts),
      `${Math.floor(totalWork / 60)}:${String(totalWork % 60).padStart(2, '0')}`,
      '',
      (totalN25 / 60).toFixed(2),
      (totalN40 / 60).toFixed(2),
      String(totalDiets),
      '',
      totalVma.toFixed(2),
    ]],
    footStyles: {
      fillColor: [30, 64, 175],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
    },
    margin: { left: margin, right: margin },
  });

  addFooter(ctx);
  doc.save(`Abrechnung_${period}.pdf`);
}

// ═════════════════════════════════════════════════════════════════
//  COMPLIANCE PDF — EU 561/2006 driving time violations
// ═════════════════════════════════════════════════════════════════

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
  score: number; // 0–100
}

/**
 * Analyze shifts for EU 561/2006 compliance violations
 */
export function analyzeCompliance(
  driverName: string,
  cardNumber: string,
  shifts: ShiftRow[],
): ComplianceReport {
  const violations: ComplianceViolation[] = [];
  const period = shifts.length > 0
    ? `${shifts[0].shift_date} — ${shifts[shifts.length - 1].shift_date}`
    : '';

  for (const s of shifts) {
    // Daily driving limit: 9h (540 min), can extend to 10h twice/week
    if (s.driving_minutes > 600) {
      violations.push({
        date: s.shift_date,
        weekday: s.weekday,
        type: 'daily_driving',
        description: 'Tägliche Lenkzeit über 10h (absolutes Maximum)',
        actual: `${(s.driving_minutes / 60).toFixed(1)}h`,
        limit: '10:00h',
        severity: 'violation',
      });
    } else if (s.driving_minutes > 540) {
      violations.push({
        date: s.shift_date,
        weekday: s.weekday,
        type: 'daily_driving',
        description: 'Tägliche Lenkzeit über 9h (max. 2x pro Woche erlaubt)',
        actual: `${(s.driving_minutes / 60).toFixed(1)}h`,
        limit: '9:00h',
        severity: 'warning',
      });
    }

    // Daily work limit: 10h max (ArbZG §3), up to 10h only with compensation
    if (s.duration_minutes > 660) {
      violations.push({
        date: s.shift_date,
        weekday: s.weekday,
        type: 'daily_work',
        description: 'Tägliche Arbeitszeit über 11h',
        actual: `${(s.duration_minutes / 60).toFixed(1)}h`,
        limit: '10:00h',
        severity: 'violation',
      });
    } else if (s.duration_minutes > 600) {
      violations.push({
        date: s.shift_date,
        weekday: s.weekday,
        type: 'daily_work',
        description: 'Tägliche Arbeitszeit über 10h (Ausgleich erforderlich)',
        actual: `${(s.duration_minutes / 60).toFixed(1)}h`,
        limit: '10:00h',
        severity: 'warning',
      });
    }

    // Break requirement: 45min after 4.5h driving (can split 15+30)
    if (s.driving_minutes > 270 && s.break_minutes < 45) {
      violations.push({
        date: s.shift_date,
        weekday: s.weekday,
        type: 'short_break',
        description: 'Pause unter 45min bei über 4,5h Lenkzeit',
        actual: `${s.break_minutes}min`,
        limit: '45min',
        severity: 'violation',
      });
    }
  }

  // Weekly driving check (aggregate per week)
  const weekMap = new Map<string, number>();
  for (const s of shifts) {
    const d = new Date(s.shift_date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const weekKey = weekStart.toISOString().slice(0, 10);
    weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + s.driving_minutes);
  }
  for (const [weekStart, totalMin] of weekMap) {
    if (totalMin > 56 * 60) {
      violations.push({
        date: weekStart,
        weekday: 'KW',
        type: 'weekly_driving',
        description: 'Wöchentliche Lenkzeit über 56h',
        actual: `${(totalMin / 60).toFixed(1)}h`,
        limit: '56:00h',
        severity: 'violation',
      });
    }
  }

  // Rest period check: minimum 11h between shifts
  for (let i = 1; i < shifts.length; i++) {
    const prevEnd = shifts[i - 1].shift_end;
    const currStart = shifts[i].shift_start;
    if (prevEnd && currStart) {
      const prev = new Date(prevEnd.replace(' ', 'T'));
      const curr = new Date(currStart.replace(' ', 'T'));
      const restMinutes = (curr.getTime() - prev.getTime()) / 60000;
      if (restMinutes > 0 && restMinutes < 9 * 60) {
        violations.push({
          date: shifts[i].shift_date,
          weekday: shifts[i].weekday,
          type: 'rest_period',
          description: 'Ruhezeit unter 9h (Minimum: 11h, reduziert 9h max 3x/Woche)',
          actual: `${(restMinutes / 60).toFixed(1)}h`,
          limit: '11:00h (9:00h)',
          severity: 'violation',
        });
      } else if (restMinutes >= 9 * 60 && restMinutes < 11 * 60) {
        violations.push({
          date: shifts[i].shift_date,
          weekday: shifts[i].weekday,
          type: 'rest_period',
          description: 'Verkürzte Ruhezeit (9–11h, max 3x pro Woche erlaubt)',
          actual: `${(restMinutes / 60).toFixed(1)}h`,
          limit: '11:00h',
          severity: 'warning',
        });
      }
    }
  }

  // Score: 100 minus penalties
  const vCount = violations.filter((v) => v.severity === 'violation').length;
  const wCount = violations.filter((v) => v.severity === 'warning').length;
  const score = Math.max(0, 100 - vCount * 15 - wCount * 5);

  violations.sort((a, b) => a.date.localeCompare(b.date));

  return {
    driverName,
    cardNumber,
    period,
    totalShifts: shifts.length,
    violations,
    score,
  };
}

export async function generateCompliancePdf(report: ComplianceReport) {
  const ctx = await createPdfContext('portrait');
  const { doc, pageW, margin } = ctx;

  const vCount = report.violations.filter((v) => v.severity === 'violation').length;
  const wCount = report.violations.filter((v) => v.severity === 'warning').length;

  const scoreColor = report.score >= 80 ? BRAND.success : report.score >= 50 ? BRAND.warning : BRAND.danger;

  const startY = addHeader(ctx, `Compliance-Bericht: ${report.driverName}`, `${report.cardNumber} — ${report.period} — EU 561/2006 & ArbZG`);

  // ── Score and stats ──
  let y = startY + 2;
  const cardW = (pageW - 2 * margin - 12) / 4;

  // Score card (larger)
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, cardW, 24, 2, 2, 'F');
  doc.setFillColor(...scoreColor);
  doc.rect(margin, y, 2, 24, 'F');
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND.gray);
  doc.text('COMPLIANCE SCORE', margin + 6, y + 6);
  doc.setFontSize(20);
  doc.setTextColor(...scoreColor);
  doc.text(`${report.score}%`, margin + 6, y + 18);

  addMetricCard(doc, margin + cardW + 4, y + 3, cardW, 'Schichten', String(report.totalShifts), BRAND.primary);
  addMetricCard(doc, margin + 2 * (cardW + 4), y + 3, cardW, 'Verstöße', String(vCount), BRAND.danger);
  addMetricCard(doc, margin + 3 * (cardW + 4), y + 3, cardW, 'Warnungen', String(wCount), BRAND.warning);

  y += 30;

  if (report.violations.length === 0) {
    // ── All clear ──
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND.success);
    doc.text('✓ Keine Verstöße festgestellt', pageW / 2, y + 10, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.gray);
    doc.text('Alle Lenk- und Ruhezeiten entsprechen den Vorschriften.', pageW / 2, y + 16, { align: 'center' });
  } else {
    // ── Violations table ──
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND.dark);
    doc.text('Festgestellte Verstöße und Warnungen', margin, y);
    y += 3;

    const head = [['', 'Datum', 'Tag', 'Typ', 'Beschreibung', 'IST', 'Grenze']];
    const body = report.violations.map((v) => [
      v.severity === 'violation' ? '⚠' : '⚡',
      v.date,
      v.weekday,
      v.type === 'daily_driving' ? 'Lenkzeit'
        : v.type === 'daily_work' ? 'Arbeitszeit'
        : v.type === 'short_break' ? 'Pause'
        : v.type === 'rest_period' ? 'Ruhezeit'
        : 'Woche',
      v.description,
      v.actual,
      v.limit,
    ]);

    autoTable(doc, {
      startY: y,
      head,
      body,
      styles: {
        fontSize: 7,
        cellPadding: 2.5,
        lineWidth: 0.1,
        lineColor: [226, 232, 240],
      },
      headStyles: {
        fillColor: BRAND.dark,
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 6.5,
        cellPadding: 3,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
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
        if (v.severity === 'violation') {
          if (data.column.index === 0 || data.column.index === 5) {
            data.cell.styles.textColor = BRAND.danger;
            data.cell.styles.fontStyle = 'bold';
          }
        } else {
          if (data.column.index === 0 || data.column.index === 5) {
            data.cell.styles.textColor = BRAND.warning;
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
      margin: { left: margin, right: margin },
    });

    // ── Legend ──
    const legendY = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND.dark);
    doc.text('Rechtsgrundlage:', margin, legendY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.gray);
    doc.setFontSize(6.5);
    const laws = [
      'VO (EG) Nr. 561/2006 — Lenk- und Ruhezeiten im Straßenverkehr',
      'Richtlinie 2002/15/EG — Arbeitszeit im Straßentransport',
      'ArbZG §3 — Tägliche Arbeitszeit max. 10 Stunden',
      'FPersV — Fahrpersonalverordnung',
    ];
    laws.forEach((law, i) => {
      doc.text(`• ${law}`, margin + 2, legendY + 5 + i * 4);
    });
  }

  addFooter(ctx);
  doc.save(`Compliance_${safeName(report.driverName)}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

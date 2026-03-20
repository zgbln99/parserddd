import { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, GitCompareArrows, Printer, Play, FileDown } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchDrivers, compareDrivers, type CompareDriverResult } from '../lib/api';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { minutesToHm } from '../lib/utils';
import type { Driver } from '../types';

const LOGO_URL = 'https://lfrfrp.stripocdn.email/content/guids/CABINET_862a1b05e2f09e6cca20d3b1bce9a4ee0b92caa7a66ee37aabdb90e233f8e4dc/images/image_6.png';
let _cachedLogo: string | null = null;
async function preloadLogo(): Promise<string | null> {
  if (_cachedLogo) return _cachedLogo;
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => { _cachedLogo = reader.result as string; resolve(_cachedLogo); };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

function addBrandedHeader(doc: jsPDF, logo: string | null, title: string, subtitle: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const m = 14;
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, 3, 'F');
  let textX = m;
  if (logo) { try { doc.addImage(logo, 'PNG', m, 5, 24, 10); textX = m + 27; } catch {} }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('LTS Logistik GmbH', textX, 9);
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(title, textX, 14.5);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(subtitle, textX, 19);
  doc.setFontSize(7);
  doc.text(new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), pageW - m, 9, { align: 'right' });
  doc.setDrawColor(99, 102, 241);
  doc.setLineWidth(0.5);
  doc.line(m, 22, pageW - m, 22);
}

function addBrandedFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(30, 64, 175);
    doc.rect(0, pageH - 3, pageW, 3, 'F');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('LTS Logistik GmbH — Tachoprüfung', 14, pageH - 5);
    doc.text(`Seite ${i} / ${pages}`, pageW - 14, pageH - 5, { align: 'right' });
  }
}

const weekdayMapDe: Record<string, string> = {
  Pn: 'Mo', Wt: 'Di', Śr: 'Mi', Cz: 'Do', Pt: 'Fr', So: 'Sa', Nd: 'So',
};

function localWd(wd: string, locale: string) {
  return locale === 'de' ? (weekdayMapDe[wd] ?? wd) : wd;
}

function timeOnly(dt: string) {
  // "2025-03-01 06:30" -> "06:30"
  return dt.includes(' ') ? dt.split(' ')[1] : dt;
}

function avgTime(times: string[]): string {
  if (!times.length) return '—';
  let totalMin = 0;
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    totalMin += h * 60 + m;
  }
  const avg = Math.round(totalMin / times.length);
  return minutesToHm(avg);
}

export function CompareDriversPage() {
  const { t, locale } = useI18n();
  const { dateFrom, dateTo } = useDateFilter();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [comparing, setComparing] = useState(false);
  const [results, setResults] = useState<CompareDriverResult[] | null>(null);

  useEffect(() => {
    fetchDrivers()
      .then((data) => { setDrivers(data.drivers); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return drivers;
    return drivers.filter((d) => d.name.toLowerCase().includes(q) || d.card_number.toLowerCase().includes(q));
  }, [drivers, search]);

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleGenerate = useCallback(async () => {
    if (selected.size === 0) return;
    setComparing(true);
    try {
      // For each selected driver, pick the latest file
      const files: { path: string; driver_name: string; card_number: string }[] = [];
      for (const d of drivers) {
        if (!selected.has(d.name)) continue;
        if (d.files.length > 0) {
          files.push({
            path: d.files[0].path, // files are sorted newest-first
            driver_name: d.name,
            card_number: d.card_number,
          });
        }
      }
      if (files.length === 0) {
        setComparing(false);
        return;
      }
      const data = await compareDrivers(files);
      setResults(data.drivers);
    } catch {
      setResults([]);
    } finally {
      setComparing(false);
    }
  }, [selected, drivers]);

  // Collect all unique dates across all results, filtered by global date range
  const allDates = useMemo(() => {
    if (!results) return [];
    const dateSet = new Set<string>();
    for (const r of results) {
      for (const sh of r.shifts) {
        if (dateFrom && sh.date < dateFrom) continue;
        if (dateTo && sh.date > dateTo) continue;
        dateSet.add(sh.date);
      }
    }
    return Array.from(dateSet).sort();
  }, [results, dateFrom, dateTo]);

  // Build per-driver stats (filtered by global date range)
  const driverStats = useMemo(() => {
    if (!results) return [];
    const dateSet = new Set(allDates);
    return results.map((r) => {
      const filteredShifts = r.shifts.filter((sh) => dateSet.has(sh.date));
      const starts = filteredShifts.map((sh) => timeOnly(sh.start));
      const ends = filteredShifts.map((sh) => timeOnly(sh.end));
      const totalWork = filteredShifts.reduce((s, sh) => s + sh.work_minutes, 0);
      return {
        name: r.driver_name,
        totalShifts: filteredShifts.length,
        avgStart: avgTime(starts),
        avgEnd: avgTime(ends),
        avgDuration: filteredShifts.length ? minutesToHm(Math.round(totalWork / filteredShifts.length)) : '—',
      };
    });
  }, [results, allDates]);

  // Build shift lookup for comparison table (must be before any conditional returns – Rules of Hooks)
  const shiftLookup = useMemo(() => {
    if (!results) return new Map<string, Map<string, { start: string; end: string; duration_hm: string }>>();
    const map = new Map<string, Map<string, { start: string; end: string; duration_hm: string }>>();
    for (const r of results) {
      const driverMap = new Map<string, { start: string; end: string; duration_hm: string }>();
      for (const sh of r.shifts) {
        driverMap.set(sh.date, { start: timeOnly(sh.start), end: timeOnly(sh.end), duration_hm: sh.duration_hm });
      }
      map.set(r.driver_name, driverMap);
    }
    return map;
  }, [results]);

  const handlePrint = useCallback(() => {
    if (!results || results.length === 0) return;
    const pw = window.open('', '_blank');
    if (!pw) return;

    const headerCols = results.map((r) => `<th colspan="2" style="border:1px solid #ccc;padding:6px 10px;background:#f0f0f0;text-align:center;font-size:12px;">${r.driver_name}</th>`).join('');
    const subHeaderCols = results.map(() => `<th style="border:1px solid #ddd;padding:3px 8px;background:#f8f8f8;font-size:10px;text-align:center">${t('compareStart')}</th><th style="border:1px solid #ddd;padding:3px 8px;background:#f8f8f8;font-size:10px;text-align:center">${t('compareEnd')}</th>`).join('');

    const shiftMap = new Map<string, Map<string, { start: string; end: string }>>();
    for (const r of results) {
      const m = new Map<string, { start: string; end: string }>();
      for (const sh of r.shifts) {
        m.set(sh.date, { start: timeOnly(sh.start), end: timeOnly(sh.end) });
      }
      shiftMap.set(r.driver_name, m);
    }

    const bodyRows = allDates.map((date) => {
      const cells = results.map((r) => {
        const sh = shiftMap.get(r.driver_name)?.get(date);
        if (!sh) return '<td style="border:1px solid #eee;padding:3px 8px;text-align:center;color:#ccc">—</td><td style="border:1px solid #eee;padding:3px 8px;text-align:center;color:#ccc">—</td>';
        return `<td style="border:1px solid #eee;padding:3px 8px;text-align:center;font-weight:600;color:#16a34a">${sh.start}</td><td style="border:1px solid #eee;padding:3px 8px;text-align:center;font-weight:600;color:#dc2626">${sh.end}</td>`;
      }).join('');
      return `<tr><td style="border:1px solid #ddd;padding:3px 8px;font-weight:bold;white-space:nowrap">${date}</td>${cells}</tr>`;
    }).join('');

    const dateSet = new Set(allDates);
    const statsRows = results.map((r) => {
      const fs = r.shifts.filter((sh) => dateSet.has(sh.date));
      const starts = fs.map((sh) => timeOnly(sh.start));
      const ends = fs.map((sh) => timeOnly(sh.end));
      const totalWork = fs.reduce((s, sh) => s + sh.work_minutes, 0);
      const avgDur = fs.length ? minutesToHm(Math.round(totalWork / fs.length)) : '—';
      return `<tr><td style="padding:4px 8px;font-weight:bold">${r.driver_name}</td><td style="padding:4px 8px;text-align:center">${fs.length}</td><td style="padding:4px 8px;text-align:center">${avgTime(starts)}</td><td style="padding:4px 8px;text-align:center">${avgTime(ends)}</td><td style="padding:4px 8px;text-align:center;font-weight:bold">${avgDur}</td></tr>`;
    }).join('');

    pw.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t('compareTitle')}</title>
<style>body{font-family:Arial,sans-serif;margin:20px;font-size:11px}h1{font-size:18px;margin-bottom:4px}.meta{color:#666;margin-bottom:16px;font-size:11px}table{border-collapse:collapse;width:100%;margin-top:10px}@media print{body{margin:10px}}</style></head><body>
<h1>${t('compareTitle')}</h1>
<div class="meta">${new Date().toLocaleDateString(locale === 'de' ? 'de-DE' : 'pl-PL')}</div>
<h3 style="margin-top:20px;font-size:13px">${t('compareTotalShifts')}</h3>
<table><thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ccc">${t('driversName')}</th><th style="padding:4px 8px;border-bottom:2px solid #ccc">${t('compareTotalShifts')}</th><th style="padding:4px 8px;border-bottom:2px solid #ccc">${t('compareAvgStart')}</th><th style="padding:4px 8px;border-bottom:2px solid #ccc">${t('compareAvgEnd')}</th><th style="padding:4px 8px;border-bottom:2px solid #ccc">${t('compareAvgDuration')}</th></tr></thead><tbody>${statsRows}</tbody></table>
<h3 style="margin-top:24px;font-size:13px">${t('compareDate')}</h3>
<table><thead><tr><th style="border:1px solid #ccc;padding:6px 10px;background:#f0f0f0">${t('compareDate')}</th>${headerCols}</tr><tr><th style="border:1px solid #ddd"></th>${subHeaderCols}</tr></thead><tbody>${bodyRows}</tbody></table>
</body></html>`);
    pw.document.close();
    pw.focus();
    pw.print();
  }, [results, allDates, t, locale]);

  const handleExportPdf = useCallback(async () => {
    if (!results || results.length === 0) return;

    const logo = await preloadLogo();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const localeStr = locale === 'de' ? 'de-DE' : 'pl-PL';
    const monthNames = locale === 'de'
      ? ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
      : ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

    // Group dates by month (YYYY-MM)
    const monthMap = new Map<string, string[]>();
    for (const date of allDates) {
      const ym = date.substring(0, 7); // YYYY-MM
      if (!monthMap.has(ym)) monthMap.set(ym, []);
      monthMap.get(ym)!.push(date);
    }
    const months = Array.from(monthMap.keys()).sort();

    // Weekend check helpers
    const isWeekendDate = (date: string) => {
      for (const r of results) {
        const sh = r.shifts.find((s) => s.date === date);
        if (sh) {
          const wd = localWd(sh.weekday, locale);
          return wd === 'So' || wd === 'Sa' || wd === 'Nd';
        }
      }
      return false;
    };

    const getWd = (date: string) => {
      for (const r of results) {
        const sh = r.shifts.find((s) => s.date === date);
        if (sh) return localWd(sh.weekday, locale);
      }
      return '';
    };

    // Table head for comparison (reused per month)
    const compHead = [
      [{ content: t('compareDate'), styles: { halign: 'left' as const } }, ...results.flatMap((r) => [{ content: r.driver_name, colSpan: 3 }])],
      [{ content: '', styles: { halign: 'left' as const } }, ...results.flatMap(() => [t('compareStart'), t('compareEnd'), t('compareDuration')])],
    ];

    // Colors
    const blue: [number, number, number] = [30, 64, 175];
    const greenText: [number, number, number] = [21, 128, 61];
    const redText: [number, number, number] = [220, 38, 38];
    const grayText: [number, number, number] = [100, 100, 100];
    const weekendBg: [number, number, number] = [254, 242, 242];

    // --- Page 1: Summary with branded header ---
    const driverNames = results.map((r) => r.driver_name).join(', ');
    addBrandedHeader(doc, logo, t('compareTitle'), `${driverNames} · ${dateFrom || '...'} — ${dateTo || '...'}`);

    // Stats table
    const statsHead = [[t('driversName'), t('compareTotalShifts'), t('compareAvgStart'), t('compareAvgEnd'), t('compareAvgDuration')]];
    const statsBody = driverStats.map((ds) => [ds.name, String(ds.totalShifts), ds.avgStart, ds.avgEnd, ds.avgDuration]);

    autoTable(doc, {
      startY: 26,
      head: statsHead,
      body: statsBody,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: blue, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { fontStyle: 'bold' },
        1: { halign: 'center' },
        2: { halign: 'center', textColor: greenText },
        3: { halign: 'center', textColor: redText },
        4: { halign: 'center', fontStyle: 'bold' },
      },
    });

    // --- One page per month ---
    for (const ym of months) {
      doc.addPage('a4', 'landscape');
      const [year, mon] = ym.split('-').map(Number);
      const monthLabel = `${monthNames[mon - 1]} ${year}`;

      // Header
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text(monthLabel, 14, 14);

      // Driver names on the right
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      const names = results.map((r) => r.driver_name).join('  |  ');
      doc.text(names, pageW - 14, 14, { align: 'right' });
      doc.setTextColor(0);

      const dates = monthMap.get(ym)!;

      const compBody = dates.map((date) => {
        const day = date.substring(8); // DD
        const wd = getWd(date);
        const dateCell = `${day} ${wd}`;
        const cells = results.flatMap((r) => {
          const sh = shiftLookup.get(r.driver_name)?.get(date);
          return sh ? [sh.start, sh.end, sh.duration_hm] : ['—', '—', '—'];
        });
        return [dateCell, ...cells];
      });

      autoTable(doc, {
        startY: 19,
        head: compHead,
        body: compBody,
        styles: { fontSize: 7, cellPadding: 1.8, halign: 'center', lineWidth: 0.1, lineColor: [220, 220, 220] },
        headStyles: { fillColor: blue, textColor: 255, fontStyle: 'bold', fontSize: 7, cellPadding: 2.5 },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 22 } },
        didParseCell: (data: any) => {
          if (data.section !== 'body') return;
          const rowDate = dates[data.row.index];
          if (!rowDate) return;

          // Weekend row background
          if (isWeekendDate(rowDate)) {
            data.cell.styles.fillColor = weekendBg;
          }

          // Color start/end/duration columns per driver
          const colIdx = data.column.index;
          if (colIdx === 0) return; // date column
          const posInGroup = (colIdx - 1) % 3;
          if (posInGroup === 0) data.cell.styles.textColor = greenText;      // start
          else if (posInGroup === 1) data.cell.styles.textColor = redText;   // end
          else data.cell.styles.textColor = grayText;                         // duration
        },
        margin: { left: 14, right: 14 },
      });

      // Month stats footer
      const dateSet = new Set(dates);
      const footerY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
      doc.setFontSize(7);
      doc.setTextColor(100);
      let footerX = 14;
      for (const r of results) {
        const fs = r.shifts.filter((sh) => dateSet.has(sh.date));
        const starts = fs.map((sh) => timeOnly(sh.start));
        const ends = fs.map((sh) => timeOnly(sh.end));
        const totalWork = fs.reduce((s, sh) => s + sh.work_minutes, 0);
        const avgDur = fs.length ? minutesToHm(Math.round(totalWork / fs.length)) : '—';
        const txt = `${r.driver_name}: ${fs.length} ${t('compareTotalShifts').toLowerCase()}, Ø ${avgTime(starts)}–${avgTime(ends)}, Ø ${avgDur}`;
        doc.text(txt, footerX, footerY);
        footerX += (pageW - 28) / results.length;
      }
    }

    addBrandedFooter(doc);
    const driverFileNames = results.map((r) => r.driver_name.split(' ')[0]).join('_');
    doc.save(`Vergleich_${driverFileNames}.pdf`);
  }, [results, allDates, driverStats, shiftLookup, t, locale, dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <Spinner size="lg" />
        <p className="text-sm text-muted dark:text-muted-dark">{t('loading')}</p>
      </div>
    );
  }

  const inputCls = 'input rounded-xl px-3 py-2 text-sm outline-none';

  return (
    <div className="animate-slide-up space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white">
          <GitCompareArrows size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('compareTitle')}</h1>
          <p className="text-xs text-muted dark:text-muted-dark">{t('compareSubtitle')}</p>
        </div>
      </div>

      {/* Driver selection */}
      <Card className="p-3 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:min-w-[200px] flex-1 sm:max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted dark:text-muted-dark" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('driversSearch')}
              className={`w-full pl-9 ${inputCls}`}
            />
          </div>
          <div className="flex-1" />
          {selected.size > 0 && (
            <Badge variant="blue">{selected.size} {t('driverSelected')}</Badge>
          )}
          <button
            onClick={handleGenerate}
            disabled={selected.size < 2 || comparing}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            <Play size={14} />
            {comparing ? t('compareLoading') : t('compareGenerate')}
          </button>
        </div>

        <div className="max-h-[280px] overflow-y-auto rounded-lg border border-border dark:border-border-dark">
          <div className="grid grid-cols-1 gap-1 bg-black/[0.04] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 dark:bg-white/5">
            {filtered.map((d) => (
              <label
                key={d.name}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg bg-white/50 px-3 py-2.5 transition hover:bg-blue-50/50 dark:bg-white/5 dark:hover:bg-blue-900/10 ${
                  selected.has(d.name) ? 'ring-2 ring-inset ring-blue-400 dark:ring-blue-600' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(d.name)}
                  onChange={() => toggleSelect(d.name)}
                  className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="truncate text-xs text-muted dark:text-muted-dark">{d.file_count} {t('files')}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </Card>

      {/* Comparing loader */}
      {comparing && (
        <div className="flex flex-col items-center gap-3 py-12">
          <Spinner size="lg" />
          <p className="text-sm text-muted dark:text-muted-dark">{t('compareLoading')}</p>
        </div>
      )}

      {/* Results */}
      {results && !comparing && results.length > 0 && (
        <>
          {/* Stats summary */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {driverStats.map((ds) => (
              <Card key={ds.name} className="p-4">
                <p className="text-sm font-bold">{ds.name}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted dark:text-muted-dark">{t('compareTotalShifts')}</span>
                  <span className="font-semibold">{ds.totalShifts}</span>
                  <span className="text-muted dark:text-muted-dark">{t('compareAvgStart')}</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{ds.avgStart}</span>
                  <span className="text-muted dark:text-muted-dark">{t('compareAvgEnd')}</span>
                  <span className="font-semibold text-rose-500 dark:text-rose-400">{ds.avgEnd}</span>
                  <span className="text-muted dark:text-muted-dark">{t('compareAvgDuration')}</span>
                  <span className="font-semibold">{ds.avgDuration}</span>
                </div>
              </Card>
            ))}
          </div>

          {/* Comparison table */}
          <Card className="overflow-hidden">
            {/* Mobile: per-date cards */}
            <div className="block sm:hidden divide-y divide-border dark:divide-border-dark">
              {allDates.map((date) => {
                let wd = '';
                for (const r of results) {
                  const sh = r.shifts.find((s) => s.date === date);
                  if (sh) { wd = localWd(sh.weekday, locale); break; }
                }
                const isWeekend = wd === 'So' || wd === 'Sa' || wd === 'Nd';
                return (
                  <div key={date} className={`p-4 space-y-2 ${isWeekend ? 'bg-rose-50/30 dark:bg-rose-900/5' : ''}`}>
                    <p className="text-sm font-bold">
                      {date}
                      <span className={`ml-2 text-xs ${isWeekend ? 'font-bold text-rose-400' : 'text-muted dark:text-muted-dark'}`}>{wd}</span>
                    </p>
                    {results.map((r) => {
                      const sh = shiftLookup.get(r.driver_name)?.get(date);
                      if (!sh) return null;
                      return (
                        <div key={r.driver_name} className="flex items-center justify-between gap-2 rounded-lg bg-black/[0.02] px-3 py-1.5 dark:bg-white/5">
                          <span className="text-xs font-medium truncate">{r.driver_name}</span>
                          <div className="flex items-center gap-3 text-xs shrink-0">
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{sh.start}</span>
                            <span className="text-gray-300 dark:text-gray-600">→</span>
                            <span className="font-semibold text-rose-500 dark:text-rose-400">{sh.end}</span>
                            <span className="text-muted dark:text-muted-dark">{sh.duration_hm}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-white/20 dark:border-white/5">
                    <th className="sticky left-0 z-10 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-muted dark:text-muted-dark">
                      {t('compareDate')}
                    </th>
                    {results.map((r) => (
                      <th key={r.driver_name} colSpan={3} className="border-l border-white/20 px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-gray-700 dark:border-white/10 dark:text-gray-300">
                        {r.driver_name}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-white/10 dark:border-white/5">
                    <th className="sticky left-0 z-10" />
                    {results.map((r) => (
                      <th key={r.driver_name} className="border-l border-white/10 dark:border-white/5" colSpan={3}>
                        <div className="flex">
                          <span className="flex-1 px-2 py-1.5 text-center text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400">{t('compareStart')}</span>
                          <span className="flex-1 px-2 py-1.5 text-center text-xs font-semibold uppercase text-rose-500 dark:text-rose-400">{t('compareEnd')}</span>
                          <span className="flex-1 px-2 py-1.5 text-center text-xs font-semibold uppercase text-gray-500 dark:text-muted dark:text-muted-dark">{t('compareDuration')}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border dark:divide-border-dark">
                  {allDates.map((date) => {
                    // Determine weekday from first result that has this date
                    let wd = '';
                    for (const r of results) {
                      const sh = r.shifts.find((s) => s.date === date);
                      if (sh) { wd = localWd(sh.weekday, locale); break; }
                    }
                    const isWeekend = wd === 'So' || wd === 'Sa' || wd === 'Nd';

                    return (
                      <tr key={date} className={isWeekend ? 'bg-rose-50/30 dark:bg-rose-900/5' : 'hover:bg-surface dark:hover:bg-surface-dark'}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-white/80 backdrop-blur-sm px-4 py-2 dark:bg-[#1a1a2e]/90">
                          <span className="font-medium">{date}</span>
                          <span className={`ml-2 text-xs font-bold ${isWeekend ? 'text-rose-400' : 'text-muted dark:text-muted-dark'}`}>{wd}</span>
                        </td>
                        {results.map((r) => {
                          const sh = shiftLookup.get(r.driver_name)?.get(date);
                          if (!sh) {
                            return (
                              <td key={r.driver_name} colSpan={3} className="border-l border-white/10 px-2 py-2 text-center text-gray-300 dark:border-white/5 dark:text-gray-700">
                                —
                              </td>
                            );
                          }
                          return (
                            <td key={r.driver_name} colSpan={3} className="border-l border-white/10 dark:border-white/5">
                              <div className="flex">
                                <span className="flex-1 px-2 py-2 text-center font-semibold text-emerald-700 dark:text-emerald-400">{sh.start}</span>
                                <span className="flex-1 px-2 py-2 text-center font-semibold text-rose-600 dark:text-rose-400">{sh.end}</span>
                                <span className="flex-1 px-2 py-2 text-center text-gray-600 dark:text-muted dark:text-muted-dark">{sh.duration_hm}</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Print & PDF buttons */}
          <div className="flex justify-center gap-3 pt-2">
            <button
              onClick={handleExportPdf}
              className="flex min-h-[44px] items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
            >
              <FileDown size={16} />
              {t('compareExportPdf')}
            </button>
            <button
              onClick={handlePrint}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border dark:border-border-dark px-5 py-2.5 text-sm font-semibold text-muted dark:text-muted-dark transition hover:bg-surface dark:hover:bg-surface-dark"
            >
              <Printer size={16} />
              {t('comparePrint')}
            </button>
          </div>
        </>
      )}

      {/* Empty state */}
      {!results && !comparing && (
        <p className="py-12 text-center text-sm text-muted dark:text-muted-dark">{t('compareNoData')}</p>
      )}
    </div>
  );
}

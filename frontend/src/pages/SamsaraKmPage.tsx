import { useState, useMemo, useCallback, useRef } from 'react';
import { Upload, AlertCircle, Truck, ChevronDown, ChevronRight, X, FileText, Download, Sun, Moon, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { exportSamsaraKmToXlsx } from '../lib/xlsx-export';

// ─── Types ───

interface SamsaraRow {
  vehicle: string;
  ts: Date;          // parsed timestamp
  speed: number;     // km/h
  odometer: number;  // km counter
  location: string;
  status: string;
  raw: Record<string, string>;
}

interface VehicleDaySummary {
  date: string;        // YYYY-MM-DD
  dayKm: number;
  nightKm: number;
  totalKm: number;
  odoStart: number;
  odoEnd: number;
  firstTime: string;   // HH:MM
  lastTime: string;    // HH:MM
}

interface VehicleSummary {
  vehicle: string;
  days: VehicleDaySummary[];
  totalDayKm: number;
  totalNightKm: number;
  totalKm: number;
}

// ─── CSV Parsing ───

function parseSamsaraTimestamp(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // Excel serial date number (e.g. "45689.3" or "45689.29861111")
  const serialMatch = s.match(/^(\d{4,5})(\.\d+)?$/);
  if (serialMatch) {
    const serial = parseFloat(s);
    if (serial > 40000 && serial < 60000) {
      // Excel epoch: Jan 0, 1900 (with the 1900 bug offset)
      const epoch = new Date(1899, 11, 30);
      const ms = epoch.getTime() + serial * 86400000;
      return new Date(ms);
    }
  }

  // Try ISO-like: YYYY-MM-DD HH:MM
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (isoMatch) {
    return new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3], +isoMatch[4], +isoMatch[5]);
  }

  // ISO date+time with T: YYYY-MM-DDTHH:MM
  const isoTMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})/);
  if (isoTMatch) {
    return new Date(+isoTMatch[1], +isoTMatch[2] - 1, +isoTMatch[3], +isoTMatch[4], +isoTMatch[5]);
  }

  // Try German: DD.MM.YYYY HH:MM
  const deMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (deMatch) {
    return new Date(+deMatch[3], +deMatch[2] - 1, +deMatch[1], +deMatch[4], +deMatch[5]);
  }

  // US format: MM/DD/YYYY HH:MM
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (usMatch) {
    return new Date(+usMatch[3], +usMatch[1] - 1, +usMatch[2], +usMatch[4], +usMatch[5]);
  }

  // Samsara short: "Mon DD HH:MM" or "Mon DD, YYYY HH:MM" or "Mon DD YYYY HH:MM"
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const shortMatch = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s*(\d{4})?\s+(\d{1,2}):(\d{2})/);
  if (shortMatch) {
    const mon = months[shortMatch[1].toLowerCase()];
    if (mon !== undefined) {
      const year = shortMatch[3] ? +shortMatch[3] : new Date().getFullYear();
      return new Date(year, mon, +shortMatch[2], +shortMatch[4], +shortMatch[5]);
    }
  }

  // Fallback: try native Date.parse for any other format
  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;

  return null;
}

function parseNumber(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[^\d.,-]/g, '').replace(/,/g, '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function rowsFromCells(headers: string[], dataRows: string[][]): SamsaraRow[] {
  const lower = headers.map(h => h.toLowerCase());

  const findCol = (...patterns: string[]) =>
    lower.findIndex(h => patterns.some(p => h.includes(p)));

  const vehicleCol = findCol('pojazd', 'vehicle', 'fahrzeug', 'asset');
  const timeCol = findCol('czas', 'time', 'zeit', 'timestamp', 'date');
  const speedCol = findCol('prędkość', 'predkosc', 'speed', 'geschwindigkeit');
  const odometerCol = findCol('licznik', 'odometer', 'kilometerstand', 'counter');
  const locationCol = findCol('lokalizacja', 'location', 'standort', 'adres');
  const statusCol = findCol('status');

  if (vehicleCol === -1 || timeCol === -1 || odometerCol === -1) {
    throw new Error('Nie znaleziono wymaganych kolumn (Pojazd, Czas, Licznik)');
  }

  const rows: SamsaraRow[] = [];
  for (const cells of dataRows) {
    if (cells.length < 3) continue;

    const g = (idx: number) => (idx >= 0 && idx < cells.length) ? cells[idx] : '';

    const vehicle = g(vehicleCol);
    const tsRaw = g(timeCol);
    const ts = parseSamsaraTimestamp(tsRaw);
    if (!vehicle || !ts) continue;

    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => { raw[h] = cells[idx] || ''; });

    rows.push({
      vehicle,
      ts,
      speed: speedCol >= 0 ? parseNumber(g(speedCol)) : 0,
      odometer: parseNumber(g(odometerCol)),
      location: locationCol >= 0 ? g(locationCol) : '',
      status: statusCol >= 0 ? g(statusCol) : '',
      raw,
    });
  }

  return rows.sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

function parseSamsaraCSV(text: string): SamsaraRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  const headers = lines[0].split(delim).map(h => h.replace(/^["']|["']$/g, '').trim());
  const dataRows = lines.slice(1).map(line =>
    line.split(delim).map(c => c.replace(/^["']|["']$/g, '').trim())
  );

  return rowsFromCells(headers, dataRows);
}

function parseSamsaraXlsx(buffer: ArrayBuffer): SamsaraRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Pusty plik Excel');
  const ws = wb.Sheets[sheetName];

  // Convert to array of arrays (all as strings)
  const aoa: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][];
  if (aoa.length < 2) throw new Error('Za mało danych w pliku');

  const headers = aoa[0].map(h => String(h).trim());
  const dataRows = aoa.slice(1).map(row => row.map(c => String(c ?? '').trim()));

  return rowsFromCells(headers, dataRows);
}

// ─── Day/Night KM Calculation ───

function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtTime(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function isDayTime(d: Date, dayStart: number, dayEnd: number): boolean {
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= dayStart && h < dayEnd;
}

function computeVehicleSummaries(
  rows: SamsaraRow[],
  dayStartHour: number,
  dayEndHour: number,
): VehicleSummary[] {
  // Group by vehicle
  const byVehicle = new Map<string, SamsaraRow[]>();
  for (const r of rows) {
    const key = r.vehicle;
    if (!byVehicle.has(key)) byVehicle.set(key, []);
    byVehicle.get(key)!.push(r);
  }

  const summaries: VehicleSummary[] = [];

  for (const [vehicle, vehicleRows] of byVehicle) {
    // Group by date
    const byDate = new Map<string, SamsaraRow[]>();
    for (const r of vehicleRows) {
      const dateKey = fmtDate(r.ts);
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey)!.push(r);
    }

    const days: VehicleDaySummary[] = [];
    let totalDayKm = 0;
    let totalNightKm = 0;

    const sortedDates = Array.from(byDate.keys()).sort();
    for (const date of sortedDates) {
      const dayRows = byDate.get(date)!.sort((a, b) => a.ts.getTime() - b.ts.getTime());
      if (dayRows.length < 2) continue;

      let dayKm = 0;
      let nightKm = 0;

      for (let i = 1; i < dayRows.length; i++) {
        const delta = dayRows[i].odometer - dayRows[i - 1].odometer;
        if (delta <= 0 || delta > 500) continue; // skip anomalies

        // Assign to day or night based on the midpoint time
        const midTime = new Date((dayRows[i - 1].ts.getTime() + dayRows[i].ts.getTime()) / 2);
        if (isDayTime(midTime, dayStartHour, dayEndHour)) {
          dayKm += delta;
        } else {
          nightKm += delta;
        }
      }

      const odoStart = dayRows[0].odometer;
      const odoEnd = dayRows[dayRows.length - 1].odometer;
      const totalKmDay = dayKm + nightKm;

      if (totalKmDay > 0) {
        days.push({
          date,
          dayKm: Math.round(dayKm * 10) / 10,
          nightKm: Math.round(nightKm * 10) / 10,
          totalKm: Math.round(totalKmDay * 10) / 10,
          odoStart,
          odoEnd,
          firstTime: fmtTime(dayRows[0].ts),
          lastTime: fmtTime(dayRows[dayRows.length - 1].ts),
        });
        totalDayKm += dayKm;
        totalNightKm += nightKm;
      }
    }

    if (days.length > 0) {
      summaries.push({
        vehicle,
        days,
        totalDayKm: Math.round(totalDayKm * 10) / 10,
        totalNightKm: Math.round(totalNightKm * 10) / 10,
        totalKm: Math.round((totalDayKm + totalNightKm) * 10) / 10,
      });
    }
  }

  return summaries.sort((a, b) => a.vehicle.localeCompare(b.vehicle));
}

// ─── Formatters ───

function fmtKm(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// ─── Component ───

export function SamsaraKmPage() {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<SamsaraRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  // Configurable day/night hours
  const [dayStart, setDayStart] = useState(6);
  const [dayEnd, setDayEnd] = useState(22);

  // UI state
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());

  const summaries = useMemo(
    () => computeVehicleSummaries(rows, dayStart, dayEnd),
    [rows, dayStart, dayEnd],
  );

  const grandDayKm = useMemo(() => summaries.reduce((s, v) => s + v.totalDayKm, 0), [summaries]);
  const grandNightKm = useMemo(() => summaries.reduce((s, v) => s + v.totalNightKm, 0), [summaries]);
  const grandTotalKm = useMemo(() => summaries.reduce((s, v) => s + v.totalKm, 0), [summaries]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setFileName(file.name);

    const isXlsx = /\.xlsx?$/i.test(file.name);

    if (isXlsx) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const buffer = ev.target?.result as ArrayBuffer;
          const parsed = parseSamsaraXlsx(buffer);
          if (parsed.length === 0) { setError(t('samNoData')); return; }
          setRows(parsed);
          setExpandedVehicles(new Set());
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target?.result as string;
          const parsed = parseSamsaraCSV(text);
          if (parsed.length === 0) { setError(t('samNoData')); return; }
          setRows(parsed);
          setExpandedVehicles(new Set());
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      };
      reader.readAsText(file, 'utf-8');
    }
  }, [t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    if (fileInputRef.current) {
      fileInputRef.current.files = dt.files;
      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, []);

  const toggleVehicle = (v: string) => {
    setExpandedVehicles(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  const handleExportExcel = () => {
    if (summaries.length === 0) return;
    exportSamsaraKmToXlsx(summaries, dayStart, dayEnd, 'LTS Logistik GmbH');
  };

  const dayLabel = `${pad2(dayStart)}:00–${pad2(dayEnd)}:00`;
  const nightLabel = `${pad2(dayEnd)}:00–${pad2(dayStart)}:00`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t('samTitle')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('samSubtitle')}
        </p>
      </div>

      {/* Upload area */}
      {rows.length === 0 && (
        <Card>
          <div
            className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload className="w-12 h-12 text-gray-400 dark:text-gray-500 mb-4" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
              {t('samUpload')}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {t('samUploadHint')}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.xlsx"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Results */}
      {rows.length > 0 && (
        <>
          {/* File info + day/night config */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <FileText className="w-4 h-4" />
              <span className="font-medium">{fileName}</span>
              <span>— {rows.length} {t('samRows')}</span>
            </div>
            <button
              onClick={() => { setRows([]); setFileName(''); setError(''); }}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 transition-colors"
            >
              <X className="w-3 h-3" /> {t('samNewFile')}
            </button>
          </div>

          {/* Day/Night hour config */}
          <Card>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Clock className="w-4 h-4" />
                {t('samHoursConfig')}
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Sun className="w-4 h-4 text-amber-500" />
                  <label className="text-xs text-gray-500 dark:text-gray-400">{t('samDayStart')}</label>
                  <select
                    value={dayStart}
                    onChange={e => setDayStart(+e.target.value)}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{pad2(i)}:00</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Moon className="w-4 h-4 text-indigo-500" />
                  <label className="text-xs text-gray-500 dark:text-gray-400">{t('samDayEnd')}</label>
                  <select
                    value={dayEnd}
                    onChange={e => setDayEnd(+e.target.value)}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{pad2(i)}:00</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  <span className="inline-flex items-center gap-1"><Sun className="w-3 h-3 text-amber-500" /> {dayLabel}</span>
                  {' / '}
                  <span className="inline-flex items-center gap-1"><Moon className="w-3 h-3 text-indigo-500" /> {nightLabel}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-gray-500 dark:text-gray-400">{t('samVehicles')}</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">{summaries.length}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
                  <Sun className="w-3 h-3 text-amber-500" /> {t('samDayKm')}
                </div>
                <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">{fmtKm(grandDayKm)} km</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
                  <Moon className="w-3 h-3 text-indigo-500" /> {t('samNightKm')}
                </div>
                <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{fmtKm(grandNightKm)} km</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-gray-500 dark:text-gray-400">{t('samTotalKm')}</div>
                <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{fmtKm(grandTotalKm)} km</div>
              </div>
            </Card>
          </div>

          {/* Export button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {t('samExportExcel')}
            </button>
          </div>

          {/* Vehicle table */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="w-8 px-3 py-3" />
                    <th className="text-left px-3 py-3 font-semibold text-gray-600 dark:text-gray-300">
                      {t('samVehicle')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-600 dark:text-gray-300">
                      {t('samDate')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-600 dark:text-gray-300 hidden sm:table-cell">
                      {t('samTime')}
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-amber-600 dark:text-amber-400">
                      <span className="inline-flex items-center gap-1"><Sun className="w-3 h-3" /> km</span>
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-indigo-600 dark:text-indigo-400">
                      <span className="inline-flex items-center gap-1"><Moon className="w-3 h-3" /> km</span>
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-gray-600 dark:text-gray-300">
                      {t('samTotalKm')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((vs) => {
                    const isExpanded = expandedVehicles.has(vs.vehicle);
                    return (
                      <>
                        {/* Vehicle summary row */}
                        <tr
                          key={`v-${vs.vehicle}`}
                          className="border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 font-medium"
                          onClick={() => toggleVehicle(vs.vehicle)}
                        >
                          <td className="px-3 py-3 text-gray-400">
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4" />
                              : <ChevronRight className="w-4 h-4" />}
                          </td>
                          <td className="px-3 py-3 text-gray-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <Truck className="w-4 h-4 text-gray-400" />
                              <span className="font-mono">{vs.vehicle}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-gray-500 dark:text-gray-400 text-xs" colSpan={1}>
                            {vs.days.length} {t('samDaysCount')}
                          </td>
                          <td className="px-3 py-3 hidden sm:table-cell" />
                          <td className="px-3 py-3 text-right font-bold text-amber-600 dark:text-amber-400 font-mono">
                            {fmtKm(vs.totalDayKm)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                            {fmtKm(vs.totalNightKm)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-blue-600 dark:text-blue-400 font-mono">
                            {fmtKm(vs.totalKm)}
                          </td>
                        </tr>

                        {/* Expanded day rows */}
                        {isExpanded && vs.days.map((d) => (
                          <tr
                            key={`${vs.vehicle}-${d.date}`}
                            className="border-b border-gray-50 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 text-xs"
                          >
                            <td className="px-3 py-2" />
                            <td className="px-3 py-2 text-gray-400 font-mono">
                              {d.odoStart} → {d.odoEnd}
                            </td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                              {d.date}
                            </td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                              {d.firstTime}–{d.lastTime}
                            </td>
                            <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400 font-mono">
                              {d.dayKm > 0 ? fmtKm(d.dayKm) : '–'}
                            </td>
                            <td className="px-3 py-2 text-right text-indigo-600 dark:text-indigo-400 font-mono">
                              {d.nightKm > 0 ? fmtKm(d.nightKm) : '–'}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300 font-mono">
                              {fmtKm(d.totalKm)}
                            </td>
                          </tr>
                        ))}
                      </>
                    );
                  })}

                  {/* Grand total */}
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-bold">
                    <td className="px-3 py-3" />
                    <td className="px-3 py-3 text-gray-900 dark:text-white">
                      RAZEM
                    </td>
                    <td className="px-3 py-3 text-gray-500 text-xs">
                      {summaries.length} {t('samVehiclesCount')}
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell" />
                    <td className="px-3 py-3 text-right text-amber-700 dark:text-amber-300 font-mono text-base">
                      {fmtKm(grandDayKm)}
                    </td>
                    <td className="px-3 py-3 text-right text-indigo-700 dark:text-indigo-300 font-mono text-base">
                      {fmtKm(grandNightKm)}
                    </td>
                    <td className="px-3 py-3 text-right text-blue-700 dark:text-blue-300 font-mono text-base">
                      {fmtKm(grandTotalKm)} km
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

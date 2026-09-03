import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Upload, Search, AlertCircle, Truck, Calendar, ChevronDown, ChevronRight, X, FileText, CloudUpload, FolderOpen, Trash2, Loader2, Download, CheckSquare, Square } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import {
  fetchTollCollectFiles,
  uploadTollCollectFile,
  downloadTollCollectFile,
  deleteTollCollectFile,
  type TollCollectFile,
} from '../lib/api';
import type { TollVehicleGroup } from '../lib/xlsx-export';
import { exportDachserMaut, exportDachserLkw } from '../lib/dachser-export';

interface TollRow {
  plate: string;
  date: string;
  time: string;
  bookingNr: string;
  type: string;
  route: string;
  axleClass: string;
  weightClass: string;
  emissionClass: string;
  co2Class: string;
  bookingType: string;
  km: number;
  amount: number;
  statementNr: string;
  raw: Record<string, string>;
}

// Auto-detect column mapping from headers
function detectColumns(headers: string[]) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const find = (...patterns: string[]) =>
    lower.findIndex(h => patterns.some(p => h.includes(p)));

  return {
    plate: find('kennz', 'plate', 'kfz'),
    date: find('datum', 'date'),
    time: find('start', 'uhrzeit', 'zeit', 'time'),
    bookingNr: find('buchungsnummer', 'einbuchungsnummer', 'booking'),
    type: lower.findIndex(h => h === 'art' || h === 'type'),
    route: find('strecke', 'route', 'mautpflichtige strecke'),
    axleClass: find('achsklasse', 'achs', 'axle'),
    weightClass: find('gewichtsklasse', 'gewicht', 'weight'),
    emissionClass: find('schadstoffklasse', 'schadstoff', 'emission'),
    co2Class: find('co2', 'co₂'),
    bookingType: find('einbuchungsart', 'buchungsart'),
    km: find('kilometer', 'km', 'mautpflichtige kilometer'),
    amount: find('mautbetrag', 'betrag', 'maut', 'amount', 'eur'),
    statementNr: find('mautaufstellung', 'nummer der mautaufstellung', 'statement'),
  };
}

function parseGermanNumber(s: string): number {
  if (!s) return 0;
  // German format: 1.234,56 -> 1234.56
  const cleaned = s.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseCSV(text: string): TollRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter: semicolon or comma
  const firstLine = lines[0];
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  // Find the header row (skip metadata rows that don't have enough columns)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cols = lines[i].split(delim);
    if (cols.length >= 5) {
      const lower = cols.map(c => c.toLowerCase().trim());
      if (lower.some(c => c.includes('kennz') || c.includes('plate') || c.includes('kfz') || c.includes('datum'))) {
        headerIdx = i;
        break;
      }
    }
  }

  const headers = lines[headerIdx].split(delim).map(h => h.replace(/^["']|["']$/g, '').trim());
  const cols = detectColumns(headers);

  const rows: TollRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = lines[i].split(delim).map(c => c.replace(/^["']|["']$/g, '').trim());
    if (cells.length < 3) continue;

    const g = (idx: number) => (idx >= 0 && idx < cells.length) ? cells[idx] : '';

    const plate = g(cols.plate);
    const dateStr = g(cols.date);
    if (!plate && !dateStr) continue; // skip empty rows

    // Parse date: could be DD.MM.YYYY or YYYY-MM-DD
    let isoDate = dateStr;
    const dmMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dmMatch) {
      isoDate = `${dmMatch[3]}-${dmMatch[2].padStart(2, '0')}-${dmMatch[1].padStart(2, '0')}`;
    }

    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => { raw[h] = cells[idx] || ''; });

    rows.push({
      plate,
      date: isoDate,
      time: g(cols.time),
      bookingNr: g(cols.bookingNr),
      type: g(cols.type),
      route: g(cols.route),
      axleClass: g(cols.axleClass),
      weightClass: g(cols.weightClass),
      emissionClass: g(cols.emissionClass),
      co2Class: g(cols.co2Class),
      bookingType: g(cols.bookingType),
      km: parseGermanNumber(g(cols.km)),
      amount: parseGermanNumber(g(cols.amount)),
      statementNr: g(cols.statementNr),
      raw,
    });
  }

  return rows;
}

// Plates come formatted differently in Toll Collect CSV vs the tour-plan
// Excel ("TF-LS 2213" vs "TFLS 2213") — compare on alphanumerics only.
function normPlate(p: string): string {
  return p.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function fmtEur(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20AC';
}

function fmtKm(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface LoadedMonth {
  period: string; // YYYY-MM
  rows: TollRow[];
  fileName: string;
  file: File | null; // null if loaded from Dropbox
}

export function TollCollectPage() {
  const { t, locale } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Multi-month state
  const [months, setMonths] = useState<LoadedMonth[]>([]);
  const [error, setError] = useState('');

  // Tours per vehicle
  const [tours, setTours] = useState<Record<string, string>>({});

  // Per-vehicle custom date ranges for export
  const [vehicleDateRanges, setVehicleDateRanges] = useState<Record<string, { from: string; to: string }>>({});
  // Extra tours: the same vehicle ran several tours — each gets its own
  // name + days and becomes a separate position in the export.
  const [extraTours, setExtraTours] = useState<Record<string, { tour: string; from: string; to: string }[]>>({});
  // Tour plan from the monthly Excel (Monatsbericht Details):
  // "NORMPLATE|YYYY-MM-DD" -> tour number/name. Day-accurate — the export
  // splits a vehicle's toll by the tour it actually drove each day.
  const [tourPlan, setTourPlan] = useState<Record<string, string>>({});
  const [tourPlanInfo, setTourPlanInfo] = useState<{ files: string[]; entries: number; plates: number; from: string; to: string } | null>(null);
  // When on: export counts ONLY days with an assigned tour — no
  // "(ohne Tour)" positions, and vehicles absent from the plan are skipped.
  const [onlyTourDays, setOnlyTourDays] = useState(false);
  const tourPlanInputRef = useRef<HTMLInputElement>(null);

  // One Monatsbericht per month — uploads MERGE, so several months can be
  // loaded alongside several toll CSV months.
  const handleTourPlanUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    try {
      const XLSX = await import('xlsx');
      const toIso = (v: unknown): string => {
        if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
        if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
        const s = String(v ?? '').trim();
        const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
        if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        return '';
      };
      const added: Record<string, string> = {};
      for (const file of files) {
        const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        const hIdx = rows.findIndex(r => Array.isArray(r)
          && r.some(c => /datum/i.test(String(c)))
          && r.some(c => /fahrzeug|kennzeichen/i.test(String(c)))
          && r.some(c => /tour/i.test(String(c))));
        if (hIdx < 0) throw new Error(`${file.name}: ${locale === 'de' ? 'Spalten Datum/Tour/Fahrzeug nicht gefunden' : 'nie znaleziono kolumn Datum/Tour/Fahrzeug'}`);
        const header = rows[hIdx].map(c => String(c ?? '').toLowerCase());
        const ci = {
          date: header.findIndex(h => h.includes('datum')),
          tour: header.findIndex(h => h.includes('tour')),
          plate: header.findIndex(h => h.includes('fahrzeug') || h.includes('kennzeichen')),
        };
        for (const r of rows.slice(hIdx + 1)) {
          if (!Array.isArray(r)) continue;
          const date = toIso(r[ci.date]);
          const plate = normPlate(String(r[ci.plate] ?? ''));
          const tour = String(r[ci.tour] ?? '').trim();
          if (!date || !plate || !tour) continue;
          added[`${plate}|${date}`] = tour;
        }
      }
      if (Object.keys(added).length === 0) throw new Error(locale === 'de' ? 'Keine Zuordnungen in den Dateien' : 'Brak przypisań w plikach');
      const merged = { ...tourPlan, ...added };
      const plates = new Set<string>();
      let from = ''; let to = '';
      for (const key of Object.keys(merged)) {
        const [plate, date] = key.split('|');
        plates.add(plate);
        if (!from || date < from) from = date;
        if (!to || date > to) to = date;
      }
      setTourPlan(merged);
      setTourPlanInfo(prev => ({
        files: [...(prev?.files || []), ...files.map(f => f.name)],
        entries: Object.keys(merged).length,
        plates: plates.size,
        from,
        to,
      }));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [locale, tourPlan]);

  // Dropbox state
  const [dbxFiles, setDbxFiles] = useState<TollCollectFile[]>([]);
  const [dbxLoading, setDbxLoading] = useState(false);
  const [dbxSaving, setDbxSaving] = useState<string | null>(null); // period being saved
  const [dbxSavedPeriods, setDbxSavedPeriods] = useState<Set<string>>(new Set());
  const [dbxDownloading, setDbxDownloading] = useState<string | null>(null);
  const [dbxError, setDbxError] = useState('');
  const [showDbxFiles, setShowDbxFiles] = useState(false);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');

  // Expanded vehicles
  const [expandedPlates, setExpandedPlates] = useState<Set<string>>(new Set());

  // Selected vehicles for Excel export
  const [selectedPlates, setSelectedPlates] = useState<Set<string>>(new Set());
  const [showMonthDiff, setShowMonthDiff] = useState(false);
  const [addExtras, setAddExtras] = useState(false);
  const [dailyRate, setDailyRate] = useState(8);
  const [kmRate, setKmRate] = useState(0.30);
  const [splitDayNight, setSplitDayNight] = useState(false);
  const [nightStart, setNightStart] = useState('22:00');
  const [nightEnd, setNightEnd] = useState('06:00');
  const [splitPlates, setSplitPlates] = useState<Set<string>>(new Set());
  // Per-plate day/night tour numbers when split is active
  const [splitTours, setSplitTours] = useState<Record<string, { day: string; night: string }>>({});
  // Per-plate excluded months (e.g. "2026-02") — only applies when > 2 months loaded
  const [excludedMonths, setExcludedMonths] = useState<Record<string, Set<string>>>({});
  // Per-plate excluded single days (ISO YYYY-MM-DD) — vehicle drove something
  // else that day, so its toll must not be billed to the contractor.
  const [excludedDays, setExcludedDays] = useState<Record<string, Set<string>>>({});
  const [cityName, setCityName] = useState('');
  const [auftragNr, setAuftragNr] = useState('');
  const [dachserMsg, setDachserMsg] = useState('');

  // All rows merged from all months
  const allRows = useMemo(() => months.flatMap(m => m.rows), [months]);

  // Load Dropbox file list
  const loadDbxFiles = useCallback(async () => {
    setDbxLoading(true);
    setDbxError('');
    try {
      const res = await fetchTollCollectFiles();
      setDbxFiles(res.files);
    } catch (err) {
      setDbxError(err instanceof Error ? err.message : String(err));
    } finally {
      setDbxLoading(false);
    }
  }, []);

  // Load on first open
  useEffect(() => {
    if (showDbxFiles && dbxFiles.length === 0 && !dbxLoading) {
      loadDbxFiles();
    }
  }, [showDbxFiles, dbxFiles.length, dbxLoading, loadDbxFiles]);

  const addFileAsMonth = useCallback((file: File, fileObj: File | null = file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length === 0) {
          setError('Nie znaleziono danych w pliku CSV');
          return;
        }
        // Auto-detect period from first date
        const firstDate = parsed.find(r => r.date)?.date || '';
        const period = firstDate.length >= 7 ? firstDate.slice(0, 7) : new Date().toISOString().slice(0, 7);

        setMonths(prev => {
          // Replace if same period exists, otherwise add
          const filtered = prev.filter(m => m.period !== period);
          return [...filtered, { period, rows: parsed, fileName: file.name, file: fileObj }]
            .sort((a, b) => a.period.localeCompare(b.period));
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file, 'utf-8');
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError('');
    for (let i = 0; i < files.length; i++) {
      addFileAsMonth(files[i]);
    }
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [addFileAsMonth]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setError('');
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      addFileAsMonth(files[i]);
    }
  }, [addFileAsMonth]);

  // Save specific month to Dropbox
  const handleSaveToDropbox = useCallback(async (month: LoadedMonth) => {
    if (!month.file) return;
    setDbxSaving(month.period);
    setDbxError('');
    try {
      await uploadTollCollectFile(month.file, month.period || undefined);
      setDbxSavedPeriods(prev => new Set([...prev, month.period]));
      if (showDbxFiles) loadDbxFiles();
    } catch (err) {
      setDbxError(err instanceof Error ? err.message : String(err));
    } finally {
      setDbxSaving(null);
    }
  }, [showDbxFiles, loadDbxFiles]);

  // Load file from Dropbox — adds as a month
  const handleLoadFromDropbox = useCallback(async (path: string, name: string) => {
    setDbxDownloading(path);
    setDbxError('');
    setError('');
    try {
      const res = await downloadTollCollectFile(path);
      const parsed = parseCSV(res.content);
      if (parsed.length === 0) {
        setError('Nie znaleziono danych w pliku CSV');
        return;
      }
      const firstDate = parsed.find(r => r.date)?.date || '';
      const period = firstDate.length >= 7 ? firstDate.slice(0, 7) : new Date().toISOString().slice(0, 7);

      setMonths(prev => {
        const filtered = prev.filter(m => m.period !== period);
        return [...filtered, { period, rows: parsed, fileName: name, file: null }]
          .sort((a, b) => a.period.localeCompare(b.period));
      });
      setDbxSavedPeriods(prev => new Set([...prev, period]));
    } catch (err) {
      setDbxError(err instanceof Error ? err.message : String(err));
    } finally {
      setDbxDownloading(null);
    }
  }, []);

  // Delete file from Dropbox
  const handleDeleteFromDropbox = useCallback(async (path: string) => {
    if (!confirm(t('tollDbxDeleteConfirm'))) return;
    setDbxError('');
    try {
      await deleteTollCollectFile(path);
      setDbxFiles(prev => prev.filter(f => f.path !== path));
    } catch (err) {
      setDbxError(err instanceof Error ? err.message : String(err));
    }
  }, [t]);

  // Filtered rows
  const filtered = useMemo(() => {
    const q = searchText.toLowerCase().trim();
    return allRows.filter(r => {
      if (q) {
        const haystack = r.plate.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      if (timeFrom && timeTo && timeFrom > timeTo) {
        // Overnight range (e.g. 16:01 → 04:59): include if time >= from OR time <= to
        if (r.time < timeFrom && r.time > timeTo) return false;
      } else {
        if (timeFrom && r.time < timeFrom) return false;
        if (timeTo && r.time > timeTo) return false;
      }
      return true;
    });
  }, [allRows, searchText, dateFrom, dateTo, timeFrom, timeTo]);

  // Group by vehicle
  const byVehicle = useMemo(() => {
    const map = new Map<string, {
      rows: TollRow[]; totalKm: number; totalAmount: number;
      excludedKm: number; excludedAmount: number; excludedDayCount: number;
    }>();
    for (const r of filtered) {
      const key = r.plate || '(brak)';
      if (!map.has(key)) map.set(key, { rows: [], totalKm: 0, totalAmount: 0, excludedKm: 0, excludedAmount: 0, excludedDayCount: 0 });
      const entry = map.get(key)!;
      entry.rows.push(r);
      if (excludedDays[key]?.has(r.date)) {
        entry.excludedKm += r.km;
        entry.excludedAmount += r.amount;
      } else {
        entry.totalKm += r.km;
        entry.totalAmount += r.amount;
      }
    }
    for (const [key, entry] of map) {
      entry.excludedDayCount = excludedDays[key]?.size || 0;
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, excludedDays]);

  // Auto-select vehicles that appear in the uploaded tour plan — also when
  // toll CSVs get loaded after the plan. Only adds, never unticks.
  useEffect(() => {
    if (!tourPlanInfo) return;
    const planPlates = new Set(Object.keys(tourPlan).map(k => k.split('|')[0]));
    setSelectedPlates(prev => {
      const next = new Set(prev);
      for (const [plate] of byVehicle) {
        if (planPlates.has(normPlate(plate))) next.add(plate);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [tourPlan, tourPlanInfo, byVehicle]);

  const grandTotalKm = useMemo(
    () => filtered.reduce((s, r) => s + (excludedDays[r.plate]?.has(r.date) ? 0 : r.km), 0),
    [filtered, excludedDays],
  );
  const grandTotalAmount = useMemo(
    () => filtered.reduce((s, r) => s + (excludedDays[r.plate]?.has(r.date) ? 0 : r.amount), 0),
    [filtered, excludedDays],
  );

  const toggleExcludedDay = (plate: string, date: string) => {
    if (!date) return;
    setExcludedDays(prev => {
      const next = { ...prev };
      const set = new Set(next[plate] || []);
      if (set.has(date)) set.delete(date);
      else set.add(date);
      if (set.size === 0) delete next[plate];
      else next[plate] = set;
      return next;
    });
  };

  const togglePlate = (plate: string) => {
    setExpandedPlates(prev => {
      const next = new Set(prev);
      if (next.has(plate)) next.delete(plate);
      else next.add(plate);
      return next;
    });
  };

  const hasFilters = searchText || dateFrom || dateTo || timeFrom || timeTo;

  const toggleSelectPlate = (plate: string) => {
    setSelectedPlates(prev => {
      const next = new Set(prev);
      if (next.has(plate)) next.delete(plate);
      else next.add(plate);
      return next;
    });
  };

  const toggleSplitPlate = (plate: string) => {
    setSplitPlates(prev => {
      const next = new Set(prev);
      if (next.has(plate)) next.delete(plate);
      else next.add(plate);
      return next;
    });
  };

  const allSelected = byVehicle.length > 0 && byVehicle.every(([plate]) => selectedPlates.has(plate));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedPlates(new Set());
    } else {
      setSelectedPlates(new Set(byVehicle.map(([plate]) => plate)));
    }
  };

  const handleExportExcel = async () => {
    const selected = byVehicle
      .filter(([plate]) => selectedPlates.has(plate))
      .flatMap(([plate, data]): TollVehicleGroup[] => {
        // Use ALL rows for this plate from allRows (bypass global date filter)
        const allVehicleRows = allRows.filter(r => r.plate === plate);
        const excluded = excludedMonths[plate];
        const exDays = excludedDays[plate];
        const buildGroup = (label: string, tourName: string, rows: TollRow[], rangeLabel?: string): TollVehicleGroup => {
          let exportRows = rows;
          if (excluded && excluded.size > 0) {
            exportRows = exportRows.filter(r => !excluded.has(r.date.slice(0, 7)));
          }
          if (exDays && exDays.size > 0) {
            exportRows = exportRows.filter(r => !exDays.has(r.date));
          }
          return {
            plate: label,
            tour: tourName,
            dateRange: rangeLabel,
            rows: exportRows.map(r => ({
              plate: r.plate,
              date: r.date,
              time: r.time,
              route: r.route,
              bookingNr: r.bookingNr,
              bookingType: r.bookingType,
              type: r.type,
              axleClass: r.axleClass,
              weightClass: r.weightClass,
              emissionClass: r.emissionClass,
              co2Class: r.co2Class,
              km: r.km,
              amount: r.amount,
              statementNr: r.statementNr,
              raw: r.raw,
            })),
            totalKm: exportRows.reduce((s, r) => s + r.km, 0),
            totalAmount: exportRows.reduce((s, r) => s + r.amount, 0),
          };
        };

        // Tour 1: the existing per-vehicle range (or globally filtered rows).
        const range = vehicleDateRanges[plate];
        const baseRows = range?.from || range?.to
          ? allVehicleRows.filter(r => (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to))
          : data.rows;

        // Tour plan from the Monatsbericht Excel takes precedence: split the
        // vehicle's toll by the tour it actually drove each day.
        const np = normPlate(plate);
        if (tourPlanInfo && baseRows.some(r => tourPlan[`${np}|${r.date}`])) {
          const byTour = new Map<string, TollRow[]>();
          const unassigned: TollRow[] = [];
          for (const r of baseRows) {
            const tr = tourPlan[`${np}|${r.date}`];
            if (tr) {
              const arr = byTour.get(tr) || [];
              arr.push(r);
              byTour.set(tr, arr);
            } else unassigned.push(r);
          }
          const planGroups = [...byTour.entries()]
            .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
            .map(([tourName, rows]) => {
              const days = [...new Set(rows.map(r => r.date))].sort();
              return buildGroup(
                `${plate} (T${tourName})`,
                `Tour ${tourName}`,
                rows,
                // Export is always German — it goes to German recipients.
                `${days[0]} – ${days[days.length - 1]} · ${days.length} Tage`,
              );
            });
          if (unassigned.length > 0 && !onlyTourDays) {
            planGroups.push(buildGroup(`${plate} (ohne Tour)`, tours[plate] || '', unassigned, undefined));
          }
          return planGroups;
        }
        // Plan loaded, "only tour days" on, and this vehicle has no plan
        // entries at all — skip it entirely.
        if (tourPlanInfo && onlyTourDays) return [];
        const groups = [buildGroup(
          plate,
          tours[plate] || '',
          baseRows,
          range?.from || range?.to ? `${range.from || '...'} – ${range.to || '...'}` : undefined,
        )];

        // Extra tours: one export position per tour, sliced to its days.
        (extraTours[plate] || []).forEach((et, i) => {
          if (!et.from && !et.to) return; // no days picked — nothing to slice
          const rows = allVehicleRows.filter(r => (!et.from || r.date >= et.from) && (!et.to || r.date <= et.to));
          groups.push(buildGroup(
            `${plate} (Tour ${i + 2})`,
            et.tour || `Tour ${i + 2}`,
            rows,
            `${et.from || '...'} – ${et.to || '...'}`,
          ));
        });
        return groups;
      });

    if (selected.length === 0) return;

    // Detect period from data
    const periods = months.map(m => m.period).sort();
    const periodStr = periods.length > 0
      ? (periods.length === 1 ? periods[0] : `${periods[0]}_${periods[periods.length - 1]}`)
      : new Date().toISOString().slice(0, 7);

    const { exportTollToXlsx } = await import('../lib/xlsx-export');
    exportTollToXlsx(selected, periodStr, 'LTS Logistik GmbH', showMonthDiff, addExtras, dailyRate, kmRate, splitDayNight ? { nightStart, nightEnd, plates: splitPlates, tours: splitTours } : undefined, cityName, auftragNr);
  };

  // Dachser Schönefeld export — two raw files for the selected vehicles.
  // The two downloads are spaced out: browsers drop a second programmatic
  // download fired in the same tick.
  const handleExportDachser = () => {
    if (selectedPlates.size === 0) return;
    const rows = allRows
      .filter((r) => selectedPlates.has(r.plate) && !excludedDays[r.plate]?.has(r.date))
      .map((r) => ({ plate: r.plate, date: r.date, time: r.time, raw: r.raw }));
    if (rows.length === 0) {
      setDachserMsg(locale === 'de' ? 'Keine Daten für die gewählten Fahrzeuge.' : 'Brak danych dla wybranych aut.');
      return;
    }
    const m = exportDachserMaut(rows);
    setTimeout(() => {
      const l = exportDachserLkw(rows, tours);
      const parts = [
        `maut: ${m.count} ${locale === 'de' ? 'Zeilen' : 'wierszy'}`,
        l.ok
          ? `LKW: ${l.count} ${locale === 'de' ? 'Tage' : 'dni'} × ${l.vehicles} ${locale === 'de' ? 'Fahrzeuge' : 'aut'}`
          : (locale === 'de' ? 'LKW: keine Datumsangaben gefunden' : 'LKW: brak dat w danych'),
      ];
      setDachserMsg(parts.join('  ·  '));
    }, 800);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('tollTitle')}
          </h1>
          <p className="text-sm text-muted mt-1">
            {t('tollSubtitle')}
          </p>
        </div>
        {/* Dropbox files toggle */}
        <button
          onClick={() => setShowDbxFiles(v => !v)}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            showDbxFiles
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          <FolderOpen className="w-4 h-4" />
          {t('tollDbxFiles')}
        </button>
      </div>

      {/* Dropbox file browser */}
      {showDbxFiles && (
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                {t('tollDbxTitle')}
              </h3>
              <button
                onClick={loadDbxFiles}
                disabled={dbxLoading}
                className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
              >
                {dbxLoading ? t('loading') : t('tollDbxRefresh')}
              </button>
            </div>

            {dbxError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-3 py-2 text-xs mb-3">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {dbxError}
              </div>
            )}

            {dbxLoading && (
              <div className="flex items-center justify-center py-8 text-muted">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}

            {!dbxLoading && dbxFiles.length === 0 && (
              <p className="text-sm text-muted py-4 text-center">
                {t('tollDbxEmpty')}
              </p>
            )}

            {!dbxLoading && dbxFiles.length > 0 && (() => {
              // Sort by period (from filename) descending, then by name
              const sorted = [...dbxFiles].sort((a, b) => {
                const pa = a.name.match(/^(\d{4}-\d{2})/)?.[1] || '';
                const pb = b.name.match(/^(\d{4}-\d{2})/)?.[1] || '';
                if (pa && pb) return pb.localeCompare(pa);
                if (pa) return -1;
                if (pb) return 1;
                return b.name.localeCompare(a.name);
              });

              // Group by year
              const byYear = new Map<string, TollCollectFile[]>();
              for (const f of sorted) {
                const yearMatch = f.name.match(/^(\d{4})/);
                const year = yearMatch?.[1] || 'Inne';
                if (!byYear.has(year)) byYear.set(year, []);
                byYear.get(year)!.push(f);
              }
              // Sort years descending
              const years = Array.from(byYear.entries()).sort((a, b) => b[0].localeCompare(a[0]));

              return (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {years.map(([year, files]) => (
                    <div key={year}>
                      <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
                        <span className="text-xs font-bold text-muted uppercase tracking-wider">{year}</span>
                        <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                        <span className="text-xs text-muted">{files.length}</span>
                      </div>
                      <div className="space-y-0.5">
                        {files.map(f => {
                          const periodMatch = f.name.match(/^(\d{4}-\d{2})/);
                          const period = periodMatch?.[1] || '';
                          return (
                            <div
                              key={f.path}
                              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/30 group"
                            >
                              <FileText className="w-4 h-4 text-muted shrink-0" />
                              {period && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-mono font-medium shrink-0">
                                  <Calendar className="w-3 h-3" />
                                  {period}
                                </span>
                              )}
                              <button
                                onClick={() => handleLoadFromDropbox(f.path, f.name)}
                                disabled={dbxDownloading === f.path}
                                className="flex-1 text-left text-sm text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 truncate disabled:opacity-50"
                              >
                                {dbxDownloading === f.path ? (
                                  <span className="flex items-center gap-1">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    {t('loading')}
                                  </span>
                                ) : f.name}
                              </button>
                              <span className="text-xs text-muted shrink-0 hidden sm:inline">
                                {fmtSize(f.size)}
                              </span>
                              <button
                                onClick={() => handleDeleteFromDropbox(f.path)}
                                className="text-muted hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                title={t('tollDbxDelete')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </Card>
      )}

      {/* Upload area — always visible */}
      <Card>
        <div
          className={`flex flex-col items-center justify-center ${months.length === 0 ? 'py-16' : 'py-6'} px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          <Upload className={`${months.length === 0 ? 'w-12 h-12 mb-4' : 'w-8 h-8 mb-2'} text-muted`} />
          <p className="text-sm font-medium text-muted">
            {t('tollMultiUpload')}
          </p>
          <p className="text-xs text-muted mt-1">
            {t('tollUploadHint')}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>

        {/* Tour plan (Monatsbericht Excel): day-accurate vehicle→tour mapping */}
        <div className="mt-3 flex items-center gap-2 flex-wrap px-1 pb-1">
          <button
            onClick={() => tourPlanInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 px-3 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition"
          >
            <Upload className="w-3.5 h-3.5" />
            {locale === 'de' ? 'Tourplan laden (Excel)' : 'Wgraj plan tur (Excel)'}
          </button>
          <input
            ref={tourPlanInputRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="hidden"
            onChange={handleTourPlanUpload}
          />
          {tourPlanInfo ? (
            <span className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 px-2.5 py-1 text-xs text-indigo-700 dark:text-indigo-300">
              {tourPlanInfo.files.length} {locale === 'de' ? 'Datei(en)' : 'plik(i)'} · {tourPlanInfo.entries} {locale === 'de' ? 'Zuordnungen' : 'przypisań'} · {tourPlanInfo.plates} {locale === 'de' ? 'Fzg.' : 'aut'} · {tourPlanInfo.from} – {tourPlanInfo.to}
              <button
                onClick={() => { setTourPlan({}); setTourPlanInfo(null); setOnlyTourDays(false); }}
                className="text-muted hover:text-red-500"
                title={locale === 'de' ? 'Tourplan entfernen' : 'Usuń plan tur'}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ) : (
            <span className="text-xs text-muted italic">
              {locale === 'de'
                ? 'Monatsbericht (Datum/Tour/Fahrzeug) — Export teilt die Maut je Tour nach Tagen; mehrere Monate möglich'
                : 'Monatsbericht (Datum/Tour/Fahrzeug) — eksport rozbije Maut na tury wg dni; można wgrać kilka miesięcy'}
            </span>
          )}
          {tourPlanInfo && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={onlyTourDays}
                onChange={e => setOnlyTourDays(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
              />
              {locale === 'de'
                ? 'Nur Tage mit Tour abrechnen (ohne „ohne Tour")'
                : 'Licz tylko dni z turą (pomiń „ohne Tour" i auta spoza planu)'}
            </label>
          )}
        </div>
      </Card>

      {/* Loaded months list */}
      {months.length > 0 && (
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {t('tollLoadedMonths')} ({months.length} {t('tollMonths')})
              </h3>
              <button
                onClick={() => { setMonths([]); setError(''); setTours({}); setExtraTours({}); setVehicleDateRanges({}); setSelectedPlates(new Set()); setExpandedPlates(new Set()); setDbxSavedPeriods(new Set()); }}
                className="text-xs text-muted hover:text-red-500 transition-colors"
              >
                {t('clear')}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {months.map(m => (
                <div
                  key={m.period}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
                >
                  <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-mono font-medium text-blue-700 dark:text-blue-300">{m.period}</span>
                  <span className="text-xs text-muted">({m.rows.length} {t('tollRows')})</span>
                  {/* Save to Dropbox */}
                  {m.file && !dbxSavedPeriods.has(m.period) && (
                    <button
                      onClick={() => handleSaveToDropbox(m)}
                      disabled={dbxSaving === m.period}
                      className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
                      title={t('tollDbxSave')}
                    >
                      {dbxSaving === m.period ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  {dbxSavedPeriods.has(m.period) && (
                    <CloudUpload className="w-3.5 h-3.5 text-green-500" />
                  )}
                  <button
                    onClick={() => setMonths(prev => prev.filter(pm => pm.period !== m.period))}
                    className="text-muted hover:text-red-500 transition-colors"
                    title={t('tollRemoveMonth')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
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
      {allRows.length > 0 && (
        <>

          {/* Filters */}
          <Card>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Search className="w-4 h-4" />
                {t('tollFilters')}
                {hasFilters && (
                  <button
                    onClick={() => { setSearchText(''); setDateFrom(''); setDateTo(''); setTimeFrom(''); setTimeTo(''); }}
                    className="ml-2 text-xs text-blue-500 hover:text-blue-700"
                  >
                    {t('tollClearFilters')}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {/* Search */}
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs text-muted mb-1">
                    {t('tollSearch')}
                  </label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
                    <input
                      type="text"
                      value={searchText}
                      onChange={e => setSearchText(e.target.value)}
                      placeholder={t('tollSearchPlaceholder')}
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-8 pr-2 py-1.5 text-sm text-gray-900 dark:text-white placeholder-gray-400"
                    />
                    {searchText && (
                      <button
                        onClick={() => setSearchText('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {/* Date from */}
                <div>
                  <label className="block text-xs text-muted mb-1">
                    {t('tollDateFrom')}
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
                  />
                </div>
                {/* Date to */}
                <div>
                  <label className="block text-xs text-muted mb-1">
                    {t('tollDateTo')}
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
                  />
                </div>
                {/* Time from */}
                <div>
                  <label className="block text-xs text-muted mb-1">
                    {t('tollTimeFrom')}
                  </label>
                  <input
                    type="time"
                    value={timeFrom}
                    onChange={e => setTimeFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
                  />
                </div>
                {/* Time to */}
                <div>
                  <label className="block text-xs text-muted mb-1">
                    {t('tollTimeTo')}
                  </label>
                  <input
                    type="time"
                    value={timeTo}
                    onChange={e => setTimeTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted">{t('tollVehicles')}</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">{byVehicle.length}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted">{t('tollTrips')}</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">{filtered.length}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted">{t('tollTotalKm')}</div>
                <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{fmtKm(grandTotalKm)}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted">{t('tollTotalMaut')}</div>
                <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{fmtEur(grandTotalAmount)}</div>
              </div>
            </Card>
          </div>

          {/* Excel export bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={toggleSelectAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              {t('tollSelectAll')}
            </button>
            {selectedPlates.size > 0 && (
              <span className="text-xs text-muted">
                {selectedPlates.size} / {byVehicle.length} {t('tollSelected')}
              </span>
            )}
            <label
              className={`inline-flex items-center gap-1.5 text-xs font-medium select-none ${months.length >= 2 ? 'cursor-pointer text-ink' : 'cursor-not-allowed text-muted opacity-50'}`}
              title={months.length < 2 ? (locale === 'de' ? 'Mindestens 2 Monate laden' : 'Załaduj minimum 2 miesiące') : ''}
            >
              <input
                type="checkbox"
                checked={showMonthDiff && months.length >= 2}
                disabled={months.length < 2}
                onChange={(e) => setShowMonthDiff(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#5750f1]"
              />
              {locale === 'de' ? 'Differenz zum Vormonat' : 'Różnica vs. poprzedni miesiąc'}
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer text-ink select-none">
              <input
                type="checkbox"
                checked={addExtras}
                onChange={(e) => setAddExtras(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#5750f1]"
              />
              {locale === 'de' ? 'Zusatzgebühren' : 'Dodatkowe opłaty'}
            </label>
            {addExtras && (
              <div className="inline-flex items-center gap-1.5 text-xs">
                <input
                  type="number"
                  value={dailyRate}
                  onChange={(e) => setDailyRate(Number(e.target.value) || 0)}
                  step={0.01}
                  min={0}
                  className="w-14 input px-1.5 py-1 text-xs text-right"
                  title={locale === 'de' ? 'EUR pro Tag' : 'EUR za dzień'}
                />
                <span className="text-muted">€/{locale === 'de' ? 'Tag' : 'dzień'}</span>
                <span className="text-muted">+</span>
                <input
                  type="number"
                  value={kmRate}
                  onChange={(e) => setKmRate(Number(e.target.value) || 0)}
                  step={0.01}
                  min={0}
                  className="w-14 input px-1.5 py-1 text-xs text-right"
                  title={locale === 'de' ? 'EUR pro km' : 'EUR za km'}
                />
                <span className="text-muted">€/km</span>
              </div>
            )}
            <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer text-ink select-none">
              <input
                type="checkbox"
                checked={splitDayNight}
                onChange={(e) => setSplitDayNight(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#5750f1]"
              />
              {locale === 'de' ? 'Tag/Nacht trennen' : 'Rozdziel dzień/noc'}
            </label>
            {splitDayNight && (
              <div className="inline-flex items-center gap-1.5 text-xs">
                <span className="text-muted">{locale === 'de' ? 'Nacht' : 'Noc'}:</span>
                <input type="time" value={nightStart} onChange={(e) => setNightStart(e.target.value)}
                  className="w-20 input px-1.5 py-1 text-xs" />
                <span className="text-muted">–</span>
                <input type="time" value={nightEnd} onChange={(e) => setNightEnd(e.target.value)}
                  className="w-20 input px-1.5 py-1 text-xs" />
              </div>
            )}
            <div className="inline-flex items-center gap-1.5 text-xs">
              <input
                type="text"
                value={cityName}
                onChange={(e) => setCityName(e.target.value)}
                placeholder={locale === 'de' ? 'Ort (optional)' : 'Miejscowość (opcjon.)'}
                className="w-32 input px-2 py-1 text-xs"
              />
              <input
                type="text"
                value={auftragNr}
                onChange={(e) => setAuftragNr(e.target.value)}
                placeholder={locale === 'de' ? 'Auftrag (optional)' : 'Auftrag (opcjon.)'}
                className="w-32 input px-2 py-1 text-xs"
              />
            </div>
            <button
              onClick={handleExportExcel}
              disabled={selectedPlates.size === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              {t('tollExportExcel')}
            </button>
            <button
              onClick={handleExportDachser}
              disabled={selectedPlates.size === 0}
              title={locale === 'de'
                ? 'Zwei Rohdateien für Dachser Schönefeld (Maut + LKW-Matrix) für die ausgewählten Fahrzeuge'
                : 'Dwa surowe pliki dla Dachser Schönefeld (maut + macierz aut) dla zaznaczonych pojazdów'}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              Dachser Schönefeld
            </button>
            {dachserMsg && <span className="text-xs text-muted">{dachserMsg}</span>}
          </div>

          {/* Vehicle table */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="w-8 px-3 py-3" />
                    <th className="w-8 px-1 py-3">
                      <button onClick={toggleSelectAll} className="text-muted hover:text-ink">
                        {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      </button>
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted">
                      {t('tollVehicle')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted hidden sm:table-cell">
                      {t('tollTour')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted">
                      {t('tollDate')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted">
                      {t('tollTime')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted hidden lg:table-cell">
                      {t('tollRoute')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted hidden md:table-cell">
                      {t('tollBookingType')}
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-muted">
                      km
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-muted">
                      {t('tollMaut')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byVehicle.map(([plate, data]) => {
                    const isExpanded = expandedPlates.has(plate);
                    return (
                      <>
                        {/* Vehicle summary row */}
                        <tr
                          key={`v-${plate}`}
                          className={`border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 font-medium ${selectedPlates.has(plate) ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''}`}
                          onClick={() => togglePlate(plate)}
                        >
                          <td className="px-3 py-3 text-muted">
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4" />
                              : <ChevronRight className="w-4 h-4" />}
                          </td>
                          <td className="px-1 py-3">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleSelectPlate(plate); }}
                              className="text-muted hover:text-emerald-600 dark:hover:text-emerald-400"
                            >
                              {selectedPlates.has(plate)
                                ? <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                : <Square className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-3 text-gray-900 dark:text-white">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <Truck className="w-4 h-4 text-muted" />
                                <span className="font-mono">{plate}</span>
                                {splitDayNight && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleSplitPlate(plate); }}
                                    title={locale === 'de' ? 'Tag/Nacht trennen' : 'Rozdziel dzień/noc'}
                                    className={`text-[10px] font-semibold rounded-md px-2 py-0.5 transition-colors ${
                                      splitPlates.has(plate)
                                        ? 'bg-[#5750f1] text-white'
                                        : 'bg-gray-200 text-muted hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600'
                                    }`}
                                  >
                                    ☀/☾ {splitPlates.has(plate) ? (locale === 'de' ? 'getrennt' : 'rozdziel') : (locale === 'de' ? 'trennen?' : 'rozdziel?')}
                                  </button>
                                )}
                              </div>
                              {months.length > 2 && (() => {
                                const periods = months.map(m => m.period).sort();
                                const exc = excludedMonths[plate] || new Set<string>();
                                const monthNames = locale === 'de'
                                  ? ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
                                  : ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
                                return (
                                  <div className="flex flex-wrap items-center gap-1 ml-6">
                                    <span className="text-[9px] uppercase tracking-wider text-muted">
                                      {locale === 'de' ? 'Ausschließen:' : 'Wyklucz:'}
                                    </span>
                                    {periods.map(p => {
                                      const isExc = exc.has(p);
                                      const mName = monthNames[parseInt(p.slice(5, 7), 10) - 1];
                                      return (
                                        <button
                                          key={p}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setExcludedMonths(prev => {
                                              const next = { ...prev };
                                              const set = new Set(next[plate] || []);
                                              if (set.has(p)) set.delete(p);
                                              else set.add(p);
                                              if (set.size === 0) delete next[plate];
                                              else next[plate] = set;
                                              return next;
                                            });
                                          }}
                                          className={`text-[10px] font-medium rounded px-1.5 py-0.5 transition-colors ${
                                            isExc
                                              ? 'bg-rose-500 text-white line-through'
                                              : 'bg-gray-100 text-muted hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600'
                                          }`}
                                        >
                                          {mName}
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="px-3 py-3 hidden sm:table-cell" onClick={e => e.stopPropagation()}>
                            {splitDayNight && splitPlates.has(plate) ? (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] font-semibold text-amber-600 w-7">☀</span>
                                  <input
                                    type="text"
                                    value={splitTours[plate]?.day || ''}
                                    onChange={e => setSplitTours(prev => ({ ...prev, [plate]: { day: e.target.value, night: prev[plate]?.night || '' } }))}
                                    placeholder={locale === 'de' ? 'Tour Tag' : 'Tura dzień'}
                                    className="w-full rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-400 focus:outline-none"
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] font-semibold text-indigo-600 w-7">☾</span>
                                  <input
                                    type="text"
                                    value={splitTours[plate]?.night || ''}
                                    onChange={e => setSplitTours(prev => ({ ...prev, [plate]: { day: prev[plate]?.day || '', night: e.target.value } }))}
                                    placeholder={locale === 'de' ? 'Tour Nacht' : 'Tura noc'}
                                    className="w-full rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-400 focus:outline-none"
                                  />
                                </div>
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={tours[plate] || ''}
                                onChange={e => setTours(prev => ({ ...prev, [plate]: e.target.value }))}
                                placeholder={t('tollTourPlaceholder')}
                                className="w-full rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-400 focus:outline-none"
                              />
                            )}
                          </td>
                          <td className="px-3 py-3 text-muted text-xs" colSpan={2}>
                            {data.rows.length} {t('tollTripsCount')}
                            {data.excludedDayCount > 0 && (
                              <span className="ml-1 text-rose-500 font-medium">
                                ({data.excludedDayCount} {locale === 'de' ? 'Tag(e) ausgeschl.' : 'dni wykl.'}, −{fmtEur(data.excludedAmount)})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 hidden lg:table-cell" />
                          <td className="px-3 py-3 hidden md:table-cell" />
                          <td className="px-3 py-3 text-right font-bold text-blue-600 dark:text-blue-400 font-mono">
                            {fmtKm(data.totalKm)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                            {fmtEur(data.totalAmount)}
                          </td>
                        </tr>

                        {/* Per-vehicle date range row (shown when selected) */}
                        {selectedPlates.has(plate) && (
                          <tr
                            key={`dr-${plate}`}
                            className="border-b border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-900/10"
                          >
                            <td className="px-3 py-2" />
                            <td className="px-1 py-2" />
                            <td colSpan={8} className="px-3 py-2">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {t('tollExportRange')}:
                                </span>
                                <input
                                  type="date"
                                  value={vehicleDateRanges[plate]?.from || ''}
                                  onChange={e => setVehicleDateRanges(prev => ({
                                    ...prev,
                                    [plate]: { ...prev[plate], from: e.target.value, to: prev[plate]?.to || '' },
                                  }))}
                                  className="rounded border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white focus:border-blue-400 focus:outline-none"
                                />
                                <span className="text-xs text-muted">–</span>
                                <input
                                  type="date"
                                  value={vehicleDateRanges[plate]?.to || ''}
                                  onChange={e => setVehicleDateRanges(prev => ({
                                    ...prev,
                                    [plate]: { from: prev[plate]?.from || '', to: e.target.value },
                                  }))}
                                  className="rounded border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white focus:border-blue-400 focus:outline-none"
                                />
                                {(vehicleDateRanges[plate]?.from || vehicleDateRanges[plate]?.to) && (
                                  <button
                                    onClick={() => setVehicleDateRanges(prev => {
                                      const next = { ...prev };
                                      delete next[plate];
                                      return next;
                                    })}
                                    className="text-xs text-muted hover:text-red-500"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                                {!vehicleDateRanges[plate]?.from && !vehicleDateRanges[plate]?.to && (
                                  <span className="text-xs text-muted italic">{t('tollExportRangeHint')}</span>
                                )}
                              </div>

                              {/* Extra tours: same vehicle, several tours, each with its own days */}
                              {(extraTours[plate] || []).map((et, i) => (
                                <div key={i} className="mt-2 flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 w-14">
                                    {locale === 'de' ? `Tour ${i + 2}` : `Tura ${i + 2}`}:
                                  </span>
                                  <input
                                    type="text"
                                    value={et.tour}
                                    onChange={e => setExtraTours(prev => ({
                                      ...prev,
                                      [plate]: prev[plate].map((x, j) => j === i ? { ...x, tour: e.target.value } : x),
                                    }))}
                                    placeholder={t('tollTourPlaceholder')}
                                    className="w-36 rounded border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:border-indigo-400 focus:outline-none"
                                  />
                                  <input
                                    type="date"
                                    value={et.from}
                                    onChange={e => setExtraTours(prev => ({
                                      ...prev,
                                      [plate]: prev[plate].map((x, j) => j === i ? { ...x, from: e.target.value } : x),
                                    }))}
                                    className="rounded border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white focus:border-indigo-400 focus:outline-none"
                                  />
                                  <span className="text-xs text-muted">–</span>
                                  <input
                                    type="date"
                                    value={et.to}
                                    onChange={e => setExtraTours(prev => ({
                                      ...prev,
                                      [plate]: prev[plate].map((x, j) => j === i ? { ...x, to: e.target.value } : x),
                                    }))}
                                    className="rounded border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white focus:border-indigo-400 focus:outline-none"
                                  />
                                  <button
                                    onClick={() => setExtraTours(prev => ({
                                      ...prev,
                                      [plate]: prev[plate].filter((_, j) => j !== i),
                                    }))}
                                    className="text-xs text-muted hover:text-red-500"
                                    title={locale === 'de' ? 'Tour entfernen' : 'Usuń turę'}
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                              <button
                                onClick={() => setExtraTours(prev => ({
                                  ...prev,
                                  [plate]: [...(prev[plate] || []), { tour: '', from: '', to: '' }],
                                }))}
                                className="mt-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                + {locale === 'de' ? 'Weitere Tour (Fahrzeug fuhr mehrere Touren)' : 'Dodaj turę (auto jeździło kilka tur)'}
                              </button>
                            </td>
                          </tr>
                        )}

                        {/* Expanded trip rows — click a date to exclude the
                            whole day (vehicle drove something else). */}
                        {isExpanded && data.rows.map((r, idx) => {
                          const dayExcluded = excludedDays[plate]?.has(r.date) ?? false;
                          return (
                          <tr
                            key={`${plate}-${idx}`}
                            className={`border-b border-gray-50 dark:border-gray-800 text-xs ${dayExcluded ? 'bg-rose-50/60 dark:bg-rose-900/15 text-rose-400 line-through' : 'bg-gray-50/50 dark:bg-gray-800/20'}`}
                          >
                            <td className="px-3 py-2" />
                            <td className="px-1 py-2" />
                            <td className="px-3 py-2 hidden sm:table-cell" />
                            <td className="px-3 py-2 font-mono text-muted">{r.bookingNr}</td>
                            <td className="px-3 py-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleExcludedDay(plate, r.date); }}
                                title={dayExcluded
                                  ? (locale === 'de' ? 'Tag wieder einrechnen' : 'Przywróć dzień do rozliczenia')
                                  : (locale === 'de' ? 'Diesen Tag von der Maut-Abrechnung ausschließen' : 'Wyklucz ten dzień z rozliczenia maut')}
                                className={`no-underline inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors ${
                                  dayExcluded
                                    ? 'bg-rose-500 text-white'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-rose-100 dark:hover:bg-rose-900/30'
                                }`}
                              >
                                {dayExcluded && <X className="w-3 h-3" />}
                                {r.date}
                              </button>
                              {tourPlanInfo && tourPlan[`${normPlate(plate)}|${r.date}`] && (
                                <span className="ml-1 inline-flex items-center rounded bg-indigo-100 dark:bg-indigo-900/40 px-1 py-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-300">
                                  T{tourPlan[`${normPlate(plate)}|${r.date}`]}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted">{r.time}</td>
                            <td className="px-3 py-2 text-muted hidden lg:table-cell max-w-xs truncate" title={r.route}>
                              {r.route}
                            </td>
                            <td className="px-3 py-2 text-muted hidden md:table-cell">
                              {r.bookingType}
                            </td>
                            <td className="px-3 py-2 text-right text-muted font-mono">
                              {fmtKm(r.km)}
                            </td>
                            <td className="px-3 py-2 text-right text-muted font-mono">
                              {fmtEur(r.amount)}
                            </td>
                          </tr>
                          );
                        })}
                      </>
                    );
                  })}

                  {/* Grand total */}
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-bold">
                    <td className="px-3 py-3" />
                    <td className="px-1 py-3" />
                    <td className="px-3 py-3 text-gray-900 dark:text-white">
                      RAZEM
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell" />
                    <td className="px-3 py-3 text-muted text-xs" colSpan={2}>
                      {byVehicle.length} {t('tollVehiclesCount')}, {filtered.length} {t('tollTripsCount')}
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell" />
                    <td className="px-3 py-3 hidden md:table-cell" />
                    <td className="px-3 py-3 text-right text-blue-700 dark:text-blue-300 font-mono text-base">
                      {fmtKm(grandTotalKm)} km
                    </td>
                    <td className="px-3 py-3 text-right text-emerald-700 dark:text-emerald-300 font-mono text-base">
                      {fmtEur(grandTotalAmount)}
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

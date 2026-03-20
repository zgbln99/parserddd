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
import { exportTollToXlsx, type TollVehicleGroup } from '../lib/xlsx-export';

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

export function TollCollectPage() {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<TollRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [savePeriod, setSavePeriod] = useState(''); // YYYY-MM for Dropbox save

  // Dropbox state
  const [dbxFiles, setDbxFiles] = useState<TollCollectFile[]>([]);
  const [dbxLoading, setDbxLoading] = useState(false);
  const [dbxSaving, setDbxSaving] = useState(false);
  const [dbxSaved, setDbxSaved] = useState(false);
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

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setFileName(file.name);
    setLastFile(file);
    setDbxSaved(false);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length === 0) {
          setError('Nie znaleziono danych w pliku CSV');
          return;
        }
        setRows(parsed);
        // Auto-detect month from first date in data
        const firstDate = parsed.find(r => r.date)?.date || '';
        if (firstDate.length >= 7) setSavePeriod(firstDate.slice(0, 7));
        // Reset filters
        setSearchText('');
        setDateFrom('');
        setDateTo('');
        setTimeFrom('');
        setTimeTo('');
        setExpandedPlates(new Set());
        setSelectedPlates(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file, 'utf-8');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    // Simulate file input
    const dt = new DataTransfer();
    dt.items.add(file);
    if (fileInputRef.current) {
      fileInputRef.current.files = dt.files;
      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, []);

  // Save current file to Dropbox
  const handleSaveToDropbox = useCallback(async () => {
    if (!lastFile) return;
    setDbxSaving(true);
    setDbxError('');
    try {
      await uploadTollCollectFile(lastFile, savePeriod || undefined);
      setDbxSaved(true);
      // Refresh file list if visible
      if (showDbxFiles) loadDbxFiles();
    } catch (err) {
      setDbxError(err instanceof Error ? err.message : String(err));
    } finally {
      setDbxSaving(false);
    }
  }, [lastFile, savePeriod, showDbxFiles, loadDbxFiles]);

  // Load file from Dropbox
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
      setRows(parsed);
      setFileName(name);
      setLastFile(null); // no File object - came from Dropbox
      setDbxSaved(true);
      // Reset filters
      setSearchText('');
      setDateFrom('');
      setDateTo('');
      setTimeFrom('');
      setTimeTo('');
      setExpandedPlates(new Set());
      setSelectedPlates(new Set());
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
    return rows.filter(r => {
      if (q) {
        const haystack = `${r.plate} ${r.route} ${r.bookingNr} ${r.bookingType} ${r.type}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      if (timeFrom && r.time < timeFrom) return false;
      if (timeTo && r.time > timeTo) return false;
      return true;
    });
  }, [rows, searchText, dateFrom, dateTo, timeFrom, timeTo]);

  // Group by vehicle
  const byVehicle = useMemo(() => {
    const map = new Map<string, { rows: TollRow[]; totalKm: number; totalAmount: number }>();
    for (const r of filtered) {
      const key = r.plate || '(brak)';
      if (!map.has(key)) map.set(key, { rows: [], totalKm: 0, totalAmount: 0 });
      const entry = map.get(key)!;
      entry.rows.push(r);
      entry.totalKm += r.km;
      entry.totalAmount += r.amount;
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const grandTotalKm = useMemo(() => filtered.reduce((s, r) => s + r.km, 0), [filtered]);
  const grandTotalAmount = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);

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

  const allSelected = byVehicle.length > 0 && byVehicle.every(([plate]) => selectedPlates.has(plate));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedPlates(new Set());
    } else {
      setSelectedPlates(new Set(byVehicle.map(([plate]) => plate)));
    }
  };

  const handleExportExcel = () => {
    const selected = byVehicle
      .filter(([plate]) => selectedPlates.has(plate))
      .map(([plate, data]): TollVehicleGroup => ({
        plate,
        rows: data.rows.map(r => ({
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
        totalKm: data.totalKm,
        totalAmount: data.totalAmount,
      }));

    if (selected.length === 0) return;

    // Detect period from data
    const dates = selected.flatMap(v => v.rows.map(r => r.date)).filter(Boolean).sort();
    const periodStr = dates.length > 0
      ? (dates[0].slice(0, 7) === dates[dates.length - 1].slice(0, 7)
        ? dates[0].slice(0, 7)
        : `${dates[0].slice(0, 7)}_${dates[dates.length - 1].slice(0, 7)}`)
      : new Date().toISOString().slice(0, 7);

    exportTollToXlsx(selected, periodStr, 'LTS Logistik GmbH');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('tollTitle')}
          </h1>
          <p className="text-sm text-muted dark:text-muted-dark mt-1">
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
              <div className="flex items-center justify-center py-8 text-muted dark:text-muted-dark">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}

            {!dbxLoading && dbxFiles.length === 0 && (
              <p className="text-sm text-muted dark:text-muted-dark py-4 text-center">
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
                        <span className="text-xs font-bold text-muted dark:text-muted-dark uppercase tracking-wider">{year}</span>
                        <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                        <span className="text-xs text-muted dark:text-muted-dark">{files.length}</span>
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
                              <FileText className="w-4 h-4 text-muted dark:text-muted-dark shrink-0" />
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
                              <span className="text-xs text-muted dark:text-muted-dark shrink-0 hidden sm:inline">
                                {fmtSize(f.size)}
                              </span>
                              <button
                                onClick={() => handleDeleteFromDropbox(f.path)}
                                className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
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

      {/* Upload area */}
      {rows.length === 0 && (
        <Card>
          <div
            className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload className="w-12 h-12 text-muted dark:text-muted-dark mb-4" />
            <p className="text-sm font-medium text-muted dark:text-muted-dark">
              {t('tollUpload')}
            </p>
            <p className="text-xs text-muted dark:text-muted-dark mt-1">
              {t('tollUploadHint')}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
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
          {/* File info + actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-muted dark:text-muted-dark">
              <FileText className="w-4 h-4" />
              <span className="font-medium">{fileName}</span>
              <span>— {rows.length} {t('tollRows')}</span>
            </div>

            {/* Save to Dropbox */}
            {lastFile && !dbxSaved && (
              <div className="inline-flex items-center gap-2">
                <input
                  type="month"
                  value={savePeriod}
                  onChange={e => setSavePeriod(e.target.value)}
                  className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white"
                />
                <button
                  onClick={handleSaveToDropbox}
                  disabled={dbxSaving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                >
                  {dbxSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                  {t('tollDbxSave')}
                </button>
              </div>
            )}
            {dbxSaved && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <CloudUpload className="w-3.5 h-3.5" />
                {t('tollDbxSaved')}
              </span>
            )}

            <button
              onClick={() => { setRows([]); setFileName(''); setError(''); setLastFile(null); setDbxSaved(false); }}
              className="inline-flex items-center gap-1 text-xs text-muted dark:text-muted-dark hover:text-red-500 transition-colors"
            >
              <X className="w-3 h-3" /> {t('tollNewFile')}
            </button>
          </div>

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
                  <label className="block text-xs text-muted dark:text-muted-dark mb-1">
                    {t('tollSearch')}
                  </label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted dark:text-muted-dark" />
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
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-muted dark:text-muted-dark"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {/* Date from */}
                <div>
                  <label className="block text-xs text-muted dark:text-muted-dark mb-1">
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
                  <label className="block text-xs text-muted dark:text-muted-dark mb-1">
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
                  <label className="block text-xs text-muted dark:text-muted-dark mb-1">
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
                  <label className="block text-xs text-muted dark:text-muted-dark mb-1">
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
                <div className="text-xs text-muted dark:text-muted-dark">{t('tollVehicles')}</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">{byVehicle.length}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted dark:text-muted-dark">{t('tollTrips')}</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white mt-1">{filtered.length}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted dark:text-muted-dark">{t('tollTotalKm')}</div>
                <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{fmtKm(grandTotalKm)}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted dark:text-muted-dark">{t('tollTotalMaut')}</div>
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
              <span className="text-xs text-muted dark:text-muted-dark">
                {selectedPlates.size} / {byVehicle.length} {t('tollSelected')}
              </span>
            )}
            <button
              onClick={handleExportExcel}
              disabled={selectedPlates.size === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              {t('tollExportExcel')}
            </button>
          </div>

          {/* Vehicle table */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <th className="w-8 px-3 py-3" />
                    <th className="w-8 px-1 py-3">
                      <button onClick={toggleSelectAll} className="text-gray-400 hover:text-muted dark:text-muted-dark dark:hover:text-gray-200">
                        {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      </button>
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted dark:text-muted-dark">
                      {t('tollVehicle')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted dark:text-muted-dark">
                      {t('tollDate')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted dark:text-muted-dark">
                      {t('tollTime')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted dark:text-muted-dark hidden lg:table-cell">
                      {t('tollRoute')}
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted dark:text-muted-dark hidden md:table-cell">
                      {t('tollBookingType')}
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-muted dark:text-muted-dark">
                      km
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-muted dark:text-muted-dark">
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
                          <td className="px-3 py-3 text-muted dark:text-muted-dark">
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4" />
                              : <ChevronRight className="w-4 h-4" />}
                          </td>
                          <td className="px-1 py-3">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleSelectPlate(plate); }}
                              className="text-muted dark:text-muted-dark hover:text-emerald-600 dark:hover:text-emerald-400"
                            >
                              {selectedPlates.has(plate)
                                ? <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                : <Square className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-3 text-gray-900 dark:text-white">
                            <div className="flex items-center gap-2">
                              <Truck className="w-4 h-4 text-muted dark:text-muted-dark" />
                              <span className="font-mono">{plate}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-muted dark:text-muted-dark text-xs" colSpan={2}>
                            {data.rows.length} {t('tollTripsCount')}
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

                        {/* Expanded trip rows */}
                        {isExpanded && data.rows.map((r, idx) => (
                          <tr
                            key={`${plate}-${idx}`}
                            className="border-b border-gray-50 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 text-xs"
                          >
                            <td className="px-3 py-2" />
                            <td className="px-1 py-2" />
                            <td className="px-3 py-2 font-mono text-muted dark:text-muted-dark">{r.bookingNr}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{r.date}</td>
                            <td className="px-3 py-2 text-muted dark:text-muted-dark">{r.time}</td>
                            <td className="px-3 py-2 text-muted dark:text-muted-dark hidden lg:table-cell max-w-xs truncate" title={r.route}>
                              {r.route}
                            </td>
                            <td className="px-3 py-2 text-muted dark:text-muted-dark hidden md:table-cell">
                              {r.bookingType}
                            </td>
                            <td className="px-3 py-2 text-right text-muted dark:text-muted-dark font-mono">
                              {fmtKm(r.km)}
                            </td>
                            <td className="px-3 py-2 text-right text-muted dark:text-muted-dark font-mono">
                              {fmtEur(r.amount)}
                            </td>
                          </tr>
                        ))}
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
                    <td className="px-3 py-3 text-muted dark:text-muted-dark text-xs" colSpan={2}>
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

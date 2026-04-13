import { useState, useCallback, useMemo, useRef } from 'react';
import { ClipboardCopy, Check, RefreshCw, Users, Calendar } from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchDrivers, analyzeDropboxFile, fetchDriverConfigs } from '../lib/api';
import type { DriverConfig } from '../lib/api';
import type { Driver, ShiftDetail } from '../types';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { minutesToHm } from '../lib/utils';

interface BulkDriverRow {
  driver_name: string;
  personal_nr: string;
  dayWork: Record<number, number>; // day number → work minutes
  n25: number;
  n40: number;
  dietCount: number;
  totalWork: number;
}

const weekdayPlShort = ['Nd', 'Pn', 'Wt', 'Sr', 'Cz', 'Pt', 'So'];
const weekdayDeShort = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function fmtWork(mins: number) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function BulkGridPage() {
  const { t, locale } = useI18n();
  const { dateFrom } = useDateFilter();

  const defaultPeriod = useMemo(() => {
    if (dateFrom) return dateFrom.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [dateFrom]);

  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod);
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driversLoaded, setDriversLoaded] = useState(false);
  const [loadingDrivers, setLoadingDrivers] = useState(false);

  const [results, setResults] = useState<BulkDriverRow[]>([]);
  const [period, setPeriod] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, name: '' });
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef(false);

  // Load driver list
  const handleLoadDrivers = useCallback(async () => {
    setLoadingDrivers(true);
    try {
      const data = await fetchDrivers();
      const list = data.drivers.filter((d: Driver) => d.files.length > 0);
      list.sort((a: Driver, b: Driver) => a.name.localeCompare(b.name));
      setAllDrivers(list);
      setSelected(new Set(list.map((d: Driver) => d.name)));
      setDriversLoaded(true);
    } catch { /* ignore */ }
    setLoadingDrivers(false);
  }, []);

  const toggleDriver = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(allDrivers.map(d => d.name)));
  const selectNone = () => setSelected(new Set());

  // Generate grid
  const handleGenerate = useCallback(async () => {
    const p = selectedPeriod || defaultPeriod;
    const year = parseInt(p.slice(0, 4));
    const month = parseInt(p.slice(5, 7));
    setLoading(true);
    setResults([]);
    setPeriod('');
    cancelRef.current = false;

    try {
      const configsData = await fetchDriverConfigs();
      const configMap = new Map<string, DriverConfig>();
      for (const cfg of configsData.configs) configMap.set(cfg.card_number, cfg);

      const selectedDrivers = allDrivers.filter(d => selected.has(d.name));
      setProgress({ current: 0, total: selectedDrivers.length, name: '' });

      const rows: BulkDriverRow[] = [];
      const CONCURRENCY = 3;

      const processDriver = async (driver: Driver) => {
        if (cancelRef.current) return;
        const latestFile = driver.files[0];
        if (!latestFile?.path) return;
        try {
          const analysis = await analyzeDropboxFile(latestFile.path);
          const monthShifts = (analysis.shift_details || []).filter(
            (sh: ShiftDetail) => sh.shift_date?.slice(0, 7) === p
          );
          if (monthShifts.length === 0) return;

          const dayWork: Record<number, number> = {};
          for (const sh of monthShifts) {
            const dateStr = (sh as any).grid_date || sh.shift_date;
            const d = parseInt(dateStr.slice(8, 10), 10);
            if (!isNaN(d)) dayWork[d] = (dayWork[d] || 0) + sh.duration_minutes;
          }

          const cardNumber = driver.card_number || analysis.driver_info?.card_number || '';
          const dcfg = configMap.get(cardNumber);

          rows.push({
            driver_name: driver.name,
            personal_nr: dcfg?.personal_nr || '',
            dayWork,
            n25: monthShifts.reduce((s: number, sh: ShiftDetail) => s + (sh.night_25_minutes || 0), 0),
            n40: monthShifts.reduce((s: number, sh: ShiftDetail) => s + (sh.night_40_minutes || 0), 0),
            dietCount: monthShifts.filter((sh: ShiftDetail) => sh.has_diet).length,
            totalWork: monthShifts.reduce((s: number, sh: ShiftDetail) => s + (sh.work_minutes || 0), 0),
          });
        } catch { /* skip */ }
      };

      for (let i = 0; i < selectedDrivers.length; i += CONCURRENCY) {
        if (cancelRef.current) break;
        const batch = selectedDrivers.slice(i, i + CONCURRENCY);
        setProgress({ current: i, total: selectedDrivers.length, name: batch.map(d => d.name).join(', ') });
        await Promise.all(batch.map(processDriver));
      }

      rows.sort((a, b) => a.driver_name.localeCompare(b.driver_name));
      setResults(rows);
      setPeriod(p);
      setProgress({ current: selectedDrivers.length, total: selectedDrivers.length, name: '' });
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedPeriod, defaultPeriod, allDrivers, selected]);

  // Grid data
  const year = parseInt((period || selectedPeriod).slice(0, 4)) || new Date().getFullYear();
  const month = parseInt((period || selectedPeriod).slice(5, 7)) || (new Date().getMonth() + 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayNumbers = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const wdNames = locale === 'de' ? weekdayDeShort : weekdayPlShort;
  const weekdays = dayNumbers.map(d => wdNames[new Date(year, month - 1, d).getDay()]);

  const summaryHeaders = ['25%', '40%', 'VMA', 'AZ'];

  // Copy all rows as TSV
  const handleCopy = useCallback(() => {
    const header = ['Fahrer', ...dayNumbers.map(String), ...summaryHeaders].join('\t');
    const rows = results.map(r => {
      const dayCols = dayNumbers.map(d => fmtWork(r.dayWork[d] || 0));
      const n25 = (r.n25 / 60).toFixed(2).replace('.', ',');
      const n40 = (r.n40 / 60).toFixed(2).replace('.', ',');
      const vma = String(r.dietCount);
      const az = fmtWork(r.totalWork);
      return [r.driver_name, ...dayCols, n25, n40, vma, az].join('\t');
    });
    navigator.clipboard.writeText([header, ...rows].join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [results, dayNumbers, summaryHeaders]);

  const thCls = 'border border-gray-300 bg-gray-200/60 px-1 py-0.5 text-center text-[10px] font-bold text-muted dark:border-gray-600 dark:bg-gray-700';
  const tdCls = 'border border-gray-300 bg-white px-1 py-0.5 text-center font-mono text-[10px] dark:border-gray-600 dark:bg-gray-900';

  return (
    <div className="animate-slide-up space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t('bulkGridTitle')}</h1>

      {/* Period + load drivers */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Calendar size={16} className="text-muted" />
          <input
            type="month"
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="input rounded-lg px-3 py-2 text-sm"
          />
          {!driversLoaded ? (
            <button
              onClick={handleLoadDrivers}
              disabled={loadingDrivers}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              {loadingDrivers ? <Spinner size="sm" /> : <Users size={14} />}
              {t('bulkGridLoadDrivers')}
            </button>
          ) : (
            <>
              <span className="text-xs text-muted">
                {selected.size}/{allDrivers.length} {t('bulkGridSelected')}
              </span>
              <button onClick={selectAll} className="text-xs text-primary-600 hover:underline">{t('bulkGridSelectAll')}</button>
              <button onClick={selectNone} className="text-xs text-muted hover:underline">{t('bulkGridSelectNone')}</button>
              <div className="hidden sm:block flex-1" />
              <button
                onClick={handleGenerate}
                disabled={loading || selected.size === 0}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
              >
                {loading ? <Spinner size="sm" /> : <RefreshCw size={14} />}
                {t('bulkGridGenerate')}
              </button>
            </>
          )}
        </div>

        {/* Driver checkboxes */}
        {driversLoaded && (
          <div className="mt-3 max-h-[200px] overflow-y-auto rounded-lg border border-border p-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1">
              {allDrivers.map(d => (
                <label key={d.name} className="flex items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer hover:bg-surface">
                  <input
                    type="checkbox"
                    checked={selected.has(d.name)}
                    onChange={() => toggleDriver(d.name)}
                    className="rounded border-gray-300"
                  />
                  <span className="truncate">{d.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Progress */}
        {loading && (
          <div className="mt-3 flex items-center gap-3">
            <Spinner size="sm" />
            <span className="text-xs text-muted">
              {progress.current}/{progress.total} — {progress.name}
            </span>
            <button onClick={() => { cancelRef.current = true; }} className="text-xs text-danger hover:underline">{t('cancel')}</button>
          </div>
        )}
      </Card>

      {/* Results grid */}
      {results.length > 0 && period && (
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('bulkGridResult')} — {String(month).padStart(2, '0')}/{year} — {results.length} {t('bulkGridDrivers')}
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 rounded-lg bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700 transition hover:bg-primary-200 dark:bg-primary-900/30 dark:hover:bg-primary-900/50"
            >
              {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
              {copied ? 'OK!' : t('bulkGridCopy')}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
              <thead>
                {/* Day numbers */}
                <tr>
                  <th className={`${thCls} !text-left min-w-[120px]`}>{t('bulkGridDriver')}</th>
                  {dayNumbers.map(d => <th key={d} className={thCls} style={{ width: 28 }}>{d}</th>)}
                  {summaryHeaders.map(h => <th key={h} className={thCls} style={{ width: 40 }}>{h}</th>)}
                </tr>
                {/* Weekdays */}
                <tr>
                  <th className={thCls} />
                  {weekdays.map((wd, i) => {
                    const isWeekend = wd === 'So' || wd === 'Sa' || wd === 'Nd';
                    return <th key={i} className={`${thCls} ${isWeekend ? '!text-red-400 !bg-red-50 dark:!bg-red-900/20' : ''}`}>{wd}</th>;
                  })}
                  {summaryHeaders.map(h => <th key={`e-${h}`} className="w-1" />)}
                </tr>
              </thead>
              <tbody>
                {results.map(r => {
                  const n25 = (r.n25 / 60).toFixed(2).replace('.', ',');
                  const n40 = (r.n40 / 60).toFixed(2).replace('.', ',');
                  const az = fmtWork(r.totalWork);
                  return (
                    <tr key={r.driver_name}>
                      <td className={`${tdCls} !text-left font-semibold truncate`} title={r.driver_name}>
                        {r.personal_nr ? `${r.personal_nr} ` : ''}{r.driver_name}
                      </td>
                      {dayNumbers.map(d => {
                        const v = fmtWork(r.dayWork[d] || 0);
                        return <td key={d} className={`${tdCls} ${v ? 'font-semibold text-gray-800 dark:text-gray-200' : ''}`}>{v}</td>;
                      })}
                      <td className={`${tdCls} font-bold`}>{n25}</td>
                      <td className={`${tdCls} font-bold`}>{n40}</td>
                      <td className={`${tdCls} font-bold`}>{r.dietCount || ''}</td>
                      <td className={`${tdCls} font-bold`}>{az}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

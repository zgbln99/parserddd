import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Users, RefreshCw, CheckCircle, Circle, AlertCircle,
  FileText, Clock, CheckSquare, Square, Filter, BarChart3,
  Upload, Palmtree, X, Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { fetchDrivers, parseVacationPdf, fetchPayrollStatus, setPayrollStatus, analyzeDropboxFile, type VacationEntry, type PayrollStatusValue } from '../lib/api';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import type { Driver } from '../types';

// Match vacation name to driver name (fuzzy: compare last names)
function matchVacationToDriver(vacationName: string, driverName: string): boolean {
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const vn = normalize(vacationName);
  const dn = normalize(driverName);
  // Exact match
  if (vn === dn) return true;
  // Compare last names
  const vParts = vn.split(/\s+/);
  const dParts = dn.split(/\s+/);
  const vLast = vParts[vParts.length - 1];
  const dLast = dParts[dParts.length - 1];
  if (vLast === dLast && vLast.length >= 3) return true;
  // Driver name might be "Lastname Firstname" (reversed)
  if (dParts.length >= 2 && vLast === dParts[0] && dParts[0].length >= 3) return true;
  return false;
}

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getSavedPeriod() {
  return localStorage.getItem('ddd-payroll-period') || getCurrentPeriod();
}

// Status cycle: '' → 'stundenzettel' (do zrobienia) → 'policzony' (gotowy) → ''
const STATUS_CYCLE: PayrollStatusValue[] = ['', 'stundenzettel', 'policzony'];
function nextStatus(current: PayrollStatusValue): PayrollStatusValue {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

export function PayrollPage() {
  const { t, locale } = useI18n();
  const [period, setPeriodState] = useState(getSavedPeriod);

  const setPeriod = (p: string) => {
    setPeriodState(p);
    localStorage.setItem('ddd-payroll-period', p);
  };

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statuses, setStatuses] = useState<Record<string, PayrollStatusValue>>({});
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [searchText, setSearchText] = useState('');
  // Keys that were recently changed - delay their sort for 2.5s
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set());

  // Preload analysis in background
  const [preloading, setPreloading] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState({ done: 0, total: 0, current: '' });
  const preloadCancelRef = useRef(false);

  // Vacation PDF — persisted in localStorage
  const vacFileRef = useRef<HTMLInputElement>(null);
  const [vacationEntries, setVacationEntriesState] = useState<VacationEntry[]>(() => {
    try {
      const raw = localStorage.getItem('ddd-payroll-vacation');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return [];
  });
  const [vacUploading, setVacUploading] = useState(false);

  const setVacationEntries = (entries: VacationEntry[]) => {
    setVacationEntriesState(entries);
    if (entries.length > 0) {
      localStorage.setItem('ddd-payroll-vacation', JSON.stringify(entries));
    } else {
      localStorage.removeItem('ddd-payroll-vacation');
    }
  };

  const handleVacationUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVacUploading(true);
    try {
      const res = await parseVacationPdf(file);
      setVacationEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVacUploading(false);
      if (vacFileRef.current) vacFileRef.current.value = '';
    }
  }, []);

  const loadDrivers = useCallback(async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchDrivers(refresh);
      setDrivers(res.drivers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatuses = useCallback(async (p: string) => {
    try {
      const res = await fetchPayrollStatus(p);
      setStatuses(res.statuses);
    } catch { /* ignore – statuses will be empty */ }
  }, []);

  const navigate = useNavigate();

  const handlePreloadAll = useCallback(async () => {
    const withFiles = drivers.filter(d => d.files.length > 0);
    if (withFiles.length === 0) return;
    setPreloading(true);
    preloadCancelRef.current = false;
    let done = 0;
    for (const d of withFiles) {
      if (preloadCancelRef.current) break;
      done++;
      setPreloadProgress({ done, total: withFiles.length, current: d.name });
      try {
        await analyzeDropboxFile(d.files[0].path);
      } catch { /* skip errors */ }
    }
    setPreloading(false);
  }, [drivers]);

  useEffect(() => { loadDrivers(); }, [loadDrivers]);

  // Load statuses when period changes
  useEffect(() => {
    loadStatuses(period);
  }, [period, loadStatuses]);

  // "since date" = first day of the NEXT month (payroll for March → files downloaded since April 1st)
  const sinceDate = useMemo(() => {
    const [y, m] = period.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    return `${next}-01`;
  }, [period]);

  // For each driver, count files downloaded since sinceDate
  const driverData = useMemo(() => {
    return drivers.map(d => {
      const newFiles = d.files.filter(f => f.modified >= sinceDate);
      const hasNewFiles = newFiles.length > 0;
      const latestNewFile = newFiles.length > 0
        ? newFiles.reduce((a, b) => a.modified > b.modified ? a : b)
        : null;
      // Match vacation
      const vacation = vacationEntries.find(v => matchVacationToDriver(v.name, d.name));
      const key = d.card_number || d.name;
      const status: PayrollStatusValue = statuses[key] || '';
      return {
        driver: d,
        newFilesCount: newFiles.length,
        hasNewFiles,
        latestNewFile,
        status,
        vacation: vacation || null,
      };
    }).sort((a, b) => {
      // Drivers with any status sink to bottom; recently changed stay in place
      const keyA = a.driver.card_number || a.driver.name;
      const keyB = b.driver.card_number || b.driver.name;
      const aRecent = recentlyChanged.has(keyA);
      const bRecent = recentlyChanged.has(keyB);
      // Recently changed items sort as if they have no status (stay in place)
      const effectiveA = aRecent ? '' as PayrollStatusValue : a.status;
      const effectiveB = bRecent ? '' as PayrollStatusValue : b.status;
      const statusOrder = (s: PayrollStatusValue) => s === '' ? 0 : 1;
      const sa = statusOrder(effectiveA);
      const sb = statusOrder(effectiveB);
      if (sa !== sb) return sa - sb;
      if (a.hasNewFiles !== b.hasNewFiles) return a.hasNewFiles ? -1 : 1;
      return a.driver.name.localeCompare(b.driver.name);
    });
  }, [drivers, sinceDate, statuses, vacationEntries, recentlyChanged]);

  // Apply filters
  const filteredData = useMemo(() => {
    let data = driverData;
    if (showOnlyNew) data = data.filter(d => d.hasNewFiles);
    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim();
      data = data.filter(d =>
        d.driver.name.toLowerCase().includes(q) ||
        (d.driver.card_number || '').toLowerCase().includes(q)
      );
    }
    return data;
  }, [driverData, showOnlyNew, searchText]);

  const toggleStatus = async (key: string) => {
    const current = statuses[key] || '';
    const next = nextStatus(current);
    // Optimistic update
    setStatuses(prev => ({ ...prev, [key]: next }));
    // Keep item in place for 2.5s before it sinks to bottom
    if (next !== '') {
      setRecentlyChanged(prev => new Set(prev).add(key));
      setTimeout(() => {
        setRecentlyChanged(prev => {
          const s = new Set(prev);
          s.delete(key);
          return s;
        });
      }, 2500);
    }
    try {
      await setPayrollStatus(period, key, next);
    } catch {
      // Revert on error
      setStatuses(prev => ({ ...prev, [key]: current }));
      setRecentlyChanged(prev => {
        const s = new Set(prev);
        s.delete(key);
        return s;
      });
    }
  };

  const setAllStatus = async (status: PayrollStatusValue) => {
    const updates: Record<string, PayrollStatusValue> = {};
    for (const d of filteredData) {
      const key = d.driver.card_number || d.driver.name;
      updates[key] = status;
    }
    // Optimistic update
    setStatuses(prev => ({ ...prev, ...updates }));
    // Fire requests (don't await all individually)
    for (const [key, st] of Object.entries(updates)) {
      setPayrollStatus(period, key, st).catch(() => {
        // Revert single on error
        loadStatuses(period);
      });
    }
  };

  // Stats
  const totalDrivers = driverData.length;
  const driversWithNew = driverData.filter(d => d.hasNewFiles).length;
  const driversPoliczony = driverData.filter(d => d.status === 'policzony' || d.status === 'stundenzettel').length;
  const driversStz = driverData.filter(d => d.status === 'stundenzettel').length;
  const driversRemaining = driversWithNew - driverData.filter(d => d.hasNewFiles && d.status !== '').length;

  const fmtDate = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t('payrollTitle')}</h1>
          <p className="text-sm text-muted mt-1">{t('payrollSubtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="input rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={() => loadDrivers(true)}
            className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {preloading ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Spinner size="sm" />
              <span>{preloadProgress.done}/{preloadProgress.total} — {preloadProgress.current}</span>
              <button onClick={() => { preloadCancelRef.current = true; }} className="text-danger text-xs font-medium">Stop</button>
            </div>
          ) : (
            <button
              onClick={handlePreloadAll}
              disabled={drivers.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition hover:text-ink hover:bg-surface disabled:opacity-40"
              title={locale === 'de' ? 'Alle Dateien vorab analysieren (Cache)' : 'Preanalizuj wszystkie pliki (cache)'}
            >
              <Zap size={13} />
              {locale === 'de' ? 'Vorab laden' : 'Załaduj w tle'}
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard icon={<Users size={20} />} label={t('payrollTotal')} value={totalDrivers} />
        <StatCard icon={<FileText size={20} />} label={t('payrollNewFiles')} value={driversWithNew} color={driversWithNew > 0 ? 'orange' : 'primary'} />
        <StatCard icon={<CheckCircle size={20} />} label={t('payrollDone')} value={driversPoliczony} color="green" />
        <StatCard icon={<FileText size={20} />} label="Stundenzettel" value={driversStz} color="blue" />
        <StatCard icon={<Clock size={20} />} label={t('payrollRemaining')} value={driversRemaining} color={driversRemaining > 0 ? 'orange' : 'primary'} />
      </div>

      {/* Vacation upload */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
          <Upload size={14} />
          {t('payrollVacation')}
          <input ref={vacFileRef} type="file" accept="application/pdf" className="hidden" onChange={handleVacationUpload} />
        </label>
        {vacUploading && <Spinner />}
        {vacationEntries.length > 0 && (
          <span className="inline-flex items-center gap-2 text-xs text-muted">
            <Palmtree size={14} className="text-emerald-500" />
            {vacationEntries.length} {t('payrollDriver')}
            <button onClick={() => setVacationEntries([])} className="text-muted hover:text-ink">
              <X size={14} />
            </button>
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOnlyNew}
            onChange={e => setShowOnlyNew(e.target.checked)}
            className="accent-primary-500"
          />
          <Filter size={14} className="text-muted" />
          {t('payrollShowOnlyNew')}
        </label>
        <div className="flex-1 min-w-[200px] max-w-xs">
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={t('payrollSearchPlaceholder')}
            className="input w-full rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setAllStatus('policzony')}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            {t('payrollCheckAll')}
          </button>
          <span className="text-xs text-muted">|</span>
          <button
            onClick={() => setAllStatus('')}
            className="text-xs text-muted hover:text-ink font-medium"
          >
            {t('payrollUncheckAll')}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Drivers table */}
      {loading && drivers.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="w-10 px-3 py-3" />
                <th className="text-left px-3 py-3 font-semibold text-muted">{t('payrollDriver')}</th>
                <th className="text-left px-3 py-3 font-semibold text-muted hidden sm:table-cell">{t('payrollCard')}</th>
                <th className="text-center px-3 py-3 font-semibold text-muted">{t('payrollFilesNew')}</th>
                <th className="text-left px-3 py-3 font-semibold text-muted hidden md:table-cell">{t('payrollLastDownload')}</th>
                <th className="text-center px-3 py-3 font-semibold text-muted hidden sm:table-cell">{t('payrollVacation')}</th>
                <th className="text-center px-3 py-3 font-semibold text-muted">{t('payrollStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map(({ driver: d, newFilesCount, hasNewFiles, latestNewFile, status, vacation }) => {
                const key = d.card_number || d.name;
                const isDone = status === 'policzony';
                return (
                  <tr
                    key={key}
                    onClick={() => {
                      if (d.files.length > 0) {
                        const vacParam = vacation ? `&vacation=${encodeURIComponent(JSON.stringify(vacation.ranges))}` : '';
                        const fileInfo = `&fileDate=${d.files[0].file_date || ''}&fileModified=${d.files[0].modified || ''}`;
                        navigate(`/payroll/${encodeURIComponent(d.card_number || d.name)}?period=${period}&path=${encodeURIComponent(d.files[0].path)}&name=${encodeURIComponent(d.name)}${vacParam}${fileInfo}`);
                      }
                    }}
                    className={`border-b border-border cursor-pointer transition-colors min-h-[44px] ${
                      status === 'stundenzettel'
                        ? 'bg-blue-50/50 dark:bg-blue-900/10 hover:bg-blue-100/50 dark:hover:bg-blue-900/20'
                        : status === 'policzony'
                        ? 'bg-success/5 hover:bg-success/10'
                        : hasNewFiles
                        ? 'bg-orange-50/50 dark:bg-orange-900/5 hover:bg-orange-50 dark:hover:bg-orange-900/10'
                        : 'hover:bg-surface'
                    }`}
                  >
                    <td className="px-3 py-3 text-center" onClick={(e) => { e.stopPropagation(); toggleStatus(key); }}>
                      {status === 'stundenzettel'
                        ? <FileText size={18} className="text-blue-500 mx-auto cursor-pointer hover:opacity-70" />
                        : status === 'policzony'
                        ? <CheckSquare size={18} className="text-success mx-auto cursor-pointer hover:opacity-70" />
                        : <Square size={18} className="text-muted mx-auto cursor-pointer hover:opacity-70" />
                      }
                    </td>
                    <td className="px-3 py-3">
                      <span className={`font-medium ${isDone ? 'text-muted line-through' : 'text-ink'}`}>
                        {d.name}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted text-xs font-mono hidden sm:table-cell">
                      {d.card_number || '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {hasNewFiles ? (
                        <Badge variant="orange">{newFilesCount}</Badge>
                      ) : (
                        <span className="text-xs text-muted">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted hidden md:table-cell">
                      {latestNewFile ? fmtDate(latestNewFile.modified) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center hidden sm:table-cell">
                      {vacation ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300" title={vacation.ranges.map(r => `${r.von} – ${r.bis}`).join(', ')}>
                          <Palmtree size={12} />
                          {vacation.total_tage} {t('days')}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {status === 'stundenzettel' ? (
                        <Badge variant="blue" dot>Stundenzettel</Badge>
                      ) : status === 'policzony' ? (
                        <Badge variant="green" dot>{t('payrollChecked')}</Badge>
                      ) : hasNewFiles ? (
                        <Badge variant="orange" dot>{t('payrollPending')}</Badge>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted">
                    {t('noData')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

    </div>
  );
}

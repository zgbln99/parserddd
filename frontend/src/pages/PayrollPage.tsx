import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users, RefreshCw, CheckCircle, Circle, AlertCircle,
  FileText, Clock, CheckSquare, Square, Filter, BarChart3,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { fetchDrivers } from '../lib/api';
import { Card, StatCard } from '../components/Card';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import type { Driver } from '../types';

// Persist checked state in localStorage per month
function getCheckedKey(period: string) {
  return `ddd-payroll-${period}`;
}

function loadChecked(period: string): Set<string> {
  try {
    const raw = localStorage.getItem(getCheckedKey(period));
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveChecked(period: string, checked: Set<string>) {
  localStorage.setItem(getCheckedKey(period), JSON.stringify(Array.from(checked)));
}

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getSavedPeriod() {
  return localStorage.getItem('ddd-payroll-period') || getCurrentPeriod();
}

export function PayrollPage() {
  const { t } = useI18n();
  const [period, setPeriodState] = useState(getSavedPeriod);

  const setPeriod = (p: string) => {
    setPeriodState(p);
    localStorage.setItem('ddd-payroll-period', p);
  };

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<Set<string>>(() => loadChecked(getCurrentPeriod()));
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [searchText, setSearchText] = useState('');

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

  const navigate = useNavigate();

  useEffect(() => { loadDrivers(); }, [loadDrivers]);

  // When period changes, load checked state for that period
  useEffect(() => {
    setChecked(loadChecked(period));
  }, [period]);

  // Save checked state whenever it changes
  useEffect(() => {
    saveChecked(period, checked);
  }, [period, checked]);

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
      return {
        driver: d,
        newFilesCount: newFiles.length,
        hasNewFiles,
        latestNewFile,
        isChecked: checked.has(d.card_number || d.name),
      };
    }).sort((a, b) => {
      // Unchecked with new files first, then unchecked without, then checked
      if (a.isChecked !== b.isChecked) return a.isChecked ? 1 : -1;
      if (a.hasNewFiles !== b.hasNewFiles) return a.hasNewFiles ? -1 : 1;
      return a.driver.name.localeCompare(b.driver.name);
    });
  }, [drivers, sinceDate, checked]);

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

  const toggleCheck = (key: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const checkAll = () => {
    setChecked(new Set(filteredData.map(d => d.driver.card_number || d.driver.name)));
  };

  const uncheckAll = () => {
    setChecked(new Set());
  };

  // Stats
  const totalDrivers = driverData.length;
  const driversWithNew = driverData.filter(d => d.hasNewFiles).length;
  const driversChecked = driverData.filter(d => d.isChecked).length;
  const driversRemaining = driversWithNew - driverData.filter(d => d.hasNewFiles && d.isChecked).length;

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
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition hover:text-ink disabled:opacity-50"
          >
            {loading ? <Spinner size="sm" /> : <RefreshCw size={14} />}
            {t('refresh')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('payrollTotal')}
          value={totalDrivers}
          icon={<Users size={20} />}
          color="primary"
        />
        <StatCard
          label={t('payrollNewFiles')}
          value={driversWithNew}
          icon={<FileText size={20} />}
          color="orange"
        />
        <StatCard
          label={t('payrollDone')}
          value={driversChecked}
          icon={<CheckCircle size={20} />}
          color="green"
        />
        <StatCard
          label={t('payrollRemaining')}
          value={driversRemaining}
          icon={<Clock size={20} />}
          color={driversRemaining > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Progress bar */}
      {driversWithNew > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-ink">{t('payrollProgress')}</span>
            <span className="text-sm font-bold text-ink">
              {driversWithNew - driversRemaining} / {driversWithNew}
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-success transition-all duration-500"
              style={{ width: `${driversWithNew > 0 ? ((driversWithNew - driversRemaining) / driversWithNew) * 100 : 0}%` }}
            />
          </div>
        </Card>
      )}

      {/* Filters bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setShowOnlyNew(!showOnlyNew)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            showOnlyNew
              ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          <Filter size={12} />
          {t('payrollShowOnlyNew')}
        </button>
        <div className="flex-1 max-w-xs">
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
            onClick={checkAll}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            {t('payrollCheckAll')}
          </button>
          <span className="text-xs text-muted">|</span>
          <button
            onClick={uncheckAll}
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
                <th className="text-center px-3 py-3 font-semibold text-muted">{t('payrollStatus')}</th>
                <th className="w-10 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filteredData.map(({ driver: d, newFilesCount, hasNewFiles, latestNewFile, isChecked }) => {
                const key = d.card_number || d.name;
                return (
                  <tr
                    key={key}
                    onClick={() => toggleCheck(key)}
                    className={`border-b border-border cursor-pointer transition-colors min-h-[44px] ${
                      isChecked
                        ? 'bg-success/5 hover:bg-success/10'
                        : hasNewFiles
                        ? 'bg-orange-50/50 dark:bg-orange-900/5 hover:bg-orange-50 dark:hover:bg-orange-900/10'
                        : 'hover:bg-surface'
                    }`}
                  >
                    <td className="px-3 py-3 text-center">
                      {isChecked
                        ? <CheckSquare size={18} className="text-success mx-auto" />
                        : <Square size={18} className="text-muted mx-auto" />
                      }
                    </td>
                    <td className="px-3 py-3">
                      <span className={`font-medium ${isChecked ? 'text-muted line-through' : 'text-ink'}`}>
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
                    <td className="px-3 py-3 text-center">
                      {isChecked ? (
                        <Badge variant="green" dot>{t('payrollChecked')}</Badge>
                      ) : hasNewFiles ? (
                        <Badge variant="orange" dot>{t('payrollPending')}</Badge>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {d.files.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/payroll/${encodeURIComponent(d.card_number || d.name)}?period=${period}&path=${encodeURIComponent(d.files[0].path)}&name=${encodeURIComponent(d.name)}`);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                          title={t('payrollAnalyze')}
                        >
                          <BarChart3 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted">
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

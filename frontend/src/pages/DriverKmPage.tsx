import { useState, useMemo, useCallback, useEffect } from 'react';
import { RefreshCw, AlertCircle, Calendar, MapPin, ChevronDown, ChevronRight, Users, Check } from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchDrivers, fetchDriverKm } from '../lib/api';
import type { DriverKmEntry } from '../lib/api';
import type { Driver } from '../types';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';

export function DriverKmPage() {
  const { t } = useI18n();
  const { dateFrom: globalDateFrom } = useDateFilter();
  const [loading, setLoading] = useState(false);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<DriverKmEntry[]>([]);
  const [hasResults, setHasResults] = useState(false);
  const [expandedDrivers, setExpandedDrivers] = useState<Set<string>>(new Set());

  // Driver list from Dropbox
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [selectedDrivers, setSelectedDrivers] = useState<Set<string>>(new Set());

  // Date range
  const defaultMonth = useMemo(() => {
    if (globalDateFrom) return globalDateFrom.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [globalDateFrom]);

  const [dateFrom, setDateFrom] = useState(() => `${defaultMonth}-01`);
  const [dateTo, setDateTo] = useState(() => {
    const [y, m] = defaultMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${defaultMonth}-${String(lastDay).padStart(2, '0')}`;
  });

  // Load driver list on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingDrivers(true);
    fetchDrivers()
      .then(data => {
        if (cancelled) return;
        const drv = (data.drivers || []).filter((d: Driver) => d.files.length > 0);
        drv.sort((a: Driver, b: Driver) => a.name.localeCompare(b.name));
        setAllDrivers(drv);
        // Select all by default
        setSelectedDrivers(new Set(drv.map((d: Driver) => d.name)));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingDrivers(false); });
    return () => { cancelled = true; };
  }, []);

  const toggleDriver = (name: string) => {
    setSelectedDrivers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setSelectedDrivers(new Set(allDrivers.map(d => d.name)));
  const selectNone = () => setSelectedDrivers(new Set());

  const handleGenerate = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    if (selectedDrivers.size === 0) return;
    setLoading(true);
    setError('');
    setResults([]);
    setHasResults(false);
    try {
      const data = await fetchDriverKm(dateFrom, dateTo, Array.from(selectedDrivers));
      setResults(data.drivers || []);
      setHasResults(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedDrivers]);

  const toggleExpand = (name: string) => {
    setExpandedDrivers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const grandTotal = useMemo(() => results.reduce((s, d) => s + d.total_km, 0), [results]);
  const fmtKm = (km: number) => km.toLocaleString('de-DE');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t('driverKmTitle')}
        </h1>
        <p className="text-sm text-muted dark:text-muted-dark mt-1">
          {t('driverKmSubtitle')}
        </p>
      </div>

      {/* Controls */}
      <Card>
        <div className="p-4 space-y-4">
          {/* Date range */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-muted dark:text-muted-dark mb-1">
                {t('driverKmDateFrom')}
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="block w-44 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted dark:text-muted-dark mb-1">
                {t('driverKmDateTo')}
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="block w-44 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || selectedDrivers.size === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
              {t('driverKmGenerate')}
            </button>
          </div>

          {/* Driver selection */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center gap-1 text-xs font-medium text-muted dark:text-muted-dark">
                <Users className="w-3.5 h-3.5" />
                {t('driverKmSelectDrivers')}
                <span className="ml-1 text-blue-600 dark:text-blue-400">
                  ({selectedDrivers.size}/{allDrivers.length})
                </span>
              </div>
              <button
                onClick={selectAll}
                className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
              >
                {t('driverKmSelectAll')}
              </button>
              <button
                onClick={selectNone}
                className="text-xs text-gray-400 hover:text-muted dark:text-muted-dark dark:hover:text-gray-300"
              >
                {t('driverKmSelectNone')}
              </button>
            </div>

            {loadingDrivers ? (
              <div className="flex items-center gap-2 text-sm text-muted dark:text-muted-dark py-2">
                <Spinner size="sm" />
                <span>{t('driverKmLoadingDrivers')}</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allDrivers.map(d => {
                  const selected = selectedDrivers.has(d.name);
                  return (
                    <button
                      key={d.name}
                      onClick={() => toggleDriver(d.name)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        selected
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700'
                          : 'bg-gray-100 dark:bg-gray-800 text-muted dark:text-muted-dark hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {selected && <Check className="w-3 h-3" />}
                      {d.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-3 py-12 text-muted dark:text-muted-dark">
          <Spinner />
          <span>{t('driverKmLoading')}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && results.length === 0 && !hasResults && (
        <div className="text-center py-12 text-muted dark:text-muted-dark">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>{t('driverKmNoData')}</p>
        </div>
      )}

      {/* No drivers for period */}
      {!loading && hasResults && results.length === 0 && (
        <div className="text-center py-12 text-muted dark:text-muted-dark">
          <MapPin className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>{t('driverKmNoDrivers')}</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-semibold text-muted dark:text-muted-dark w-8" />
                  <th className="text-left px-4 py-3 font-semibold text-muted dark:text-muted-dark">
                    {t('driverKmDriver')}
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-muted dark:text-muted-dark">
                    {t('driverKmPlate')}
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-muted dark:text-muted-dark">
                    {t('driverKmFirstUse')}
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-muted dark:text-muted-dark">
                    {t('driverKmLastUse')}
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-muted dark:text-muted-dark">
                    {t('driverKmOdoBegin')}
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-muted dark:text-muted-dark">
                    {t('driverKmOdoEnd')}
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-muted dark:text-muted-dark">
                    {t('driverKmDistance')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map(driver => {
                  const isExpanded = expandedDrivers.has(driver.driver_name);
                  const hasMultiple = driver.vehicles.length > 1;

                  return (
                    <>
                      {/* Summary row */}
                      <tr
                        key={`summary-${driver.driver_name}`}
                        className={`border-b border-gray-100 dark:border-gray-700/50 ${
                          hasMultiple ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30' : ''
                        }`}
                        onClick={() => hasMultiple && toggleExpand(driver.driver_name)}
                      >
                        <td className="px-4 py-3 text-muted dark:text-muted-dark">
                          {hasMultiple && (
                            isExpanded
                              ? <ChevronDown className="w-4 h-4" />
                              : <ChevronRight className="w-4 h-4" />
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                          {driver.driver_name}
                        </td>
                        {!hasMultiple && driver.vehicles[0] ? (
                          <>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300 font-mono text-xs">
                              {driver.vehicles[0].plate}
                            </td>
                            <td className="px-4 py-3 text-muted dark:text-muted-dark text-xs">
                              {driver.vehicles[0].first_use?.slice(0, 10)}
                            </td>
                            <td className="px-4 py-3 text-muted dark:text-muted-dark text-xs">
                              {driver.vehicles[0].last_use?.slice(0, 10)}
                            </td>
                            <td className="px-4 py-3 text-right text-muted dark:text-muted-dark font-mono text-xs">
                              {fmtKm(driver.vehicles[0].odometer_begin_km)}
                            </td>
                            <td className="px-4 py-3 text-right text-muted dark:text-muted-dark font-mono text-xs">
                              {fmtKm(driver.vehicles[0].odometer_end_km)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-muted dark:text-muted-dark text-xs">
                              {driver.vehicles.length} {t('driverKmVehiclesCount')}
                            </td>
                            <td className="px-4 py-3" />
                            <td className="px-4 py-3" />
                            <td className="px-4 py-3" />
                            <td className="px-4 py-3" />
                          </>
                        )}
                        <td className="px-4 py-3 text-right font-bold text-blue-600 dark:text-blue-400 font-mono">
                          {fmtKm(driver.total_km)}
                        </td>
                      </tr>

                      {/* Expanded vehicle rows */}
                      {isExpanded && driver.vehicles.map((v, idx) => (
                        <tr
                          key={`${driver.driver_name}-v-${idx}`}
                          className="border-b border-gray-50 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20"
                        >
                          <td className="px-4 py-2" />
                          <td className="px-4 py-2" />
                          <td className="px-4 py-2 text-gray-700 dark:text-gray-300 font-mono text-xs">
                            {v.plate}
                          </td>
                          <td className="px-4 py-2 text-muted dark:text-muted-dark text-xs">
                            {v.first_use?.slice(0, 10)}
                          </td>
                          <td className="px-4 py-2 text-muted dark:text-muted-dark text-xs">
                            {v.last_use?.slice(0, 10)}
                          </td>
                          <td className="px-4 py-2 text-right text-muted dark:text-muted-dark font-mono text-xs">
                            {fmtKm(v.odometer_begin_km)}
                          </td>
                          <td className="px-4 py-2 text-right text-muted dark:text-muted-dark font-mono text-xs">
                            {fmtKm(v.odometer_end_km)}
                          </td>
                          <td className="px-4 py-2 text-right text-muted dark:text-muted-dark font-mono text-xs">
                            {fmtKm(v.distance_km)}
                          </td>
                        </tr>
                      ))}
                    </>
                  );
                })}

                {/* Grand total */}
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-bold">
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-gray-900 dark:text-white">
                    {t('driverKmTotal')}
                  </td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark text-xs">
                    {results.length} {t('driverKmDriversCount')}
                  </td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right text-blue-700 dark:text-blue-300 font-mono text-lg">
                    {fmtKm(grandTotal)} km
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

import { useState, useMemo, useCallback } from 'react';
import { RefreshCw, AlertCircle, Calendar, MapPin, ChevronDown, ChevronRight } from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchDriverKm } from '../lib/api';
import type { DriverKmEntry } from '../lib/api';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';

export function DriverKmPage() {
  const { t } = useI18n();
  const { dateFrom } = useDateFilter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drivers, setDrivers] = useState<DriverKmEntry[]>([]);
  const [period, setPeriod] = useState('');
  const [expandedDrivers, setExpandedDrivers] = useState<Set<string>>(new Set());

  const defaultPeriod = useMemo(() => {
    if (dateFrom) return dateFrom.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [dateFrom]);

  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod);

  const handleGenerate = useCallback(async () => {
    const p = selectedPeriod || defaultPeriod;
    setLoading(true);
    setError('');
    setDrivers([]);
    setPeriod('');
    try {
      const data = await fetchDriverKm(p);
      setDrivers(data.drivers || []);
      setPeriod(data.period || p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, defaultPeriod]);

  const toggleDriver = (name: string) => {
    setExpandedDrivers(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const grandTotal = useMemo(() => drivers.reduce((s, d) => s + d.total_km, 0), [drivers]);

  const fmtKm = (km: number) => km.toLocaleString('de-DE');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t('driverKmTitle')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('driverKmSubtitle')}
        </p>
      </div>

      {/* Controls */}
      <Card>
        <div className="flex flex-wrap items-end gap-4 p-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('driverKmPeriod')}
            </label>
            <input
              type="month"
              value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value)}
              className="block w-44 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
            {t('driverKmGenerate')}
          </button>
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
        <div className="flex items-center justify-center gap-3 py-12 text-gray-500 dark:text-gray-400">
          <Spinner />
          <span>{t('driverKmLoading')}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && drivers.length === 0 && !period && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>{t('driverKmNoData')}</p>
        </div>
      )}

      {/* No drivers for period */}
      {!loading && period && drivers.length === 0 && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <MapPin className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>{t('driverKmNoDrivers')}</p>
        </div>
      )}

      {/* Results */}
      {drivers.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-8" />
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                    {t('driverKmDriver')}
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                    {t('driverKmPlate')}
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                    {t('driverKmFirstUse')}
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                    {t('driverKmLastUse')}
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                    {t('driverKmOdoBegin')}
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                    {t('driverKmOdoEnd')}
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                    {t('driverKmDistance')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {drivers.map(driver => {
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
                        onClick={() => hasMultiple && toggleDriver(driver.driver_name)}
                      >
                        <td className="px-4 py-3 text-gray-400">
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
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                              {driver.vehicles[0].first_use?.slice(0, 10)}
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                              {driver.vehicles[0].last_use?.slice(0, 10)}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 font-mono text-xs">
                              {fmtKm(driver.vehicles[0].odometer_begin_km)}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 font-mono text-xs">
                              {fmtKm(driver.vehicles[0].odometer_end_km)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 text-gray-400 text-xs">
                              {driver.vehicles.length} pojazd(ów)
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
                          <td className="px-4 py-2 text-gray-500 dark:text-gray-400 text-xs">
                            {v.first_use?.slice(0, 10)}
                          </td>
                          <td className="px-4 py-2 text-gray-500 dark:text-gray-400 text-xs">
                            {v.last_use?.slice(0, 10)}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 font-mono text-xs">
                            {fmtKm(v.odometer_begin_km)}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 font-mono text-xs">
                            {fmtKm(v.odometer_end_km)}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300 font-mono text-xs">
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
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {drivers.length} kierowców
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

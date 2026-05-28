import { useState, useEffect, useCallback, useMemo } from 'react';
import { Gauge, RefreshCw, AlertCircle, Calendar, Truck, Search } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import {
  fetchSamsaraVehicles,
  fetchOdometerCurrent,
  fetchOdometerDay,
  type SamsaraVehicle,
  type OdometerCurrentEntry,
  type OdometerDayEntry,
} from '../lib/api';

type Mode = 'current' | 'day';

function fmtKm(n: number | null | undefined): string {
  if (n == null) return '–';
  return Math.round(n).toLocaleString('de-DE');
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return '–';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '–';
    return d.toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function OdometerPage() {
  const { t } = useI18n();

  const [mode, setMode] = useState<Mode>('current');
  const [date, setDate] = useState(todayIso());
  const [vehicleList, setVehicleList] = useState<SamsaraVehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentRows, setCurrentRows] = useState<OdometerCurrentEntry[]>([]);
  const [dayRows, setDayRows] = useState<OdometerDayEntry[]>([]);

  useEffect(() => {
    setLoadingVehicles(true);
    fetchSamsaraVehicles()
      .then(res => setVehicleList(res.vehicles.filter(v => !v.name.toLowerCase().startsWith('deactivated'))))
      .catch(e => setError(e.message))
      .finally(() => setLoadingVehicles(false));
  }, []);

  const filteredVehicles = useMemo(() => {
    if (!searchQuery.trim()) return vehicleList;
    const q = searchQuery.toLowerCase();
    return vehicleList.filter(v =>
      v.name.toLowerCase().includes(q) ||
      v.license_plate.toLowerCase().includes(q),
    );
  }, [vehicleList, searchQuery]);

  const toggleVehicle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredVehicles.map(v => v.id)));
  };

  const clearAll = () => {
    setSelectedIds(new Set());
  };

  const handleFetch = useCallback(() => {
    setLoading(true);
    setError('');
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
    const promise = mode === 'current'
      ? fetchOdometerCurrent(ids).then(res => { setCurrentRows(res.vehicles); setDayRows([]); })
      : fetchOdometerDay(date, ids).then(res => { setDayRows(res.vehicles); setCurrentRows([]); });
    promise
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [mode, date, selectedIds]);

  const sortedCurrent = useMemo(
    () => [...currentRows].sort((a, b) => (b.odometer_km || 0) - (a.odometer_km || 0)),
    [currentRows],
  );

  const sortedDay = useMemo(
    () => [...dayRows].sort((a, b) => (b.driven_km || 0) - (a.driven_km || 0)),
    [dayRows],
  );

  const totalDriven = useMemo(
    () => sortedDay.reduce((s, r) => s + (r.driven_km || 0), 0),
    [sortedDay],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Gauge className="w-6 h-6 text-blue-500" />
          {t('odoTitle')}
        </h1>
        <p className="text-sm text-muted mt-1">{t('odoSubtitle')}</p>
      </div>

      {/* Mode + date + fetch */}
      <Card>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setMode('current')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mode === 'current'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
              }`}
            >
              {t('odoModeCurrent')}
            </button>
            <button
              onClick={() => setMode('day')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mode === 'day'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
              }`}
            >
              {t('odoDayMode')}
            </button>

            {mode === 'day' && (
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted" />
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  max={todayIso()}
                  className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                />
              </div>
            )}

            <button
              onClick={handleFetch}
              disabled={loading}
              className="ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {loading ? <Spinner /> : <RefreshCw className="w-4 h-4" />}
              {t('odoFetch')}
            </button>
          </div>

          {/* Vehicle filter */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder={t('odoVehicle')}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                />
              </div>
              <button onClick={selectAll} className="text-xs text-blue-600 hover:underline">
                {t('odoAllVehicles')} ({filteredVehicles.length})
              </button>
              <button onClick={clearAll} className="text-xs text-muted hover:text-red-500">
                ✕
              </button>
            </div>
            {loadingVehicles ? (
              <div className="text-xs text-muted"><Spinner /></div>
            ) : (
              <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                {filteredVehicles.map(v => {
                  const isSelected = selectedIds.has(v.id);
                  return (
                    <button
                      key={v.id}
                      onClick={() => toggleVehicle(v.id)}
                      className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                        isSelected
                          ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      {v.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="text-xs text-muted mt-2">
              {selectedIds.size > 0
                ? `${selectedIds.size} selected`
                : t('odoAllVehicles')}
            </div>
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

      {/* Results */}
      {loading && (
        <Card>
          <div className="p-8 text-center text-muted">
            <Spinner />
            <div className="mt-2 text-sm">{t('odoLoading')}</div>
          </div>
        </Card>
      )}

      {!loading && mode === 'current' && currentRows.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-3 py-3 font-semibold text-muted">{t('odoVehicle')}</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted">{t('odoPlate')}</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted">{t('odoCurrentKm')}</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted">{t('odoUpdated')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedCurrent.map(r => (
                  <tr key={r.vehicle_id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Truck className="w-4 h-4 text-muted" />
                        <span className="font-mono">{r.vehicle_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted font-mono">{r.license_plate || '–'}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                      {fmtKm(r.odometer_km)} km
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted">{fmtTs(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && mode === 'day' && dayRows.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-3 py-3 font-semibold text-muted">{t('odoVehicle')}</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted">{t('odoPlate')}</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted">{t('odoStartKm')}</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted">{t('odoEndKm')}</th>
                  <th className="text-right px-3 py-3 font-semibold text-emerald-600 dark:text-emerald-400">{t('odoDrivenKm')}</th>
                  <th className="text-right px-3 py-3 font-semibold text-muted">{t('odoReadings')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedDay.map(r => (
                  <tr key={r.vehicle_id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Truck className="w-4 h-4 text-muted" />
                        <span className="font-mono">{r.vehicle_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted font-mono">{r.license_plate || '–'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-muted">{fmtKm(r.odometer_start_km)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-muted">{fmtKm(r.odometer_end_km)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {r.driven_km != null ? `${fmtKm(r.driven_km)} km` : '–'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted">{r.readings_count}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-bold">
                  <td className="px-3 py-3" colSpan={4} />
                  <td className="px-3 py-3 text-right font-mono text-emerald-700 dark:text-emerald-300 text-base">
                    {fmtKm(totalDriven)} km
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && currentRows.length === 0 && dayRows.length === 0 && !error && (
        <Card>
          <div className="p-8 text-center text-muted text-sm">
            {t('odoNoData')}
          </div>
        </Card>
      )}
    </div>
  );
}

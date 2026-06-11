import { useState, useEffect, useCallback, useMemo } from 'react';
import { Gauge, RefreshCw, AlertCircle, Truck, Search, ChevronDown, ChevronRight, FileDown } from 'lucide-react';
import { useI18n } from '../i18n';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
// pdf-generator is lazy-loaded on demand (heavy: jsPDF + fonts).
import {
  fetchSamsaraVehicles,
  fetchOdometerCurrent,
  fetchOdometerRange,
  type SamsaraVehicle,
  type OdometerCurrentEntry,
  type OdometerRangeRow,
} from '../lib/api';

type Mode = 'current' | 'range';

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

function fmtDate(s: string): string {
  if (!s) return '–';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoMonthStart(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function isoMonthEnd(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset + 1);
  d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Group range rows by vehicle
function groupByVehicle(rows: OdometerRangeRow[]): Map<string, OdometerRangeRow[]> {
  const map = new Map<string, OdometerRangeRow[]>();
  for (const r of rows) {
    const key = r.vehicle_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  // Sort each vehicle's rows by date
  for (const [, vrows] of map) vrows.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

export function OdometerPage() {
  const { t } = useI18n();
  const today = isoToday();

  const [mode, setMode] = useState<Mode>('range');
  const [dateFrom, setDateFrom] = useState(isoMonthStart(0));
  const [dateTo, setDateTo] = useState(today);

  const [vehicleList, setVehicleList] = useState<SamsaraVehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentRows, setCurrentRows] = useState<OdometerCurrentEntry[]>([]);
  const [rangeRows, setRangeRows] = useState<OdometerRangeRow[]>([]);

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
      v.name.toLowerCase().includes(q) || v.license_plate.toLowerCase().includes(q),
    );
  }, [vehicleList, searchQuery]);

  const toggleVehicle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleFetch = useCallback(() => {
    setLoading(true);
    setError('');
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
    if (mode === 'current') {
      fetchOdometerCurrent(ids)
        .then(res => { setCurrentRows(res.vehicles); setRangeRows([]); })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      fetchOdometerRange(dateFrom, dateTo, ids)
        .then(res => { setRangeRows(res.rows); setCurrentRows([]); setCollapsed(new Set()); })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [mode, dateFrom, dateTo, selectedIds]);

  const sortedCurrent = useMemo(
    () => [...currentRows].sort((a, b) => (b.odometer_km || 0) - (a.odometer_km || 0)),
    [currentRows],
  );

  const vehicleGroups = useMemo(() => groupByVehicle(rangeRows), [rangeRows]);

  const vehicleOrder = useMemo(
    () => [...vehicleGroups.keys()].sort((a, b) => {
      const na = vehicleGroups.get(a)![0].vehicle_name;
      const nb = vehicleGroups.get(b)![0].vehicle_name;
      return na.localeCompare(nb);
    }),
    [vehicleGroups],
  );

  const grandTotal = useMemo(
    () => rangeRows.reduce((s, r) => s + (r.driven_km || 0), 0),
    [rangeRows],
  );

  const exportCurrentPdf = async () =>
    (await import('../lib/pdf-generator')).generateOdometerCurrentPdf(
      sortedCurrent.map((r) => ({
        vehicle_name: r.vehicle_name,
        license_plate: r.license_plate,
        odometer_km: r.odometer_km,
        updated_at: r.updated_at,
      })),
    );

  const exportRangePdf = async () =>
    (await import('../lib/pdf-generator')).generateOdometerRangePdf(
      vehicleOrder.map((vid) => {
        const vr = vehicleGroups.get(vid)!;
        return {
          vehicle_name: vr[0].vehicle_name,
          license_plate: vr[0].license_plate,
          days: vr.map((r) => ({
            date: r.date,
            odometer_start_km: r.odometer_start_km,
            odometer_end_km: r.odometer_end_km,
            driven_km: r.driven_km,
            readings_count: r.readings_count,
          })),
        };
      }),
      dateFrom,
      dateTo,
    );

  const toggleCollapse = (vid: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(vid)) next.delete(vid); else next.add(vid);
      return next;
    });
  };

  const setRange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Gauge className="w-6 h-6 text-blue-500" />
          {t('odoTitle')}
        </h1>
        <p className="text-sm text-muted mt-1">{t('odoSubtitle')}</p>
      </div>

      {/* Controls */}
      <Card>
        <div className="p-4 space-y-4">
          {/* Mode */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['current', 'range'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  mode === m
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                {m === 'current' ? t('odoModeCurrent') : t('odoModeRange')}
              </button>
            ))}
          </div>

          {/* Date range */}
          {mode === 'range' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted">{t('odoDateFrom')}</span>
                  <input
                    type="date"
                    value={dateFrom}
                    max={dateTo}
                    onChange={e => setDateFrom(e.target.value)}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted">{t('odoDateTo')}</span>
                  <input
                    type="date"
                    value={dateTo}
                    min={dateFrom}
                    max={today}
                    onChange={e => setDateTo(e.target.value)}
                    className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              {/* Quick range buttons */}
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { label: t('odoToday'), from: today, to: today },
                  { label: t('odo7Days'), from: isoOffset(-6), to: today },
                  { label: t('odoThisMonth'), from: isoMonthStart(0), to: today },
                  { label: t('odoLastMonth'), from: isoMonthStart(-1), to: isoMonthEnd(-1) },
                ].map(({ label, from, to }) => (
                  <button
                    key={label}
                    onClick={() => setRange(from, to)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      dateFrom === from && dateTo === to
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Fetch button */}
          <div className="flex justify-end">
            <button
              onClick={handleFetch}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {loading ? <Spinner /> : <RefreshCw className="w-4 h-4" />}
              {t('odoFetch')}
            </button>
          </div>

          {/* Vehicle filter */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
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
              <button
                onClick={() => setSelectedIds(new Set(filteredVehicles.map(v => v.id)))}
                className="text-xs text-blue-600 hover:underline"
              >
                {t('odoAllVehicles')} ({filteredVehicles.length})
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-muted hover:text-red-500"
              >
                ✕
              </button>
            </div>
            {loadingVehicles ? (
              <Spinner />
            ) : (
              <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                {filteredVehicles.map(v => {
                  const sel = selectedIds.has(v.id);
                  return (
                    <button
                      key={v.id}
                      onClick={() => toggleVehicle(v.id)}
                      className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                        sel
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
            <div className="text-xs text-muted">
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : t('odoAllVehicles')}
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

      {/* Loading */}
      {loading && (
        <Card>
          <div className="p-8 text-center text-muted">
            <Spinner />
            <div className="mt-2 text-sm">{t('odoLoading')}</div>
          </div>
        </Card>
      )}

      {/* Current results */}
      {!loading && mode === 'current' && currentRows.length > 0 && (
        <Card>
          <div className="flex justify-end border-b border-gray-100 dark:border-gray-800 p-2.5">
            <button
              onClick={exportCurrentPdf}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
            >
              <FileDown className="h-3.5 w-3.5" />
              {t('analysisExportPdf')}
            </button>
          </div>
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

      {/* Range results — grouped by vehicle */}
      {!loading && mode === 'range' && vehicleOrder.length > 0 && (
        <div className="space-y-3">
          {/* Grand total bar */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700">
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              {t('odoTotal')} ({fmtDate(dateFrom)} – {fmtDate(dateTo)})
            </span>
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-300">
                {fmtKm(grandTotal)} km
              </span>
              <button
                onClick={exportRangePdf}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
              >
                <FileDown className="h-3.5 w-3.5" />
                {t('analysisExportPdf')}
              </button>
            </div>
          </div>

          {/* Per-vehicle sections */}
          {vehicleOrder.map(vid => {
            const vrows = vehicleGroups.get(vid)!;
            const vehicleName = vrows[0].vehicle_name;
            const plate = vrows[0].license_plate;
            const vehicleTotal = vrows.reduce((s, r) => s + (r.driven_km || 0), 0);
            const isCollapsed = collapsed.has(vid);

            return (
              <Card key={vid}>
                {/* Vehicle header */}
                <button
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded-t-lg"
                  onClick={() => toggleCollapse(vid)}
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed
                      ? <ChevronRight className="w-4 h-4 text-muted" />
                      : <ChevronDown className="w-4 h-4 text-muted" />
                    }
                    <Truck className="w-4 h-4 text-blue-500" />
                    <span className="font-semibold text-gray-900 dark:text-white font-mono">{vehicleName}</span>
                    {plate && <span className="text-xs text-muted font-mono">{plate}</span>}
                    <span className="text-xs text-muted">({vrows.length} dni)</span>
                  </div>
                  <span className="font-bold font-mono text-emerald-700 dark:text-emerald-300">
                    {fmtKm(vehicleTotal)} km
                  </span>
                </button>

                {/* Day rows */}
                {!isCollapsed && (
                  <div className="overflow-x-auto border-t border-gray-200 dark:border-gray-700">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800/50">
                          <th className="text-left px-4 py-2 font-semibold text-muted">{t('odoDate')}</th>
                          <th className="text-right px-4 py-2 font-semibold text-muted">{t('odoStartKm')}</th>
                          <th className="text-right px-4 py-2 font-semibold text-muted">{t('odoEndKm')}</th>
                          <th className="text-right px-4 py-2 font-semibold text-emerald-600 dark:text-emerald-400">{t('odoDrivenKm')}</th>
                          <th className="text-right px-4 py-2 font-semibold text-muted text-xs">{t('odoReadings')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vrows.map(r => (
                          <tr key={r.date} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">
                              {fmtDate(r.date)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-muted text-xs">
                              {fmtKm(r.odometer_start_km)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-muted text-xs">
                              {fmtKm(r.odometer_end_km)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                              {r.driven_km != null ? `${fmtKm(r.driven_km)} km` : '–'}
                            </td>
                            <td className="px-4 py-2 text-right text-xs text-muted">
                              {r.readings_count}
                            </td>
                          </tr>
                        ))}
                        {/* Vehicle subtotal */}
                        <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50">
                          <td className="px-4 py-2.5 text-xs font-semibold text-muted" colSpan={3}>
                            {t('odoTotal')}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-300">
                            {fmtKm(vehicleTotal)} km
                          </td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && currentRows.length === 0 && rangeRows.length === 0 && !error && (
        <Card>
          <div className="p-8 text-center text-muted text-sm">
            {t('odoNoData')}
          </div>
        </Card>
      )}
    </div>
  );
}

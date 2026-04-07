import { useState, useMemo, useCallback, useEffect, Fragment } from 'react';
import {
  Calendar, Truck, AlertCircle, Search, X,
  ChevronDown, ChevronRight, MapPin, Download,
  CheckSquare, Square, Plus, Loader2, RefreshCw, Clock,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchSamsaraVehicles, fetchVehicleActivity } from '../lib/api';
import type { SamsaraVehicle, VehicleActivity, VehicleDayActivity } from '../lib/api';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { exportVehicleActivityToXlsx, type VehicleActivityGroup } from '../lib/xlsx-export';

interface LoadedMonth {
  period: string;
  vehicles: VehicleActivity[];
  loading?: boolean;
}

export function VehiclesPage() {
  const { t, locale } = useI18n();
  const { dateFrom } = useDateFilter();

  // Vehicle list from Samsara (for names)
  const [vehicleList, setVehicleList] = useState<SamsaraVehicle[]>([]);
  const [vehicleListLoading, setVehicleListLoading] = useState(true);
  const [vehicleListError, setVehicleListError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setVehicleListLoading(true);
    fetchSamsaraVehicles()
      .then((res) => { if (!cancelled) setVehicleList(res.vehicles); })
      .catch((e) => { if (!cancelled) setVehicleListError(e.message); })
      .finally(() => { if (!cancelled) setVehicleListLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Multi-month state
  const [months, setMonths] = useState<LoadedMonth[]>([]);
  const [error, setError] = useState('');

  const defaultPeriod = useMemo(() => {
    if (dateFrom) return dateFrom.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [dateFrom]);

  const [addPeriod, setAddPeriod] = useState(defaultPeriod);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [dateFilterFrom, setDateFilterFrom] = useState('');
  const [dateFilterTo, setDateFilterTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');

  // Expanded / selected vehicles
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());

  // Per-vehicle date ranges for export
  const [vehicleDateRanges, setVehicleDateRanges] = useState<Record<string, { from: string; to: string }>>({});

  const anyLoading = months.some(m => m.loading);

  // All vehicle IDs for API calls
  const allVehicleIds = useMemo(() => vehicleList.map(v => v.id), [vehicleList]);

  // Add a month by fetching from Samsara
  const handleAddMonth = useCallback(async () => {
    if (!addPeriod) return;
    if (months.some(m => m.period === addPeriod)) return; // already loaded
    if (allVehicleIds.length === 0) {
      setError(locale === 'de' ? 'Keine Fahrzeuge geladen' : 'Brak pojazdów — poczekaj na załadowanie listy');
      return;
    }

    const placeholder: LoadedMonth = { period: addPeriod, vehicles: [], loading: true };
    setMonths(prev => [...prev, placeholder].sort((a, b) => a.period.localeCompare(b.period)));
    setError('');

    try {
      const result = await fetchVehicleActivity(addPeriod, allVehicleIds);
      setMonths(prev =>
        prev.map(m => m.period === addPeriod ? { period: addPeriod, vehicles: result.vehicles } : m),
      );
    } catch (e: any) {
      setError(e.message);
      setMonths(prev => prev.filter(m => m.period !== addPeriod));
    }
  }, [addPeriod, months, allVehicleIds, locale]);

  // Reload a single month
  const handleReloadMonth = useCallback(async (period: string) => {
    if (allVehicleIds.length === 0) return;
    setMonths(prev => prev.map(m => m.period === period ? { ...m, loading: true } : m));
    setError('');
    try {
      const result = await fetchVehicleActivity(period, allVehicleIds);
      setMonths(prev =>
        prev.map(m => m.period === period ? { period, vehicles: result.vehicles } : m),
      );
    } catch (e: any) {
      setError(e.message);
      setMonths(prev => prev.map(m => m.period === period ? { ...m, loading: false } : m));
    }
  }, [allVehicleIds]);

  // Merge all vehicles from all months into a flat list of day activities per vehicle
  const allDays = useMemo(() => {
    const map = new Map<string, { name: string; days: VehicleDayActivity[] }>();
    for (const m of months) {
      if (m.loading) continue;
      for (const v of m.vehicles) {
        const key = v.vehicle_name;
        if (!map.has(key)) map.set(key, { name: v.vehicle_name, days: [] });
        map.get(key)!.days.push(...v.days);
      }
    }
    // Sort days within each vehicle
    for (const entry of map.values()) {
      entry.days.sort((a, b) => a.date.localeCompare(b.date));
    }
    return map;
  }, [months]);

  // Apply filters
  const filteredByVehicle = useMemo(() => {
    const q = searchText.toLowerCase().trim();
    const result: { name: string; days: VehicleDayActivity[]; totalKm: number; totalMinutes: number }[] = [];

    for (const [, entry] of allDays) {
      if (q && !entry.name.toLowerCase().includes(q)) continue;

      const filteredDays = entry.days.filter(d => {
        if (dateFilterFrom && d.date < dateFilterFrom) return false;
        if (dateFilterTo && d.date > dateFilterTo) return false;
        if (timeFrom || timeTo) {
          const beginTime = d.begin_driving?.split(' ')[1] || '';
          const endTime = d.last_driving?.split(' ')[1] || '';
          if (timeFrom && endTime && endTime < timeFrom) return false;
          if (timeTo && beginTime && beginTime > timeTo) return false;
        }
        return true;
      });

      if (filteredDays.length === 0) continue;

      result.push({
        name: entry.name,
        days: filteredDays,
        totalKm: filteredDays.reduce((s, d) => s + d.distance_km, 0),
        totalMinutes: filteredDays.reduce((s, d) => s + d.duration_minutes, 0),
      });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [allDays, searchText, dateFilterFrom, dateFilterTo, timeFrom, timeTo]);

  const grandTotalKm = useMemo(() => filteredByVehicle.reduce((s, v) => s + v.totalKm, 0), [filteredByVehicle]);
  const grandTotalDays = useMemo(() => filteredByVehicle.reduce((s, v) => s + v.days.length, 0), [filteredByVehicle]);
  const grandTotalMinutes = useMemo(() => filteredByVehicle.reduce((s, v) => s + v.totalMinutes, 0), [filteredByVehicle]);

  const hasFilters = searchText || dateFilterFrom || dateFilterTo || timeFrom || timeTo;

  const toggleExpand = (name: string) => {
    setExpandedVehicles(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const toggleSelect = (name: string) => {
    setSelectedVehicles(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const allSelected = filteredByVehicle.length > 0 && filteredByVehicle.every(v => selectedVehicles.has(v.name));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedVehicles(new Set());
    } else {
      setSelectedVehicles(new Set(filteredByVehicle.map(v => v.name)));
    }
  };

  // Find license plate for vehicle name
  const getPlate = (name: string) => vehicleList.find(v => v.name === name)?.license_plate || '';

  const fmtKm = (km: number) => km.toFixed(1).replace('.', ',') + ' km';
  const fmtDuration = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

  const weekday = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      const days_de = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
      const days_pl = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
      return (locale === 'de' ? days_de : days_pl)[d.getDay()];
    } catch { return ''; }
  };

  const isWeekend = (dateStr: string) => {
    try { const d = new Date(dateStr + 'T00:00:00').getDay(); return d === 0 || d === 6; } catch { return false; }
  };

  // Excel export
  const handleExportExcel = () => {
    const selected = filteredByVehicle
      .filter(v => selectedVehicles.has(v.name))
      .map((v): VehicleActivityGroup => {
        const range = vehicleDateRanges[v.name];
        // Get ALL days for this vehicle from allDays (bypass global date filter)
        const allVehicleDays = allDays.get(v.name)?.days || [];
        const exportDays = range?.from || range?.to
          ? allVehicleDays.filter(d => {
              if (range.from && d.date < range.from) return false;
              if (range.to && d.date > range.to) return false;
              return true;
            })
          : v.days;
        return {
          name: v.name,
          plate: getPlate(v.name),
          days: exportDays,
          totalKm: exportDays.reduce((s, d) => s + d.distance_km, 0),
          totalMinutes: exportDays.reduce((s, d) => s + d.duration_minutes, 0),
        };
      });

    if (selected.length === 0) return;

    const periods = months.map(m => m.period).sort();
    const periodStr = periods.length > 0
      ? (periods.length === 1 ? periods[0] : `${periods[0]}_${periods[periods.length - 1]}`)
      : new Date().toISOString().slice(0, 7);

    exportVehicleActivityToXlsx(selected, periodStr, 'LTS Logistik GmbH');
  };

  const hasData = months.length > 0 && months.some(m => !m.loading && m.vehicles.length > 0);

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink">{t('vehiclesTitle')}</h1>
        <p className="text-sm text-muted mt-1">{t('vehiclesSubtitle')}</p>
      </div>

      {/* Add month */}
      <Card>
        <div className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-muted mb-1">{t('vehiclesPeriod')}</label>
              <input
                type="month"
                value={addPeriod}
                onChange={e => setAddPeriod(e.target.value)}
                className="input rounded-lg px-3 py-2 text-sm min-h-[40px]"
              />
            </div>
            <div className="self-end">
              <button
                onClick={handleAddMonth}
                disabled={anyLoading || vehicleListLoading || vehicleList.length === 0 || months.some(m => m.period === addPeriod)}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 min-h-[40px] text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
              >
                {(anyLoading || vehicleListLoading) ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {vehicleListLoading ? t('loading') : t('tollAddMonth')}
              </button>
            </div>
            {!vehicleListLoading && vehicleList.length > 0 && (
              <span className="self-end text-xs text-muted">
                {vehicleList.length} {t('vehiclesCount')}
              </span>
            )}
          </div>

          {/* Loaded months badges */}
          {months.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted flex items-center gap-1.5">
                  <Calendar size={14} />
                  {t('tollLoadedMonths')} ({months.length} {t('tollMonths')})
                </span>
                <button
                  onClick={() => { setMonths([]); setError(''); setSelectedVehicles(new Set()); setExpandedVehicles(new Set()); }}
                  className="text-xs text-muted hover:text-red-500"
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
                    <Calendar size={14} className="text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-mono font-medium text-blue-700 dark:text-blue-300">{m.period}</span>
                    {m.loading ? (
                      <Loader2 size={14} className="animate-spin text-blue-500" />
                    ) : (
                      <span className="text-xs text-muted">
                        ({m.vehicles.length} {t('vehiclesCount')})
                      </span>
                    )}
                    <button
                      onClick={() => handleReloadMonth(m.period)}
                      disabled={m.loading}
                      className="text-muted hover:text-blue-600 disabled:opacity-50"
                      title={t('refresh')}
                    >
                      <RefreshCw size={12} />
                    </button>
                    <button
                      onClick={() => setMonths(prev => prev.filter(pm => pm.period !== m.period))}
                      className="text-muted hover:text-red-500"
                      title={t('tollRemoveMonth')}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Vehicle list error */}
      {vehicleListError && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle size={16} /> Samsara: {vehicleListError}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Empty state */}
      {months.length === 0 && (
        <p className="py-20 text-center text-sm text-muted">{t('vehiclesNoData')}</p>
      )}

      {/* Results */}
      {hasData && (
        <>
          {/* Filters */}
          <Card>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-ink">
                <Search size={16} />
                {t('tollFilters')}
                {hasFilters && (
                  <button
                    onClick={() => { setSearchText(''); setDateFilterFrom(''); setDateFilterTo(''); setTimeFrom(''); setTimeTo(''); }}
                    className="ml-2 text-xs text-blue-500 hover:text-blue-700"
                  >
                    {t('tollClearFilters')}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs text-muted mb-1">{t('tollSearch')}</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
                    <input
                      type="text"
                      value={searchText}
                      onChange={e => setSearchText(e.target.value)}
                      placeholder={locale === 'de' ? 'Fahrzeug suchen...' : 'Szukaj pojazdu...'}
                      className="w-full input rounded-lg pl-8 pr-2 py-1.5 text-sm"
                    />
                    {searchText && (
                      <button onClick={() => setSearchText('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">{t('tollDateFrom')}</label>
                  <input type="date" value={dateFilterFrom} onChange={e => setDateFilterFrom(e.target.value)}
                    className="w-full input rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">{t('tollDateTo')}</label>
                  <input type="date" value={dateFilterTo} onChange={e => setDateFilterTo(e.target.value)}
                    className="w-full input rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">{t('vehiclesTimeFrom')}</label>
                  <input type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)}
                    className="w-full input rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">{t('vehiclesTimeTo')}</label>
                  <input type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)}
                    className="w-full input rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
            </div>
          </Card>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted">{t('vehiclesName')}</div>
                <div className="text-xl font-bold mt-1">{filteredByVehicle.length}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted">{t('vehiclesActiveDays')}</div>
                <div className="text-xl font-bold mt-1">{grandTotalDays}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted">{t('vehiclesTotalKm')}</div>
                <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{fmtKm(grandTotalKm)}</div>
              </div>
            </Card>
            <Card>
              <div className="p-3 text-center">
                <div className="text-xs text-muted">{t('vehiclesDuration')}</div>
                <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">{fmtDuration(grandTotalMinutes)}</div>
              </div>
            </Card>
          </div>

          {/* Excel export bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={toggleSelectAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              {t('tollSelectAll')}
            </button>
            {selectedVehicles.size > 0 && (
              <span className="text-xs text-muted">
                {selectedVehicles.size} / {filteredByVehicle.length} {t('tollSelected')}
              </span>
            )}
            <button
              onClick={handleExportExcel}
              disabled={selectedVehicles.size === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={14} />
              {t('analysisExportXlsx')}
            </button>
          </div>

          {/* Vehicle table */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className="w-8 px-3 py-3" />
                    <th className="w-8 px-1 py-3">
                      <button onClick={toggleSelectAll} className="text-muted hover:text-ink">
                        {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-muted">{t('vehiclesName')}</th>
                    <th className="text-left px-3 py-3 font-semibold text-muted hidden sm:table-cell">
                      {locale === 'de' ? 'Kennzeichen' : 'Rejestracja'}
                    </th>
                    <th className="text-right px-3 py-3 font-semibold text-muted">{t('vehiclesActiveDays')}</th>
                    <th className="text-right px-3 py-3 font-semibold text-muted">km</th>
                    <th className="text-right px-3 py-3 font-semibold text-muted">{t('vehiclesDuration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredByVehicle.map(v => {
                    const isExpanded = expandedVehicles.has(v.name);
                    const isSelected = selectedVehicles.has(v.name);
                    const plate = getPlate(v.name);
                    return (
                      <Fragment key={v.name}>
                        {/* Vehicle summary row */}
                        <tr
                          className={`border-b border-border cursor-pointer hover:bg-surface font-medium ${isSelected ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''}`}
                          onClick={() => toggleExpand(v.name)}
                        >
                          <td className="px-3 py-3 text-muted">
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </td>
                          <td className="px-1 py-3">
                            <button
                              onClick={e => { e.stopPropagation(); toggleSelect(v.name); }}
                              className="text-muted hover:text-emerald-600"
                            >
                              {isSelected
                                ? <CheckSquare size={16} className="text-emerald-600 dark:text-emerald-400" />
                                : <Square size={16} />}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <Truck size={16} className="text-muted" />
                              <span>{v.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-muted hidden sm:table-cell font-mono text-xs">
                            {plate || '-'}
                          </td>
                          <td className="px-3 py-3 text-right text-muted">{v.days.length}</td>
                          <td className="px-3 py-3 text-right font-bold text-blue-600 dark:text-blue-400 font-mono">
                            {fmtKm(v.totalKm)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <Badge variant="gray">{fmtDuration(v.totalMinutes)}</Badge>
                          </td>
                        </tr>

                        {/* Per-vehicle date range row (shown when selected) */}
                        {isSelected && (
                          <tr className="border-b border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-900/10">
                            <td className="px-3 py-2" />
                            <td className="px-1 py-2" />
                            <td colSpan={5} className="px-3 py-2">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                                  <Calendar size={12} />
                                  {t('tollExportRange')}:
                                </span>
                                <input
                                  type="date"
                                  value={vehicleDateRanges[v.name]?.from || ''}
                                  onChange={e => setVehicleDateRanges(prev => ({
                                    ...prev,
                                    [v.name]: { ...prev[v.name], from: e.target.value, to: prev[v.name]?.to || '' },
                                  }))}
                                  onClick={e => e.stopPropagation()}
                                  className="rounded border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs"
                                />
                                <span className="text-xs text-muted">–</span>
                                <input
                                  type="date"
                                  value={vehicleDateRanges[v.name]?.to || ''}
                                  onChange={e => setVehicleDateRanges(prev => ({
                                    ...prev,
                                    [v.name]: { from: prev[v.name]?.from || '', to: e.target.value },
                                  }))}
                                  onClick={e => e.stopPropagation()}
                                  className="rounded border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-700 px-2 py-1 text-xs"
                                />
                                {(vehicleDateRanges[v.name]?.from || vehicleDateRanges[v.name]?.to) && (
                                  <button
                                    onClick={() => setVehicleDateRanges(prev => { const next = { ...prev }; delete next[v.name]; return next; })}
                                    className="text-xs text-muted hover:text-red-500"
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                                {!vehicleDateRanges[v.name]?.from && !vehicleDateRanges[v.name]?.to && (
                                  <span className="text-xs text-muted italic">{t('tollExportRangeHint')}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Expanded day rows */}
                        {isExpanded && v.days.map(day => {
                          const wd = weekday(day.date);
                          const we = isWeekend(day.date);
                          const isShort = day.duration_minutes > 0 && day.duration_minutes < 60;
                          return (
                            <tr
                              key={`${v.name}-${day.date}`}
                              className={`border-b border-gray-100 dark:border-gray-800 text-xs ${
                                isShort ? 'bg-orange-50/50 dark:bg-orange-900/10'
                                : we ? 'bg-rose-50/30 dark:bg-rose-900/10'
                                : 'bg-gray-50/50 dark:bg-gray-800/20'
                              }`}
                            >
                              <td className="px-3 py-2" />
                              <td className="px-1 py-2" />
                              <td className="px-3 py-2">
                                <span className="font-medium">{day.date}</span>
                                <span className={`ml-2 ${we ? 'font-bold text-danger' : 'text-muted'}`}>{wd}</span>
                              </td>
                              <td className="px-3 py-2 text-muted hidden sm:table-cell max-w-[200px] truncate" title={day.last_location || ''}>
                                {day.last_location ? (
                                  <span className="flex items-center gap-1">
                                    <MapPin size={10} className="shrink-0" />
                                    {day.last_location}
                                  </span>
                                ) : '-'}
                              </td>
                              <td className="px-3 py-2 text-right text-muted">
                                {day.begin_driving?.split(' ')[1] || ''} – {day.last_driving?.split(' ')[1] || ''}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-muted">
                                {day.distance_km > 0 ? fmtKm(day.distance_km) : '-'}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Badge variant={isShort ? 'orange' : day.duration_h >= 10 ? 'blue' : 'gray'}>
                                  {day.duration_hm}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}

                  {/* Grand total */}
                  <tr className="border-t-2 border-border bg-surface font-bold">
                    <td className="px-3 py-3" />
                    <td className="px-1 py-3" />
                    <td className="px-3 py-3">{t('vehiclesTotal')}</td>
                    <td className="px-3 py-3 text-muted text-xs hidden sm:table-cell">
                      {filteredByVehicle.length} {t('vehiclesCount')}
                    </td>
                    <td className="px-3 py-3 text-right">{grandTotalDays}</td>
                    <td className="px-3 py-3 text-right text-blue-700 dark:text-blue-300 font-mono">
                      {fmtKm(grandTotalKm)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Badge variant="blue">{fmtDuration(grandTotalMinutes)}</Badge>
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

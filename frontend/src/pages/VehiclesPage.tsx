import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Calendar, Truck, RefreshCw, AlertCircle, Printer, MapPin, Search,
  Save, Download, Trash2, ChevronDown, ChevronRight, CheckSquare, Square,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchSamsaraVehicles, fetchVehicleActivity } from '../lib/api';
import type { SamsaraVehicle, VehicleActivity, VehicleDebugInfo, VehicleDayActivity } from '../lib/api';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';
import { CardField } from '../components/MobileCards';
import { monthLabel } from '../lib/utils';
import { exportVehicleActivityToXlsx, type VehicleActivityGroup } from '../lib/xlsx-export';

// ─── localStorage saved reports ───

const LS_KEY = 'vehicles_saved_reports';

interface SavedReport {
  id: string; // vehicleName__period
  vehicleName: string;
  vehicleId: string;
  plate: string;
  period: string;
  totalKm: number;
  activeDays: number;
  totalMinutes: number;
  days: VehicleDayActivity[];
  savedAt: string;
}

function loadSavedReports(): SavedReport[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistReports(reports: SavedReport[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(reports));
}

export function VehiclesPage() {
  const { t, locale } = useI18n();
  const { dateFrom } = useDateFilter();

  // Vehicle list
  const [vehicleList, setVehicleList] = useState<SamsaraVehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<string>>(new Set());

  // Report
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState<VehicleActivity | null>(null);
  const [period, setPeriod] = useState('');
  const [debugInfo, setDebugInfo] = useState<VehicleDebugInfo | null>(null);
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');

  // Saved reports
  const [savedReports, setSavedReports] = useState<SavedReport[]>(loadSavedReports);
  const [tours, setTours] = useState<Record<string, string>>({});
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [expandedReports, setExpandedReports] = useState<Set<string>>(new Set());

  const defaultPeriod = useMemo(() => {
    if (dateFrom) return dateFrom.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [dateFrom]);

  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod);

  // Date range (overrides period when both set)
  const defaultDateFrom = useMemo(() => {
    const p = selectedPeriod || defaultPeriod;
    return `${p}-01`;
  }, [selectedPeriod, defaultPeriod]);

  const defaultDateTo = useMemo(() => {
    const p = selectedPeriod || defaultPeriod;
    const [y, m] = p.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${p}-${String(last).padStart(2, '0')}`;
  }, [selectedPeriod, defaultPeriod]);

  const [dateRangeFrom, setDateRangeFrom] = useState(defaultDateFrom);
  const [dateRangeTo, setDateRangeTo] = useState(defaultDateTo);

  // Load vehicle list on mount + refresh function
  const loadVehicleList = useCallback(() => {
    setVehiclesLoading(true);
    setVehiclesError('');
    fetchSamsaraVehicles()
      .then((res) => { setVehicleList(res.vehicles); })
      .catch((e) => { setVehiclesError(e.message); })
      .finally(() => { setVehiclesLoading(false); });
  }, []);

  useEffect(() => { loadVehicleList(); }, [loadVehicleList]);

  const [showDeactivated, setShowDeactivated] = useState(false);

  const filteredVehicles = useMemo(() => {
    let list = vehicleList;
    if (!showDeactivated) {
      list = list.filter(v => !v.name.toLowerCase().startsWith('deactivated'));
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.vin?.toLowerCase().includes(q) ||
        v.license_plate?.toLowerCase().includes(q),
    );
  }, [vehicleList, searchQuery, showDeactivated]);

  const selectedVehicle = useMemo(
    () => vehicleList.find((v) => v.id === selectedVehicleId),
    [vehicleList, selectedVehicleId],
  );

  const toggleVehicleId = (id: string) => {
    setSelectedVehicleIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleAllVehicles = () => {
    if (selectedVehicleIds.size === filteredVehicles.length) {
      setSelectedVehicleIds(new Set());
    } else {
      setSelectedVehicleIds(new Set(filteredVehicles.map(v => v.id)));
    }
  };

  // Generate for single vehicle (click row → shows detail below)
  const handleGenerate = useCallback(async () => {
    if (!selectedVehicleId) return;
    const p = selectedPeriod || defaultPeriod;
    setLoading(true);
    setError('');
    setActivity(null);
    setPeriod('');
    setDebugInfo(null);

    try {
      const result = await fetchVehicleActivity(p, [selectedVehicleId], dateRangeFrom, dateRangeTo);
      if (result.vehicles.length > 0) {
        setActivity(result.vehicles[0]);
      } else {
        setActivity(null);
      }
      setPeriod(result.period);
      setDebugInfo(result.debug || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicleId, selectedPeriod, defaultPeriod, dateRangeFrom, dateRangeTo]);

  // Generate + save for selected vehicles — one by one sequentially
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');

  const handleGenerateMulti = useCallback(async () => {
    const ids = Array.from(selectedVehicleIds);
    if (ids.length === 0) return;
    const p = selectedPeriod || defaultPeriod;
    setBulkLoading(true);
    setError('');

    let done = 0;
    let errors: string[] = [];

    for (const vid of ids) {
      done++;
      const vehicle = vehicleList.find(vl => vl.id === vid);
      setBulkProgress(`${done} / ${ids.length}${vehicle ? ` — ${vehicle.name}` : ''}`);

      try {
        const result = await fetchVehicleActivity(p, [vid], dateRangeFrom, dateRangeTo);
        for (const v of result.vehicles) {
          const veh = vehicleList.find(vl => vl.id === v.vehicle_id || vl.name === v.vehicle_name);
          const id = `${v.vehicle_name}__${result.period}`;
          setSavedReports(prev => {
            const next = [...prev.filter(r => r.id !== id), {
              id,
              vehicleName: v.vehicle_name,
              vehicleId: veh?.id || vid,
              plate: veh?.license_plate || '',
              period: result.period,
              totalKm: v.total_km,
              activeDays: v.active_days,
              totalMinutes: v.days.reduce((s: number, d: VehicleDayActivity) => s + d.duration_minutes, 0),
              days: v.days,
              savedAt: new Date().toISOString(),
            }].sort((a, b) => a.vehicleName.localeCompare(b.vehicleName) || a.period.localeCompare(b.period));
            persistReports(next);
            return next;
          });
        }
      } catch (e: any) {
        errors.push(`${vehicle?.name || vid}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      setError(errors.join(' | '));
    }
    setBulkLoading(false);
    setBulkProgress('');
  }, [selectedVehicleIds, selectedPeriod, defaultPeriod, vehicleList]);

  // Save current result to localStorage
  const handleSave = useCallback(() => {
    if (!activity || !period || !selectedVehicle) return;
    const id = `${activity.vehicle_name}__${period}`;
    const report: SavedReport = {
      id,
      vehicleName: activity.vehicle_name,
      vehicleId: selectedVehicleId,
      plate: selectedVehicle.license_plate || '',
      period,
      totalKm: activity.total_km,
      activeDays: activity.active_days,
      totalMinutes: activity.days.reduce((s, d) => s + d.duration_minutes, 0),
      days: activity.days,
      savedAt: new Date().toISOString(),
    };
    setSavedReports(prev => {
      const filtered = prev.filter(r => r.id !== id);
      const next = [...filtered, report].sort((a, b) =>
        a.vehicleName.localeCompare(b.vehicleName) || a.period.localeCompare(b.period),
      );
      persistReports(next);
      return next;
    });
  }, [activity, period, selectedVehicle, selectedVehicleId]);

  const handleDeleteReport = (id: string) => {
    setSavedReports(prev => {
      const next = prev.filter(r => r.id !== id);
      persistReports(next);
      return next;
    });
    setSelectedForExport(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const handleClearAll = () => {
    setSavedReports([]);
    persistReports([]);
    setSelectedForExport(new Set());
    setTours({});
  };

  const toggleExportSelect = (id: string) => {
    setSelectedForExport(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const allExportSelected = savedReports.length > 0 && savedReports.every(r => selectedForExport.has(r.id));
  const toggleSelectAll = () => {
    if (allExportSelected) setSelectedForExport(new Set());
    else setSelectedForExport(new Set(savedReports.map(r => r.id)));
  };

  const toggleExpandReport = (id: string) => {
    setExpandedReports(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Excel export
  const handleExportExcel = () => {
    const selected = savedReports.filter(r => selectedForExport.has(r.id));
    if (selected.length === 0) return;

    const groups: VehicleActivityGroup[] = selected.map(r => ({
      name: r.vehicleName,
      plate: r.plate,
      tour: tours[r.id] || '',
      period: r.period,
      days: r.days,
      totalKm: r.totalKm,
      totalMinutes: r.totalMinutes,
    }));

    const periods = [...new Set(selected.map(r => r.period))].sort();
    const periodStr = periods.length === 1 ? periods[0] : `${periods[0]}_${periods[periods.length - 1]}`;

    exportVehicleActivityToXlsx(groups, periodStr, 'LTS Logistik GmbH');
  };

  const isAlreadySaved = activity && period && selectedVehicle
    ? savedReports.some(r => r.id === `${activity.vehicle_name}__${period}`)
    : false;

  const fmtKm = (km: number) => km.toFixed(1).replace('.', ',') + ' km';

  const fmtDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      const months =
        locale === 'de'
          ? ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
          : ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
      return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
    } catch {
      return dateStr;
    }
  };

  const fmtDateTime = (dt: string) => {
    if (!dt) return '';
    try {
      const [datePart, timePart] = dt.split(' ');
      const d = new Date(datePart + 'T00:00:00');
      const months =
        locale === 'de'
          ? ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
          : ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
      return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${timePart}`;
    } catch {
      return dt;
    }
  };

  const weekday = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      const days_de = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
      const days_pl = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
      return (locale === 'de' ? days_de : days_pl)[d.getDay()];
    } catch {
      return '';
    }
  };

  const handlePrint = () => window.print();

  // Filter by time range
  const hasTimeFilter = !!(timeFrom || timeTo);

  const filteredDays = useMemo(() => {
    if (!activity) return [];
    if (!hasTimeFilter) return activity.days;

    return activity.days.map((day) => {
      const trips = day.trips || [];
      if (trips.length === 0) {
        const beginTime = day.begin_driving?.split(' ')[1] || '';
        const endTime = day.last_driving?.split(' ')[1] || '';
        if (timeFrom && endTime && endTime < timeFrom) return null;
        if (timeTo && beginTime > timeTo) return null;
        return day;
      }
      const matchingTrips = trips.filter((trip) => {
        if (timeFrom && trip.end < timeFrom) return false;
        if (timeTo && trip.start > timeTo) return false;
        return true;
      });
      if (matchingTrips.length === 0) return null;
      const totalTripKm = trips.reduce((s, t) => s + t.km, 0);
      let filteredKm: number;
      if (totalTripKm > 0) {
        const matchingTripKm = matchingTrips.reduce((s, t) => s + t.km, 0);
        filteredKm = day.distance_km * (matchingTripKm / totalTripKm);
      } else {
        filteredKm = day.distance_km * (matchingTrips.length / trips.length);
      }
      return { ...day, distance_km: Math.round(filteredKm * 10) / 10, trips_count: matchingTrips.length, trips: matchingTrips };
    }).filter((d): d is NonNullable<typeof d> => d !== null);
  }, [activity, hasTimeFilter, timeFrom, timeTo]);

  const filteredTotalKm = useMemo(() => filteredDays.reduce((s, d) => s + d.distance_km, 0), [filteredDays]);
  const totalMinutes = useMemo(() => filteredDays.reduce((s, d) => s + d.duration_minutes, 0), [filteredDays]);
  const fmtDuration = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

  // Group saved reports by vehicle for display
  const savedByVehicle = useMemo(() => {
    const map = new Map<string, SavedReport[]>();
    for (const r of savedReports) {
      if (!map.has(r.vehicleName)) map.set(r.vehicleName, []);
      map.get(r.vehicleName)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [savedReports]);

  return (
    <div className="animate-slide-up space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('vehiclesTitle')}</h1>
      <p className="text-sm text-muted">{t('vehiclesSubtitle')}</p>

      {/* Step 1: Vehicle selector + period + generate */}
      <Card className="p-3 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-4">
          {/* Vehicle selector */}
          <div className="w-full sm:min-w-[250px] flex-1">
            <label className="mb-1 block text-sm font-medium text-muted">{t('vehiclesName')}</label>
            {vehiclesLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted dark:bg-white/5">
                <Spinner size="sm" /> {t('loading')}
              </div>
            ) : vehiclesError ? (
              <div className="flex items-center gap-2 rounded-lg border border-rose-200/50 px-3 py-2 text-sm text-danger">
                <AlertCircle size={14} /> {vehiclesError}
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={locale === 'de' ? 'Fahrzeug suchen...' : 'Szukaj pojazdu...'}
                  className="w-full input rounded-xl py-2 pl-9 pr-3 text-sm outline-none min-h-[44px]" />
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-muted">{locale === 'de' ? 'Datum von' : 'Data od'}</label>
            <input type="date" value={dateRangeFrom} onChange={(e) => setDateRangeFrom(e.target.value)}
              className="input rounded-xl px-3 py-2 text-sm outline-none min-h-[44px] dark:[color-scheme:dark]" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-muted">{locale === 'de' ? 'Datum bis' : 'Data do'}</label>
            <input type="date" value={dateRangeTo} onChange={(e) => setDateRangeTo(e.target.value)}
              className="input rounded-xl px-3 py-2 text-sm outline-none min-h-[44px] dark:[color-scheme:dark]" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-muted">{t('vehiclesTimeFrom')}</label>
            <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)}
              className="input rounded-xl px-3 py-2 text-sm outline-none min-h-[44px]" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-muted">{t('vehiclesTimeTo')}</label>
            <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)}
              className="input rounded-xl px-3 py-2 text-sm outline-none min-h-[44px]" />
          </div>

          <button onClick={handleGenerate} disabled={loading || bulkLoading || !selectedVehicleId}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-2 min-h-[44px] text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Calendar size={14} />}
            {loading ? t('vehiclesLoading') : t('vehiclesGenerate')}
          </button>

          {/* Generate + save multiple at once */}
          <button onClick={handleGenerateMulti} disabled={loading || bulkLoading || selectedVehicleIds.size === 0}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 min-h-[44px] text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
            {bulkLoading ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {bulkLoading
              ? `${bulkProgress}...`
              : `${locale === 'de' ? 'Generieren & Speichern' : 'Generuj i zapisz'} (${selectedVehicleIds.size})`}
          </button>

          {activity && (
            <>
              <button onClick={handlePrint}
                className="flex items-center justify-center gap-2 rounded-xl bg-gray-600 px-5 py-2 min-h-[44px] text-sm font-semibold text-white transition hover:bg-gray-700">
                <Printer size={14} /> {t('vehiclesPrint')}
              </button>
              <button onClick={handleSave} disabled={isAlreadySaved as boolean}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 min-h-[44px] text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                <Save size={14} /> {isAlreadySaved ? (locale === 'de' ? 'Gespeichert' : 'Zapisano') : (locale === 'de' ? 'Speichern' : 'Zapisz')}
              </button>
            </>
          )}
        </div>

        {/* Vehicle list / selection */}
        {!vehiclesLoading && !vehiclesError && vehicleList.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-3 mb-2">
              <button onClick={loadVehicleList} className="text-xs text-primary-600 hover:text-primary-800 flex items-center gap-1">
                <RefreshCw size={11} /> {locale === 'de' ? 'Liste aktualisieren' : 'Odśwież listę'}
              </button>
              <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
                <input type="checkbox" checked={showDeactivated} onChange={e => setShowDeactivated(e.target.checked)} className="rounded" />
                {locale === 'de' ? 'Deaktivierte anzeigen' : 'Pokaż deaktywowane'}
              </label>
              <span className="text-xs text-muted">{filteredVehicles.length} / {vehicleList.length}</span>
            </div>
          <div className="max-h-[240px] overflow-y-auto overflow-x-hidden sm:overflow-x-auto rounded-lg border border-border">
            <table className="w-full sm:min-w-[600px] text-sm">
              <thead className="sticky top-0 bg-black/[0.02] dark:bg-white/5">
                <tr className="border-b border-border">
                  <th className="w-8 px-2 py-2">
                    <button onClick={toggleAllVehicles} className="text-muted hover:text-ink">
                      {selectedVehicleIds.size === filteredVehicles.length && filteredVehicles.length > 0
                        ? <CheckSquare size={14} className="text-emerald-600" />
                        : <Square size={14} />}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('vehiclesName')}</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">VIN</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                    {locale === 'de' ? 'Kennzeichen' : 'Rejestracja'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredVehicles.map((v) => (
                  <tr key={v.id} onClick={() => setSelectedVehicleId(v.id)}
                    className={`cursor-pointer transition ${v.id === selectedVehicleId ? 'bg-primary-50' : selectedVehicleIds.has(v.id) ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : 'hover:bg-surface'}`}>
                    <td className="px-2 py-2" onClick={e => { e.stopPropagation(); toggleVehicleId(v.id); }}>
                      {selectedVehicleIds.has(v.id)
                        ? <CheckSquare size={14} className="text-emerald-600" />
                        : <Square size={14} className="text-muted" />}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Truck size={14} className={v.id === selectedVehicleId ? 'text-primary-500' : 'text-muted'} />
                        <span className={v.id === selectedVehicleId ? 'font-semibold text-primary-700' : ''}>{v.name}</span>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2 font-mono text-xs text-muted">{v.vin || '-'}</td>
                    <td className="px-3 py-2 text-muted">{v.license_plate || '-'}</td>
                  </tr>
                ))}
                {filteredVehicles.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">{t('noData')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          </div>
        )}

        {selectedVehicle && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Truck size={14} className="text-primary-500" />
            <span className="font-medium">{selectedVehicle.name}</span>
            {selectedVehicle.license_plate && <Badge variant="gray">{selectedVehicle.license_plate}</Badge>}
          </div>
        )}
      </Card>

      {/* Loading */}
      {loading && (
        <Card className="p-6">
          <div className="flex flex-col items-center gap-4">
            <Spinner size="lg" />
            <p className="text-sm font-medium text-muted">{t('vehiclesLoading')}</p>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center gap-3 py-12 text-danger">
          <AlertCircle size={32} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !activity && !period && savedReports.length === 0 && (
        <p className="py-20 text-center text-sm text-muted">{t('vehiclesNoData')}</p>
      )}

      {/* No activity for selected vehicle/period */}
      {!loading && !error && !activity && period && (
        <Card className="p-6">
          <p className="text-center text-sm text-muted">{t('vehiclesNoActivity')}</p>
        </Card>
      )}

      {/* Results for selected vehicle */}
      {activity && period && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4 text-center">
              <Truck size={20} className="mx-auto mb-1 text-primary-500" />
              <p className="text-lg font-bold">{activity.vehicle_name}</p>
              <p className="text-xs text-muted">{monthLabel(period, locale)}</p>
            </Card>
            <Card className="p-4 text-center">
              <Calendar size={20} className="mx-auto mb-1 text-blue-500" />
              <p className="text-2xl font-bold">{hasTimeFilter ? filteredDays.length : activity.active_days}</p>
              <p className="text-xs text-muted">{t('vehiclesActiveDays')}</p>
            </Card>
            <Card className="p-4 text-center">
              <MapPin size={20} className="mx-auto mb-1 text-success" />
              <p className="text-2xl font-bold">{fmtKm(hasTimeFilter ? filteredTotalKm : activity.total_km)}</p>
              <p className="text-xs text-muted">{t('vehiclesTotalKm')}</p>
            </Card>
            <Card className="p-4 text-center">
              <RefreshCw size={20} className="mx-auto mb-1 text-amber-500" />
              <p className="text-2xl font-bold">{fmtDuration(totalMinutes)}</p>
              <p className="text-xs text-muted">{t('vehiclesDuration')}</p>
            </Card>
          </div>

          {/* Day-by-day table */}
          <Card className="overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{activity.vehicle_name} — {monthLabel(period, locale)}</h2>
            </div>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('vehiclesDate')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{locale === 'de' ? 'Letzte Position' : 'Ostatnia pozycja'}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('vehiclesDistance')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('vehiclesBeginDriving')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('vehiclesLastDriving')}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('vehiclesDuration')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredDays.map((day) => {
                    const wd = weekday(day.date);
                    const isSunday = new Date(day.date + 'T00:00:00').getDay() === 0;
                    const isSaturday = new Date(day.date + 'T00:00:00').getDay() === 6;
                    const isShortDay = day.duration_minutes > 0 && day.duration_minutes < 60;
                    return (
                      <tr key={day.date} className={`transition ${isShortDay ? 'bg-orange-50/60 dark:bg-orange-900/15' : isSunday ? 'bg-rose-50/50 dark:bg-rose-900/10' : isSaturday ? 'bg-amber-50/30 dark:bg-amber-900/10' : 'hover:bg-primary-50/30'}`}>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <span className="font-medium">{fmtDate(day.date)}</span>
                          <span className={`ml-2 text-xs ${isSunday ? 'font-bold text-danger' : 'text-muted'}`}>{wd}</span>
                        </td>
                        <td className="max-w-[280px] truncate px-4 py-2.5 text-xs text-muted" title={day.last_location || ''}>{day.last_location || '-'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm">{day.distance_km > 0 ? fmtKm(day.distance_km) : '-'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted">{fmtDateTime(day.begin_driving)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted">{fmtDateTime(day.last_driving)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <Badge variant={isShortDay ? 'orange' : day.duration_h >= 10 ? 'blue' : 'gray'}>{day.duration_hm}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-black/[0.02] font-semibold dark:bg-white/5">
                    <td className="px-4 py-3">{t('vehiclesTotal')}</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 font-mono">{fmtKm(hasTimeFilter ? filteredTotalKm : activity.total_km)}</td>
                    <td className="px-4 py-3" colSpan={2}></td>
                    <td className="px-4 py-3"><Badge variant="blue">{fmtDuration(totalMinutes)}</Badge></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ═══ Saved Reports section ═══ */}
      {savedReports.length > 0 && (
        <div className="space-y-4 mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{locale === 'de' ? 'Gespeicherte Berichte' : 'Zapisane raporty'}</h2>
            <button onClick={handleClearAll} className="text-xs text-muted hover:text-red-500">{t('clear')}</button>
          </div>

          {/* Export bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={toggleSelectAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors">
              {allExportSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              {t('tollSelectAll')}
            </button>
            {selectedForExport.size > 0 && (
              <span className="text-xs text-muted">{selectedForExport.size} / {savedReports.length} {t('tollSelected')}</span>
            )}
            <button onClick={handleExportExcel} disabled={selectedForExport.size === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Download size={14} /> {t('analysisExportXlsx')}
            </button>
          </div>

          {/* Saved reports table */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className="w-8 px-3 py-2.5" />
                    <th className="w-8 px-1 py-2.5">
                      <button onClick={toggleSelectAll} className="text-muted hover:text-ink">
                        {allExportSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    </th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted">{t('vehiclesName')}</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted">{t('vehiclesPeriod')}</th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted hidden sm:table-cell">Tour</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted">km</th>
                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted">{t('vehiclesActiveDays')}</th>
                    <th className="w-8 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {savedByVehicle.map(([vehicleName, reports]) =>
                    reports.map((r) => {
                      const isExpanded = expandedReports.has(r.id);
                      const isSelected = selectedForExport.has(r.id);
                      return (
                        <tr key={r.id} className="border-b border-border">
                          <td className="px-3 py-2">
                            <button onClick={() => toggleExpandReport(r.id)} className="text-muted hover:text-ink">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td className="px-1 py-2">
                            <button onClick={() => toggleExportSelect(r.id)} className="text-muted hover:text-emerald-600">
                              {isSelected ? <CheckSquare size={14} className="text-emerald-600" /> : <Square size={14} />}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <Truck size={12} className="text-muted" />
                              <span className="font-medium">{r.vehicleName}</span>
                              {r.plate && <span className="text-xs text-muted">({r.plate})</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{r.period}</td>
                          <td className="px-3 py-2 hidden sm:table-cell" onClick={e => e.stopPropagation()}>
                            <input type="text" value={tours[r.id] || ''}
                              onChange={e => setTours(prev => ({ ...prev, [r.id]: e.target.value }))}
                              placeholder="Tour..."
                              className="w-full input rounded border border-border px-2 py-1 text-xs" />
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-blue-600 dark:text-blue-400">{fmtKm(r.totalKm)}</td>
                          <td className="px-3 py-2 text-right text-muted">{r.activeDays}</td>
                          <td className="px-3 py-2">
                            <button onClick={() => handleDeleteReport(r.id)} className="text-muted hover:text-red-500">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

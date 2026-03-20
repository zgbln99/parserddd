import { useState, useCallback, useMemo, useEffect } from 'react';
import { Calendar, Truck, RefreshCw, AlertCircle, Printer, MapPin, Search } from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchSamsaraVehicles, fetchVehicleActivity } from '../lib/api';
import type { SamsaraVehicle, VehicleActivity, VehicleDebugInfo } from '../lib/api';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';
import { CardField } from '../components/MobileCards';
import { monthLabel } from '../lib/utils';

export function VehiclesPage() {
  const { t, locale } = useI18n();
  const { dateFrom } = useDateFilter();

  // Vehicle list
  const [vehicleList, setVehicleList] = useState<SamsaraVehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');

  // Report
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState<VehicleActivity | null>(null);
  const [period, setPeriod] = useState('');
  const [debugInfo, setDebugInfo] = useState<VehicleDebugInfo | null>(null);
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');


  const defaultPeriod = useMemo(() => {
    if (dateFrom) return dateFrom.slice(0, 7);
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [dateFrom]);

  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod);

  // Load vehicle list on mount
  useEffect(() => {
    let cancelled = false;
    setVehiclesLoading(true);
    setVehiclesError('');
    fetchSamsaraVehicles()
      .then((res) => {
        if (!cancelled) {
          setVehicleList(res.vehicles);
        }
      })
      .catch((e) => {
        if (!cancelled) setVehiclesError(e.message);
      })
      .finally(() => {
        if (!cancelled) setVehiclesLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filteredVehicles = useMemo(() => {
    if (!searchQuery.trim()) return vehicleList;
    const q = searchQuery.toLowerCase();
    return vehicleList.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.vin?.toLowerCase().includes(q) ||
        v.license_plate?.toLowerCase().includes(q),
    );
  }, [vehicleList, searchQuery]);

  const selectedVehicle = useMemo(
    () => vehicleList.find((v) => v.id === selectedVehicleId),
    [vehicleList, selectedVehicleId],
  );

  const handleGenerate = useCallback(async () => {
    if (!selectedVehicleId) return;
    const p = selectedPeriod || defaultPeriod;
    setLoading(true);
    setError('');
    setActivity(null);
    setPeriod('');
    setDebugInfo(null);

    try {
      const result = await fetchVehicleActivity(p, [selectedVehicleId]);
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
  }, [selectedVehicleId, selectedPeriod, defaultPeriod]);

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

  // Filter by time range at trip level - sum only km from matching trips
  const hasTimeFilter = !!(timeFrom || timeTo);

  const filteredDays = useMemo(() => {
    if (!activity) return [];
    if (!hasTimeFilter) return activity.days;

    return activity.days.map((day) => {
      const trips = day.trips || [];
      if (trips.length === 0) {
        // No trip detail - fall back to day-level time check
        const beginTime = day.begin_driving?.split(' ')[1] || '';
        const endTime = day.last_driving?.split(' ')[1] || '';
        if (timeFrom && endTime && endTime < timeFrom) return null;
        if (timeTo && beginTime > timeTo) return null;
        return day;
      }

      // Filter individual trips by time overlap
      const matchingTrips = trips.filter((trip) => {
        if (timeFrom && trip.end < timeFrom) return false;
        if (timeTo && trip.start > timeTo) return false;
        return true;
      });

      if (matchingTrips.length === 0) return null;

      // Distribute day's distance_km proportionally across trips
      // Trip km from API is often 0, so use day total and split by trip count
      const totalTripKm = trips.reduce((s, t) => s + t.km, 0);
      let filteredKm: number;
      if (totalTripKm > 0) {
        // Proportional: matching trips' share of total trip km, scaled to day distance
        const matchingTripKm = matchingTrips.reduce((s, t) => s + t.km, 0);
        filteredKm = day.distance_km * (matchingTripKm / totalTripKm);
      } else {
        // All trip km are 0 - distribute evenly by trip count
        filteredKm = day.distance_km * (matchingTrips.length / trips.length);
      }

      return {
        ...day,
        distance_km: Math.round(filteredKm * 10) / 10,
        trips_count: matchingTrips.length,
        trips: matchingTrips,
      };
    }).filter((d): d is NonNullable<typeof d> => d !== null);
  }, [activity, hasTimeFilter, timeFrom, timeTo]);

  const filteredTotalKm = useMemo(() => filteredDays.reduce((s, d) => s + d.distance_km, 0), [filteredDays]);
  const totalMinutes = useMemo(() => filteredDays.reduce((s, d) => s + d.duration_minutes, 0), [filteredDays]);

  return (
    <div className="animate-slide-up">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{t('vehiclesTitle')}</h1>
      <p className="mb-6 text-sm text-muted">{t('vehiclesSubtitle')}</p>

      {/* Step 1: Vehicle selector + period + generate */}
      <Card className="mb-6 p-3 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-4">
          {/* Vehicle selector */}
          <div className="w-full sm:min-w-[250px] flex-1">
            <label className="mb-1 block text-sm font-medium text-muted">
              {t('vehiclesName')}
            </label>
            {vehiclesLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted dark:bg-white/5">
                <Spinner size="sm" />
                {t('loading')}
              </div>
            ) : vehiclesError ? (
              <div className="flex items-center gap-2 rounded-lg border border-rose-200/50 px-3 py-2 text-sm text-danger">
                <AlertCircle size={14} />
                {vehiclesError}
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={locale === 'de' ? 'Fahrzeug suchen...' : 'Szukaj pojazdu...'}
                  className="w-full input rounded-xl py-2 pl-9 pr-3 text-sm outline-none min-h-[44px]"
                />
              </div>
            )}
          </div>

          {/* Period */}
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              {t('vehiclesPeriod')}
            </label>
            <input
              type="month"
              value={selectedPeriod || defaultPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="input rounded-xl px-3 py-2 text-sm outline-none min-h-[44px]"
            />
          </div>

          {/* Time from */}
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              {t('vehiclesTimeFrom')}
            </label>
            <input
              type="time"
              value={timeFrom}
              onChange={(e) => setTimeFrom(e.target.value)}
              className="input rounded-xl px-3 py-2 text-sm outline-none min-h-[44px]"
            />
          </div>

          {/* Time to */}
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">
              {t('vehiclesTimeTo')}
            </label>
            <input
              type="time"
              value={timeTo}
              onChange={(e) => setTimeTo(e.target.value)}
              className="input rounded-xl px-3 py-2 text-sm outline-none min-h-[44px]"
            />
          </div>

          {/* Generate */}
          <button
            onClick={handleGenerate}
            disabled={loading || !selectedVehicleId}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-2 min-h-[44px] text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Calendar size={14} />}
            {loading ? t('vehiclesLoading') : t('vehiclesGenerate')}
          </button>

          {/* Print */}
          {activity && (
            <button
              onClick={handlePrint}
              className="flex items-center justify-center gap-2 rounded-xl bg-gray-600 px-5 py-2 min-h-[44px] text-sm font-semibold text-white transition hover:bg-gray-700"
            >
              <Printer size={14} />
              {t('vehiclesPrint')}
            </button>
          )}
        </div>

        {/* Vehicle list / selection */}
        {!vehiclesLoading && !vehiclesError && vehicleList.length > 0 && (
          <div className="mt-4 max-h-[240px] overflow-y-auto overflow-x-hidden sm:overflow-x-auto rounded-lg border border-border">
            <table className="w-full sm:min-w-[600px] text-sm">
              <thead className="sticky top-0 bg-black/[0.02] dark:bg-white/5">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">{t('vehiclesName')}</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">VIN</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                    {locale === 'de' ? 'Kennzeichen' : 'Rejestracja'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredVehicles.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => setSelectedVehicleId(v.id)}
                    className={`cursor-pointer transition ${
                      v.id === selectedVehicleId
                        ? 'bg-primary-50'
                        : 'hover:bg-surface'
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Truck size={14} className={v.id === selectedVehicleId ? 'text-primary-500' : 'text-muted'} />
                        <span className={v.id === selectedVehicleId ? 'font-semibold text-primary-700' : ''}>
                          {v.name}
                        </span>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2 font-mono text-xs text-muted">{v.vin || '-'}</td>
                    <td className="px-3 py-2 text-muted">{v.license_plate || '-'}</td>
                  </tr>
                ))}
                {filteredVehicles.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted">{t('noData')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Selected vehicle indicator */}
        {selectedVehicle && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Truck size={14} className="text-primary-500" />
            <span className="font-medium">{selectedVehicle.name}</span>
            {selectedVehicle.license_plate && (
              <Badge variant="gray">{selectedVehicle.license_plate}</Badge>
            )}
          </div>
        )}
      </Card>

      {/* Loading */}
      {loading && (
        <Card className="mb-6 p-6">
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

      {/* Empty state - no vehicle selected */}
      {!loading && !error && !activity && !period && (
        <p className="py-20 text-center text-sm text-muted">{t('vehiclesNoData')}</p>
      )}

      {/* No activity for selected vehicle/period */}
      {!loading && !error && !activity && period && (
        <Card className="p-6">
          <p className="mb-4 text-center text-sm text-muted">{t('vehiclesNoActivity')}</p>
          {debugInfo && (
            <div className="mx-auto max-w-md rounded-lg bg-black/[0.02] p-4 text-xs dark:bg-white/5">
              <p className="mb-2 font-semibold text-muted">Samsara API debug:</p>
              <div className="space-y-1 text-muted">
                <p>API calls: <span className="font-mono font-bold">{debugInfo.api_calls}</span></p>
                <p>Raw trips: <span className="font-mono font-bold">{debugInfo.raw_trips}</span></p>
                <p>Vehicles with data: <span className="font-mono font-bold">{debugInfo.vehicles_with_data}</span></p>
                <p>Total days: <span className="font-mono font-bold">{debugInfo.total_days}</span></p>
                {debugInfo.stats_vehicles != null && (
                  <p>Stats vehicles: <span className="font-mono font-bold">{debugInfo.stats_vehicles}</span></p>
                )}
                {debugInfo.stats_source && (
                  <p>Stats source: <span className="font-mono font-bold">{String(debugInfo.stats_source)}</span></p>
                )}
                {debugInfo.sample_trip_keys && (
                  <p>Trip keys: <span className="font-mono font-bold text-xs break-all">{debugInfo.sample_trip_keys.join(', ')}</span></p>
                )}
                {debugInfo.errors?.length > 0 && (
                  <div className="mt-2 text-danger">
                    <p className="font-semibold">Errors:</p>
                    {debugInfo.errors.map((e, i) => (
                      <p key={i} className="break-all font-mono">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Results for selected vehicle */}
      {activity && period && (
        <>
          {/* Summary cards */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              {activity.distance_source === 'stats' && (
                <p className="mt-1 text-[10px] text-amber-500">(odometer)</p>
              )}
            </Card>
            <Card className="p-4 text-center">
              <RefreshCw size={20} className="mx-auto mb-1 text-amber-500" />
              <p className="text-2xl font-bold">{Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m</p>
              <p className="text-xs text-muted">{t('vehiclesDuration')}</p>
            </Card>
          </div>

          {/* Debug info (collapsible) */}
          {debugInfo && (
            <details className="mb-4">
              <summary className="cursor-pointer text-xs text-muted hover:text-ink">Samsara API debug</summary>
              <div className="mt-2 rounded-lg bg-black/[0.02] p-3 text-xs dark:bg-white/5">
                <div className="space-y-1 text-muted">
                  <p>API calls: <span className="font-mono font-bold">{debugInfo.api_calls}</span></p>
                  <p>Raw trips: <span className="font-mono font-bold">{debugInfo.raw_trips}</span></p>
                  {debugInfo.stats_vehicles != null && (
                    <p>Stats vehicles: <span className="font-mono font-bold">{debugInfo.stats_vehicles}</span></p>
                  )}
                  {debugInfo.stats_source && (
                    <p>Distance source: <span className="font-mono font-bold">{String(debugInfo.stats_source)}</span></p>
                  )}
                  {activity.distance_source && (
                    <p>Used source: <span className="font-mono font-bold">{activity.distance_source}</span></p>
                  )}
                  {debugInfo.sample_trip_keys && (
                    <p>Trip fields: <span className="font-mono font-bold text-xs break-all">{debugInfo.sample_trip_keys.join(', ')}</span></p>
                  )}
                  {debugInfo.errors?.length > 0 && (
                    <div className="mt-2 text-danger">
                      <p className="font-semibold">Errors:</p>
                      {debugInfo.errors.map((e, i) => (
                        <p key={i} className="break-all font-mono">{e}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </details>
          )}

          {/* Day-by-day table */}
          <Card className="overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">
                {activity.vehicle_name} — {monthLabel(period, locale)}
              </h2>
            </div>
            {/* Mobile card view */}
            <div className="block sm:hidden divide-y divide-border">
              {filteredDays.map((day) => {
                const wd = weekday(day.date);
                const isSunday = new Date(day.date + 'T00:00:00').getDay() === 0;
                const isSaturday = new Date(day.date + 'T00:00:00').getDay() === 6;
                const isShortDay = day.duration_minutes > 0 && day.duration_minutes < 60;
                return (
                  <div
                    key={day.date}
                    className={`p-4 space-y-1.5 ${
                      isShortDay ? 'bg-orange-50/50 dark:bg-orange-900/15 border-l-4 border-orange-400'
                      : isSunday ? 'bg-rose-50/30 dark:bg-rose-900/10' : isSaturday ? 'bg-amber-50/20 dark:bg-amber-900/10' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-bold">
                        {fmtDate(day.date)}
                        <span className={`ml-2 text-xs ${isSunday ? 'font-bold text-danger' : 'text-muted'}`}>{wd}</span>
                      </p>
                      <Badge variant={isShortDay ? 'orange' : day.duration_h >= 10 ? 'blue' : 'gray'}>{day.duration_hm}</Badge>
                    </div>
                    <CardField label={t('vehiclesDistance')} value={day.distance_km > 0 ? fmtKm(day.distance_km) : '-'} />
                    <CardField label={t('vehiclesBeginDriving')} value={fmtDateTime(day.begin_driving)} />
                    <CardField label={t('vehiclesLastDriving')} value={fmtDateTime(day.last_driving)} />
                    {day.last_location && (
                      <div className="mt-1 flex items-start gap-1.5 text-xs text-muted">
                        <MapPin size={12} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{day.last_location}</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Mobile totals */}
              <div className="p-4 bg-black/[0.02] dark:bg-white/5 space-y-1.5">
                <p className="text-sm font-bold mb-2">Ings.</p>
                <CardField label={t('vehiclesTotalKm')} value={<span className="font-mono font-bold">{fmtKm(hasTimeFilter ? filteredTotalKm : activity.total_km)}</span>} />
                <CardField label={t('vehiclesDuration')} value={
                  <Badge variant="blue">{totalMinutes > 0 ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m` : '-'}</Badge>
                } />
              </div>
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                      {t('vehiclesDate')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                      {locale === 'de' ? 'Letzte Position' : 'Ostatnia pozycja'}
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                      {t('vehiclesDistance')}
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                      {t('vehiclesBeginDriving')}
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                      {t('vehiclesLastDriving')}
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted">
                      {t('vehiclesDuration')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredDays.map((day) => {
                    const wd = weekday(day.date);
                    const isSunday = new Date(day.date + 'T00:00:00').getDay() === 0;
                    const isSaturday = new Date(day.date + 'T00:00:00').getDay() === 6;
                    const isShortDay = day.duration_minutes > 0 && day.duration_minutes < 60;
                    return (
                      <tr
                        key={day.date}
                        className={`transition ${
                          isShortDay
                            ? 'bg-orange-50/60 dark:bg-orange-900/15'
                            : isSunday
                              ? 'bg-rose-50/50 dark:bg-rose-900/10'
                              : isSaturday
                                ? 'bg-amber-50/30 dark:bg-amber-900/10'
                                : 'hover:bg-primary-50/30'
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <span className="font-medium">{fmtDate(day.date)}</span>
                          <span className={`ml-2 text-xs ${isSunday ? 'font-bold text-danger' : 'text-muted'}`}>
                            {wd}
                          </span>
                        </td>
                        <td className="max-w-[280px] truncate px-4 py-2.5 text-xs text-muted" title={day.last_location || ''}>
                          {day.last_location || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm">
                          {day.distance_km > 0 ? fmtKm(day.distance_km) : '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                          {fmtDateTime(day.begin_driving)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                          {fmtDateTime(day.last_driving)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <Badge variant={isShortDay ? 'orange' : day.duration_h >= 10 ? 'blue' : 'gray'}>
                            {day.duration_hm}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-black/[0.02] font-semibold dark:bg-white/5">
                    <td className="px-4 py-3">Ings.</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 font-mono">{fmtKm(hasTimeFilter ? filteredTotalKm : activity.total_km)}</td>
                    <td className="px-4 py-3" colSpan={2}></td>
                    <td className="px-4 py-3">
                      <Badge variant="blue">
                        {totalMinutes > 0
                          ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
                          : '-'}
                      </Badge>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

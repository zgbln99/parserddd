import { useState, useCallback, useMemo } from 'react';
import { Calendar, Truck, RefreshCw, AlertCircle, Printer, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import { useI18n } from '../i18n';
import { useDateFilter } from '../hooks/useDateFilter';
import { fetchVehicleActivity } from '../lib/api';
import type { VehicleActivity } from '../lib/api';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';

export function VehiclesPage() {
  const { t, locale } = useI18n();
  const { dateFrom } = useDateFilter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [vehicles, setVehicles] = useState<VehicleActivity[]>([]);
  const [period, setPeriod] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
    setVehicles([]);
    setPeriod('');
    setExpanded(new Set());

    try {
      const result = await fetchVehicleActivity(p);
      setVehicles(result.vehicles);
      setPeriod(result.period);
      // Auto-expand all vehicles
      setExpanded(new Set(result.vehicles.map(v => v.vehicle_id)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, defaultPeriod]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totals = useMemo(() => {
    let km = 0, days = 0, minutes = 0;
    for (const v of vehicles) {
      km += v.total_km;
      days += v.active_days;
      for (const d of v.days) {
        minutes += d.duration_minutes;
      }
    }
    return { km: Math.round(km * 10) / 10, days, minutes };
  }, [vehicles]);

  const fmtKm = (km: number) => km.toFixed(1).replace('.', ',') + ' km';

  const fmtDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      const months = locale === 'de'
        ? ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
        : ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
      return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
    } catch {
      return dateStr;
    }
  };

  const fmtDateTime = (dt: string) => {
    if (!dt) return '';
    // dt = "2026-03-01 04:00"
    try {
      const [datePart, timePart] = dt.split(' ');
      const d = new Date(datePart + 'T00:00:00');
      const months = locale === 'de'
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

  const monthLabel = (p: string) => {
    if (!p) return '';
    const [y, m] = p.split('-');
    const months = locale === 'de'
      ? ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
      : ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
    return `${months[parseInt(m, 10) - 1]} ${y}`;
  };

  const handlePrint = () => window.print();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{t('vehiclesTitle')}</h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">{t('vehiclesSubtitle')}</p>

      {/* Period selector */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-400">
              {t('vehiclesPeriod')}
            </label>
            <input
              type="month"
              value={selectedPeriod || defaultPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Calendar size={14} />}
            {loading ? t('vehiclesLoading') : t('vehiclesGenerate')}
          </button>
          {vehicles.length > 0 && (
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-xl bg-gray-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
            >
              <Printer size={14} />
              {t('vehiclesPrint')}
            </button>
          )}
        </div>
      </Card>

      {/* Loading */}
      {loading && (
        <Card className="mb-6 p-6">
          <div className="flex flex-col items-center gap-4">
            <Spinner size="lg" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('vehiclesLoading')}</p>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center gap-3 py-12 text-red-500">
          <AlertCircle size={32} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !vehicles.length && !period && (
        <p className="py-20 text-center text-sm text-gray-400">{t('vehiclesNoData')}</p>
      )}

      {/* Results */}
      {vehicles.length > 0 && period && (
        <>
          {/* Summary cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card className="p-4 text-center">
              <Truck size={20} className="mx-auto mb-1 text-primary-500" />
              <p className="text-2xl font-bold">{vehicles.length}</p>
              <p className="text-xs text-gray-500">{t('vehiclesCount')}</p>
            </Card>
            <Card className="p-4 text-center">
              <Calendar size={20} className="mx-auto mb-1 text-blue-500" />
              <p className="text-2xl font-bold">{totals.days}</p>
              <p className="text-xs text-gray-500">{t('vehiclesActiveDays')}</p>
            </Card>
            <Card className="p-4 text-center">
              <MapPin size={20} className="mx-auto mb-1 text-green-500" />
              <p className="text-2xl font-bold">{fmtKm(totals.km)}</p>
              <p className="text-xs text-gray-500">{t('vehiclesTotalKm')}</p>
            </Card>
            <Card className="p-4 text-center">
              <RefreshCw size={20} className="mx-auto mb-1 text-orange-500" />
              <p className="text-2xl font-bold">{Math.floor(totals.minutes / 60)}h {totals.minutes % 60}m</p>
              <p className="text-xs text-gray-500">{t('vehiclesDuration')}</p>
            </Card>
          </div>

          {/* Vehicle tables */}
          {vehicles.map((v) => (
            <Card key={v.vehicle_id} className="mb-4 overflow-hidden">
              {/* Vehicle header - clickable to expand/collapse */}
              <button
                onClick={() => toggleExpand(v.vehicle_id)}
                className="flex w-full items-center justify-between border-b border-gray-100 bg-gray-50/80 px-5 py-3 text-left transition hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900/50 dark:hover:bg-gray-800"
              >
                <div className="flex items-center gap-3">
                  {expanded.has(v.vehicle_id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Truck size={16} className="text-primary-500" />
                  <span className="font-semibold">{v.vehicle_name}</span>
                  <Badge variant="gray">{v.active_days} {t('days')}</Badge>
                  <Badge variant="blue">{fmtKm(v.total_km)}</Badge>
                </div>
                <div className="text-sm text-gray-500">
                  {monthLabel(period)}
                </div>
              </button>

              {/* Day-by-day table */}
              {expanded.has(v.vehicle_id) && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/40 dark:border-gray-800 dark:bg-gray-900/30">
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          {t('vehiclesDate')}
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          {t('vehiclesDistance')}
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          {t('vehiclesBeginDriving')}
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          {t('vehiclesLastDriving')}
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                          {t('vehiclesDuration')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                      {v.days.map((day) => {
                        const wd = weekday(day.date);
                        const isSunday = new Date(day.date + 'T00:00:00').getDay() === 0;
                        const isSaturday = new Date(day.date + 'T00:00:00').getDay() === 6;
                        return (
                          <tr
                            key={day.date}
                            className={`transition ${
                              isSunday
                                ? 'bg-red-50/50 dark:bg-red-900/10'
                                : isSaturday
                                ? 'bg-orange-50/30 dark:bg-orange-900/10'
                                : 'hover:bg-primary-50/30 dark:hover:bg-primary-900/10'
                            }`}
                          >
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <span className="font-medium">{fmtDate(day.date)}</span>
                              <span className={`ml-2 text-xs ${isSunday ? 'font-bold text-red-500' : 'text-gray-400'}`}>
                                {wd}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm">
                              {day.distance_km > 0 ? fmtKm(day.distance_km) : '-'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-gray-600 dark:text-gray-400">
                              {fmtDateTime(day.begin_driving)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-gray-600 dark:text-gray-400">
                              {fmtDateTime(day.last_driving)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <Badge variant={day.duration_h >= 10 ? 'blue' : 'gray'}>
                                {day.duration_hm}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50/80 font-semibold dark:border-gray-700 dark:bg-gray-900/50">
                        <td className="px-4 py-3">Ings.</td>
                        <td className="px-4 py-3 font-mono">{fmtKm(v.total_km)}</td>
                        <td className="px-4 py-3" colSpan={2}></td>
                        <td className="px-4 py-3">
                          <Badge variant="blue">
                            {v.days.reduce((s, d) => s + d.duration_minutes, 0) > 0
                              ? `${Math.floor(v.days.reduce((s, d) => s + d.duration_minutes, 0) / 60)}h ${v.days.reduce((s, d) => s + d.duration_minutes, 0) % 60}m`
                              : '-'}
                          </Badge>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

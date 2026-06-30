// Per-vehicle km averages (daily / weekly / monthly), shared by the Excel and
// PDF exports so both compute identically. Averages = total over the period ÷
// the count at each granularity; rest days (0 km and 0 min) are ignored.
import { isoWeek, weekKey, weekRange } from './kw';

export interface VehicleAvgInput {
  vehicle: string;
  plate?: string;
  days: { date: string; distance_km: number; duration_minutes: number }[];
}

export interface VehicleAvg {
  vehicle: string;
  plate: string;
  activeDays: number;
  weeks: number;
  months: number;
  totalKm: number;
  totalMin: number;
  avgKmDay: number;
  avgKmWeek: number;
  avgKmMonth: number;
  avgMinDay: number;
  weekRows: { key: string; label: string; range: string; days: number; km: number; avgKmDay: number }[];
  monthRows: { ym: string; label: string; days: number; km: number; avgKmDay: number }[];
}

const MONTH_ABBR_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function monthLabelDe(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m >= 1 && m <= 12 ? `${MONTH_ABBR_DE[m - 1]} ${y}` : ym;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function computeVehicleAverages(vehicles: VehicleAvgInput[]): VehicleAvg[] {
  return vehicles.map((v) => {
    const weeks = new Map<string, { km: number; days: number; sample: Date }>();
    const months = new Map<string, { km: number; days: number }>();
    let activeDays = 0;
    let totalKm = 0;
    let totalMin = 0;

    for (const d of (v.days || [])) {
      const km = d.distance_km || 0;
      const min = d.duration_minutes || 0;
      if (km <= 0 && min <= 0) continue; // active days only
      activeDays++;
      totalKm += km;
      totalMin += min;
      const dt = new Date(d.date + 'T00:00:00');
      const wk = weekKey(dt);
      let w = weeks.get(wk);
      if (!w) { w = { km: 0, days: 0, sample: dt }; weeks.set(wk, w); }
      w.km += km; w.days++;
      const mk = (d.date || '').slice(0, 7);
      let mo = months.get(mk);
      if (!mo) { mo = { km: 0, days: 0 }; months.set(mk, mo); }
      mo.km += km; mo.days++;
    }

    const weekRows = [...weeks.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, w]) => ({
        key,
        label: `KW ${isoWeek(w.sample).week}`,
        range: weekRange(w.sample),
        days: w.days,
        km: r1(w.km),
        avgKmDay: r1(w.km / (w.days || 1)),
      }));

    const monthRows = [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, mo]) => ({
        ym,
        label: monthLabelDe(ym),
        days: mo.days,
        km: r1(mo.km),
        avgKmDay: r1(mo.km / (mo.days || 1)),
      }));

    const wc = weeks.size;
    const mc = months.size;
    return {
      vehicle: v.vehicle,
      plate: v.plate || '',
      activeDays,
      weeks: wc,
      months: mc,
      totalKm: r1(totalKm),
      totalMin,
      avgKmDay: r1(totalKm / (activeDays || 1)),
      avgKmWeek: r1(totalKm / (wc || 1)),
      avgKmMonth: r1(totalKm / (mc || 1)),
      avgMinDay: Math.round(totalMin / (activeDays || 1)),
      weekRows,
      monthRows,
    };
  }).filter((a) => a.activeDays > 0);
}

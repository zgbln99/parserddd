// Build the Fahrerliste (accountant's list) fill payload from a driver's
// monthly analysis. Mirrors the per-driver "send to list" in AnalysisView so
// the bulk "send all pending drivers" action writes the same cells.
//
// Note: charter/Übernachtung VMA (money) isn't applied here — the bulk path
// uses the plain diet-day count; charter drivers can still be sent
// individually from their analysis.
import type { AnalysisResult } from '../types';
import type { MonthlyDays, FahrerlisteFillPayload } from './api';

const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

export function buildFahrerlisteFillPayload(
  result: AnalysisResult,
  period: string,
  monthly: MonthlyDays | null,
  vacationDays?: number,
): FahrerlisteFillPayload {
  const s = result.summary;
  const di = result.driver_info;

  // Per-day total minutes for shifts that belong to this month.
  const dayMin: Record<number, number> = {};
  for (const sh of result.shift_details || []) {
    const ds = sh.grid_date || sh.shift_date;
    if (!ds || ds.slice(0, 7) !== period) continue;
    const d = parseInt(ds.slice(8, 10), 10);
    if (!isNaN(d)) dayMin[d] = (dayMin[d] || 0) + (sh.duration_minutes || 0);
  }
  const days: Record<string, string> = {};
  for (const [d, m] of Object.entries(dayMin)) if (m > 0) days[d] = hm(m);

  // Per-day Ur/Kr markers from the driver's monthly data.
  const absences: Record<string, string> = {};
  if (monthly?.absence_days) {
    for (const [dateStr, mark] of Object.entries(monthly.absence_days)) {
      if (dateStr.slice(0, 7) === period) {
        const d = parseInt(dateStr.slice(8, 10), 10);
        if (!isNaN(d)) absences[String(d)] = String(mark);
      }
    }
  }

  return {
    period,
    driver_name: di.driver_name || '',
    driver_card: di.card_number || '',
    days,
    absences,
    n25: monthly?.override_n25 || +((s.night_25_minutes || 0) / 60).toFixed(2),
    n40: monthly?.override_n40 || +((s.night_40_minutes || 0) / 60).toFixed(2),
    vma: s.diet_count,
    az: monthly?.override_work_hm || hm(s.total_work_minutes || 0),
    ur: (monthly?.vacation_days || vacationDays) || undefined,
    kr: monthly?.sick_days || undefined,
  };
}

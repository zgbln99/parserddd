// Vacation-vs-card conflict detection.
//
// A "conflict" is a day a driver was declared on vacation (Urlaub) — or marked
// absent (Ur/Kr) — yet the tachograph card shows recorded work. This is the
// single source of truth used both by the per-driver panel in AnalysisView and
// by the cross-driver scan on the payroll page, so both agree exactly.

import type { ShiftDetail } from '../types';

export interface VacationRange {
  von: string; // YYYY-MM-DD
  bis: string; // YYYY-MM-DD
  tage?: number;
}

export type AbsenceMark = 'Ur' | 'Kr';

export interface DayConflict {
  day: number; // day-of-month (1..31)
  work: number; // work minutes on the card that day
  source: 'pdf' | 'saved';
  mark?: AbsenceMark; // present when source === 'saved'
}

// Map day-of-month -> total work minutes, attributing each shift to the day
// where most of its work happened.
//
// Default attribution: grid_date (backend midpoint). Collision fix
// (non-cascading): when two shifts midpoint into the same calendar day, look at
// each shift's *other* candidate day (the side of midnight that grid_date didn't
// pick). If exactly one has its alternative day FREE, move that one there. Never
// push onto a day that already has a shift.
export function buildDayWorkMap(shifts: ShiftDetail[]): Record<number, number> {
  const dayOf = (s?: string) => {
    if (!s) return NaN;
    const d = parseInt(s.slice(8, 10), 10);
    return isNaN(d) ? NaN : d;
  };

  // Pass 1: tentative assignment by grid_date.
  const assignment = new Map<number, number>();
  const dayOccupancy = new Map<number, number[]>();
  shifts.forEach((sh, i) => {
    const d = !isNaN(dayOf(sh.grid_date)) ? dayOf(sh.grid_date) : dayOf(sh.shift_date);
    if (isNaN(d)) return;
    assignment.set(i, d);
    const bucket = dayOccupancy.get(d) ?? [];
    bucket.push(i);
    dayOccupancy.set(d, bucket);
  });

  const isFree = (d: number) => !(dayOccupancy.get(d)?.length);

  // Pass 2: for each colliding day, try to move shifts whose alternative
  // candidate (shift_date or shift_end — whichever grid_date didn't pick) is
  // empty. Only moves into genuinely free days, so no cascades.
  for (const [day, idxs] of dayOccupancy) {
    if (idxs.length <= 1) continue;
    for (const i of [...idxs]) {
      const current = dayOccupancy.get(day) ?? [];
      if (current.length <= 1) break; // collision resolved
      const sh = shifts[i];
      const startDay = dayOf(sh.shift_date);
      const endDay = dayOf(sh.shift_end);
      const altDay = day === startDay ? endDay : startDay;
      if (isNaN(altDay) || altDay === day || !isFree(altDay)) continue;
      assignment.set(i, altDay);
      dayOccupancy.set(day, current.filter(j => j !== i));
      dayOccupancy.set(altDay, [i]);
    }
  }

  const map: Record<number, number> = {};
  shifts.forEach((sh, i) => {
    const d = assignment.get(i);
    if (d == null) return;
    map[d] = (map[d] || 0) + sh.duration_minutes;
  });
  return map;
}

// Weekdays (Mon–Fri) inside (year, month) that fall within any vacation range.
// Weekends are excluded — a vacation range spanning a weekend never marks Sat/Sun.
export function buildVacationDaySet(
  ranges: VacationRange[] | undefined,
  year: number,
  month: number, // 1-indexed
): Set<number> {
  const set = new Set<number>();
  if (!ranges?.length) return set;
  for (const range of ranges) {
    const vonDate = new Date(range.von);
    const bisDate = new Date(range.bis);
    for (let d = new Date(vonDate); d <= bisDate; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() === year && d.getMonth() + 1 === month) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) set.add(d.getDate());
      }
    }
  }
  return set;
}

// Given a work map + vacation days + saved absence marks, list conflicting days:
//  - a PDF vacation day that has card work and is not already saved as absent
//  - a saved Ur/Kr mark on a day that (per the card) has work
export function findConflicts(
  dayWorkMap: Record<number, number>,
  vacationDaySet: Set<number>,
  absenceDays?: Record<string, AbsenceMark>,
): DayConflict[] {
  const saved = absenceDays || {};
  const list: DayConflict[] = [];
  for (const day of vacationDaySet) {
    if ((dayWorkMap[day] || 0) > 0 && !saved[String(day)]) {
      list.push({ day, work: dayWorkMap[day], source: 'pdf' });
    }
  }
  for (const [key, mark] of Object.entries(saved)) {
    const d = Number(key);
    if ((dayWorkMap[d] || 0) > 0) {
      list.push({ day: d, work: dayWorkMap[d], source: 'saved', mark: mark as AbsenceMark });
    }
  }
  return list.sort((a, b) => a.day - b.day);
}

// Convenience: build the maps from raw inputs and return conflicts. Used by the
// cross-driver scan, where shifts come straight from a fresh card analysis.
export function computeVacationConflicts(params: {
  shifts: ShiftDetail[];
  ranges?: VacationRange[];
  absenceDays?: Record<string, AbsenceMark>;
  year: number;
  month: number; // 1-indexed
}): DayConflict[] {
  const dayWorkMap = buildDayWorkMap(params.shifts);
  const vacationDaySet = buildVacationDaySet(params.ranges, params.year, params.month);
  return findConflicts(dayWorkMap, vacationDaySet, params.absenceDays);
}

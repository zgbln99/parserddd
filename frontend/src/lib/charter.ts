// Charter diet rule — German Spesen, split by work-week.
//
// For Charter drivers:
//   * Weekends (Sat/Sun) never count — driver is at home.
//   * Within each Mon–Fri block, group consecutive workdays into one
//     delegation period (gap > 1 weekday = new period).
//   * First weekday of period      → 14 €              (departure)
//   * Each full middle day (24h)   → 28 €              (in-trip)
//   * Last weekday of period       → 14 €              (return)
//   * Each overnight in cab during the trip → +9 €
//     (attached to the day the driver wakes up — i.e. every day except
//      the first day of the period).
//   * A single-day trip            → 14 € only, no Übernachtung.
//
// A new week always starts a fresh delegation: Fri → Mon naturally
// splits because the calendar gap is 3 days (Sat/Sun excluded).
//
// Non-charter drivers keep the old behaviour (per-shift has_diet flag,
// optionally 2× with double_diet).

export const UBERNACHTUNG_EUR = 9;

export interface CharterShift {
  shift_date?: string;
  grid_date?: string;
  has_diet?: boolean;
}

export interface CharterInputs {
  shifts: CharterShift[];
  dietRate: number;          // base diet (€/half-day), default 14
  charterEnabled: boolean;
  doubleDiet: boolean;       // ignored when charter
}

export interface CharterResult {
  dietCount: number;
  dietAmount: number;
  ubernachtungAmount: number;
  totalAmount: number;
  byWeekday: Record<number, number>;
}

export interface ShiftCost {
  diet: number;
  ubernachtung: number;
}

function shiftDate(sh: CharterShift): string {
  return sh.grid_date || sh.shift_date || '';
}

function shiftWeekday(sh: CharterShift): number | null {
  const ds = shiftDate(sh);
  if (!ds) return null;
  const d = new Date(ds + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d.getUTCDay();
}

function dayDiff(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86400000);
}

/** Build per-date charter cost map by detecting continuous delegation
 *  periods (consecutive calendar days). */
function isWeekendDate(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

export function computeCharterCosts(
  shifts: CharterShift[],
  dietRate: number,
): Map<string, ShiftCost> {
  const result = new Map<string, ShiftCost>();
  const uniqDates = Array.from(new Set(shifts.map(shiftDate).filter(Boolean)))
    .filter(d => !isWeekendDate(d))   // weekends never part of delegation
    .sort();
  if (uniqDates.length === 0) return result;

  // Split into consecutive-day groups.
  const groups: string[][] = [];
  let current: string[] = [uniqDates[0]];
  for (let i = 1; i < uniqDates.length; i++) {
    if (dayDiff(uniqDates[i - 1], uniqDates[i]) === 1) {
      current.push(uniqDates[i]);
    } else {
      groups.push(current);
      current = [uniqDates[i]];
    }
  }
  groups.push(current);

  for (const group of groups) {
    if (group.length === 1) {
      // Single-day trip: 14 € only.
      result.set(group[0], { diet: dietRate, ubernachtung: 0 });
      continue;
    }
    // First day — departure (14 €, no overnight).
    result.set(group[0], { diet: dietRate, ubernachtung: 0 });
    // Middle days — full 24h (28 € + 9 € for the previous night in cab).
    for (let i = 1; i < group.length - 1; i++) {
      result.set(group[i], { diet: dietRate * 2, ubernachtung: UBERNACHTUNG_EUR });
    }
    // Last day — return (14 € + 9 € for the previous night in cab).
    result.set(group[group.length - 1], { diet: dietRate, ubernachtung: UBERNACHTUNG_EUR });
  }
  return result;
}

/** Per-shift cost for table rendering. */
export function shiftCost(
  sh: CharterShift,
  dietRate: number,
  charterEnabled: boolean,
  doubleDiet: boolean,
  charterCosts?: Map<string, ShiftCost>,
): ShiftCost {
  if (charterEnabled) {
    const map = charterCosts ?? computeCharterCosts([sh], dietRate);
    return map.get(shiftDate(sh)) ?? { diet: 0, ubernachtung: 0 };
  }
  if (!sh.has_diet) return { diet: 0, ubernachtung: 0 };
  return { diet: doubleDiet ? dietRate * 2 : dietRate, ubernachtung: 0 };
}

export function computeVma(inputs: CharterInputs): CharterResult {
  const byWeekday: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let dietCount = 0;
  let dietAmount = 0;
  let ubernachtungAmount = 0;

  if (inputs.charterEnabled) {
    const costs = computeCharterCosts(inputs.shifts, inputs.dietRate);
    // Count each delegation day once (regardless of multi-shift days).
    for (const [date, c] of costs) {
      if (c.diet > 0) {
        dietCount += 1;
        const wd = new Date(date + 'T00:00:00Z').getUTCDay();
        if (!isNaN(wd)) byWeekday[wd] += 1;
      }
      dietAmount += c.diet;
      ubernachtungAmount += c.ubernachtung;
    }
    return {
      dietCount,
      dietAmount,
      ubernachtungAmount,
      totalAmount: dietAmount + ubernachtungAmount,
      byWeekday,
    };
  }

  // Non-charter: per-shift has_diet rule.
  const ratePerShift = inputs.doubleDiet ? inputs.dietRate * 2 : inputs.dietRate;
  for (const sh of inputs.shifts) {
    if (!sh.has_diet) continue;
    const wd = shiftWeekday(sh);
    dietCount += 1;
    dietAmount += ratePerShift;
    if (wd != null) byWeekday[wd] += 1;
  }

  return {
    dietCount,
    dietAmount,
    ubernachtungAmount,
    totalAmount: dietAmount + ubernachtungAmount,
    byWeekday,
  };
}

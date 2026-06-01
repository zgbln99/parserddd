// Charter diet rule — for drivers running charter trips, the per-shift
// allowance follows a weekday pattern:
//   Mon / Fri : 1 × diet_rate (no Übernachtung — driver sleeps at home)
//   Tue / Wed / Thu : 2 × diet_rate + 9 € Übernachtung (truck-cabin overnight)
//   Sat : current behaviour (1 × diet_rate if has_diet)
//   Sun : never gets diet
//
// Non-charter drivers keep today's logic (count of has_diet shifts × rate,
// doubled when `double_diet` is set).

export const UBERNACHTUNG_EUR = 9;

export interface CharterShift {
  shift_date?: string;
  grid_date?: string;
  has_diet?: boolean;
}

export interface CharterInputs {
  shifts: CharterShift[];
  dietRate: number;          // base diet (€/half-day)
  charterEnabled: boolean;
  doubleDiet: boolean;       // ignored when charter (charter implies 2× rate)
}

export interface CharterResult {
  /** How many shift-days count toward the VMA total (used as the count in
   *  the Excel VMA column when charter is OFF). */
  dietCount: number;
  /** Total diet € (charter Mo–Fr 2×rate, weekends per existing rule). */
  dietAmount: number;
  /** Total Übernachtung € (charter Tue–Thu × 8 €). */
  ubernachtungAmount: number;
  /** Total to show on the VMA tile / write into the Excel VMA cell when
   *  charter is on. */
  totalAmount: number;
  /** Per-weekday counts for diagnostics / tooltips (0..6, Mon=1..Sun=0). */
  byWeekday: Record<number, number>;
}

/** JS Date: 0 = Sunday, 1 = Mon, ..., 6 = Sat. */
function shiftWeekday(sh: CharterShift): number | null {
  const ds = sh.grid_date || sh.shift_date || '';
  if (!ds) return null;
  const d = new Date(ds + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return d.getUTCDay();
}

/** Cost breakdown for a single shift — used for per-row UI display. */
export interface ShiftCost {
  diet: number;
  ubernachtung: number;
}

export function shiftCost(
  sh: CharterShift,
  dietRate: number,
  charterEnabled: boolean,
  doubleDiet: boolean,
): ShiftCost {
  const ds = sh.grid_date || sh.shift_date || '';
  const d = ds ? new Date(ds + 'T00:00:00Z') : null;
  const wd = d && !isNaN(d.getTime()) ? d.getUTCDay() : null;

  if (charterEnabled) {
    if (wd === 1 || wd === 5) return { diet: dietRate, ubernachtung: 0 };
    if (wd === 2 || wd === 3 || wd === 4) {
      return { diet: dietRate * 2, ubernachtung: UBERNACHTUNG_EUR };
    }
    // Sat (6) / Sun (0): use has_diet flag at 1× rate
    return sh.has_diet ? { diet: dietRate, ubernachtung: 0 } : { diet: 0, ubernachtung: 0 };
  }
  // Non-charter
  if (!sh.has_diet) return { diet: 0, ubernachtung: 0 };
  return { diet: doubleDiet ? dietRate * 2 : dietRate, ubernachtung: 0 };
}

export function computeVma(inputs: CharterInputs): CharterResult {
  const byWeekday: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let dietCount = 0;
  let dietAmount = 0;
  let ubernachtungAmount = 0;
  const ratePerShift = (inputs.charterEnabled || inputs.doubleDiet)
    ? inputs.dietRate * 2
    : inputs.dietRate;

  for (const sh of inputs.shifts) {
    const wd = shiftWeekday(sh);
    if (wd == null) continue;
    const isWeekend = wd === 0 || wd === 6;

    if (inputs.charterEnabled) {
      // Mon (1) / Fri (5): 1× diet, no Übernachtung
      if (wd === 1 || wd === 5) {
        dietCount += 1;
        dietAmount += inputs.dietRate;
        byWeekday[wd] += 1;
        continue;
      }
      // Tue (2) / Wed (3) / Thu (4): 2× diet + 9 € Übernachtung
      if (wd === 2 || wd === 3 || wd === 4) {
        dietCount += 1;
        dietAmount += inputs.dietRate * 2;
        ubernachtungAmount += UBERNACHTUNG_EUR;
        byWeekday[wd] += 1;
        continue;
      }
      // Sat (6) / Sun (0) — fall back to has_diet flag (Sat=14€, Sun=0).
      if (sh.has_diet) {
        dietCount += 1;
        dietAmount += inputs.dietRate;
        byWeekday[wd] += 1;
      }
      continue;
    }

    // Non-charter: today's rule — count only has_diet shifts at ratePerShift.
    if (sh.has_diet) {
      dietCount += 1;
      dietAmount += ratePerShift;
      byWeekday[wd] += 1;
    }
  }

  return {
    dietCount,
    dietAmount,
    ubernachtungAmount,
    totalAmount: dietAmount + ubernachtungAmount,
    byWeekday,
  };
}

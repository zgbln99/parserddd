// Charter diet rule — for drivers running charter trips, the per-shift
// allowance follows a weekday pattern:
//   Mon / Fri : 2 × diet_rate (no Übernachtung)
//   Tue / Wed / Thu : 2 × diet_rate + 8 € Übernachtung
//   Sat / Sun : current behaviour (only if the shift's has_diet is true)
//
// Non-charter drivers keep today's logic (count of has_diet shifts × rate,
// doubled when `double_diet` is set).

export const UBERNACHTUNG_EUR = 8;

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
      // Charter: Mon-Fri always counts (2× diet); add Übernachtung Tue-Thu.
      if (!isWeekend) {
        dietCount += 1;
        dietAmount += inputs.dietRate * 2;
        byWeekday[wd] += 1;
        if (wd === 2 || wd === 3 || wd === 4) {
          ubernachtungAmount += UBERNACHTUNG_EUR;
        }
      } else if (sh.has_diet) {
        // Saturday/Sunday — trust analyze_card's has_diet, which already
        // applies the global weekend_diet setting.
        dietCount += 1;
        dietAmount += inputs.dietRate * 2;
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

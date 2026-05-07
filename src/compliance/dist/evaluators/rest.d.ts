import type { Evaluator } from "./base.js";
/**
 * EU 561 Art. 8 — daily and weekly rest periods.
 *
 * Daily rest detection uses a "between-shift gap" approach: for every pair
 * of work/driving runs we measure the rest run that separates them. The
 * gap must be at least `reduced_daily_rest_minutes` (default 9h) and at
 * least `regular_daily_rest_minutes` (default 11h) — reductions are allowed
 * up to `reduced_allowed_between_weekly_rests` per week.
 *
 * Daily rest can be taken as one block OR as a 3+9 split (Art. 4(g)) —
 * `splitDailyRestMinutes` reports the equivalent total minutes when a valid
 * split is found in the inter-shift window; the evaluator picks whichever
 * interpretation is more favourable to compliance.
 *
 * Weekly rest follows Art. 8(6): a new weekly rest must begin within
 * 6×24h after the END of the previous weekly rest.
 */
export declare const restEvaluator: Evaluator;
//# sourceMappingURL=rest.d.ts.map
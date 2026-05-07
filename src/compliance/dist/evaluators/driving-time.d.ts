import type { Evaluator } from "./base.js";
/**
 * EU 561 Art. 6:
 *  - Daily limit 9h, may be extended to 10h max twice per week.
 *  - Weekly limit 56h.
 *  - Two-consecutive-week limit 90h.
 *
 * The day limit is decided per day with this policy: a day's driving over
 * `normal_limit_minutes` is allowed only on up to `allowed_extensions_per_week`
 * days within the same ISO week, and never above `extended_limit_minutes`.
 *
 * If the YAML logic block is missing required parameters we return
 * `not_evaluable` rather than guessing — the spec is non-negotiable.
 */
export declare const drivingTimeEvaluator: Evaluator;
//# sourceMappingURL=driving-time.d.ts.map
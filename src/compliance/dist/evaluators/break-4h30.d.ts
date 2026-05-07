import type { Evaluator } from "./base.js";
/**
 * EU 561 Art. 7: after at most 4h30 of cumulative driving without a
 * qualifying break, a 45-minute break (or 15 + 30 split) must occur.
 *
 * The continuous-driving helper returns segments separated by qualifying
 * breaks; if `maxContinuousDrivingMinutes(seg)` exceeds the threshold, we
 * emit one violation per offending segment.
 */
export declare const breakAfter4h30Evaluator: Evaluator;
//# sourceMappingURL=break-4h30.d.ts.map
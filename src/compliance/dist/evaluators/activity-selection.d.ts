import type { Evaluator } from "./base.js";
/**
 * Activity-selection sanity checks. None of these can be detected with 100%
 * certainty (only the driver knows what they were really doing), so each
 * uses heuristic confidence < 1.
 *
 *  - REST_DURING_WORK: REST overlaps a card session in which odometer
 *    readings differ at start vs end (movement happened) — strongly
 *    suggests REST was selected during actual work.
 *  - OUT_MISUSE: an OUT-of-scope window longer than the rule's
 *    `max_consecutive_minutes` threshold; treated as misuse if it covers
 *    more than that many consecutive minutes.
 *  - AVAILABILITY_INSTEAD_OF_WORK: AVAILABILITY immediately wrapped between
 *    two DRIVING segments without a real break — driver almost certainly
 *    was loading/unloading, not "available".
 */
export declare const activitySelectionEvaluator: Evaluator;
//# sourceMappingURL=activity-selection.d.ts.map
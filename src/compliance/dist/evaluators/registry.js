import { combineEvaluations } from "./base.js";
import { countryEntryEvaluator } from "./country-entry.js";
import { manualEntryEvaluator } from "./manual-entry.js";
import { cardEvaluator } from "./card.js";
import { activitySelectionEvaluator } from "./activity-selection.js";
import { drivingTimeEvaluator } from "./driving-time.js";
import { breakAfter4h30Evaluator } from "./break-4h30.js";
import { restEvaluator } from "./rest.js";
import { workingTimeEvaluator } from "./working-time.js";
import { downloadsEvaluator } from "./downloads.js";
import { eventsFaultsEvaluator } from "./events-faults.js";
/**
 * Default evaluator registry.
 *
 * Order is fixed so engine output is stable run-to-run. Categories are
 * grouped roughly by spec order:
 *   A — country entries / manual entries
 *   B — card slot
 *   C — activity selection
 *   D — driving time / breaks / rests
 *   E — KrFArbZG working time / breaks / night
 *   F — downloads / retention / inspection
 *   G — events / faults / printout / manipulation
 */
export const DEFAULT_EVALUATORS = Object.freeze([
    countryEntryEvaluator,
    manualEntryEvaluator,
    cardEvaluator,
    activitySelectionEvaluator,
    drivingTimeEvaluator,
    breakAfter4h30Evaluator,
    restEvaluator,
    workingTimeEvaluator,
    downloadsEvaluator,
    eventsFaultsEvaluator,
]);
export function evaluateAll(ctx, evaluators = DEFAULT_EVALUATORS) {
    const all = [];
    for (const evaluator of evaluators) {
        all.push(...evaluator.evaluate(ctx));
    }
    return combineEvaluations(ctx, all);
}
//# sourceMappingURL=registry.js.map
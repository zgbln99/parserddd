import type { Evaluator } from "./base.js";
/**
 * Tachograph events / faults / printouts / manipulation indicators.
 *
 * The classification rules below mirror EU 165/2014 Annex IC event/fault
 * codes. Codes are matched by `type` prefix:
 *   - "EVENT_*"        → EU_165_TACHOGRAPH_EVENT
 *   - "FAULT_*"        → EU_165_TACHOGRAPH_FAULT
 *   - "MANIPULATION_*" / "TAMPER_*" → EU_165_MANIPULATION_INDICATOR
 *
 * `EU_165_PRINTOUT_REQUIRED` checks that for every FAULT or
 * MANIPULATION-suspect event we have at least one printout that occurred
 * during or immediately after it.
 */
export declare const eventsFaultsEvaluator: Evaluator;
//# sourceMappingURL=events-faults.d.ts.map
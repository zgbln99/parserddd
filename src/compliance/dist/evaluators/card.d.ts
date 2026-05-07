import type { Evaluator } from "./base.js";
/**
 * Evaluator for category B — card-handling failures.
 *
 *  - DRIVING_WITHOUT_CARD: any DRIVING activity falling inside a card-out
 *    window or carrying `card_inserted: false`.
 *  - CARD_REMOVED_TOO_EARLY: card session ends while the very next activity
 *    is still WORK or DRIVING (i.e. driver pulled the card mid-shift).
 *  - WRONG_SLOT: DRIVING activity registered on slot CO_DRIVER (the card
 *    must always be in the DRIVER slot when the holder is driving).
 *  - MISSING_CO_DRIVER: any activity that itself declares multi-manning
 *    via `notes: ["multi_manning"]` while the timeline only has DRIVER
 *    slot data.
 */
export declare const cardEvaluator: Evaluator;
//# sourceMappingURL=card.d.ts.map
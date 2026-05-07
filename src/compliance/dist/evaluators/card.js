import { buildViolation, ruleSetVersionFor } from "./base.js";
import { findGaps, durationMinutes } from "../calculations/time.js";
const RULE_DRIVING_NO_CARD = "EU_165_DRIVING_WITHOUT_CARD";
const RULE_CARD_REMOVED_EARLY = "EU_165_CARD_REMOVED_TOO_EARLY";
const RULE_WRONG_SLOT = "EU_165_WRONG_SLOT";
const RULE_MISSING_CO_DRIVER = "EU_165_MISSING_CO_DRIVER";
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
export const cardEvaluator = {
    rule_ids: [
        RULE_DRIVING_NO_CARD,
        RULE_CARD_REMOVED_EARLY,
        RULE_WRONG_SLOT,
        RULE_MISSING_CO_DRIVER,
    ],
    evaluate(ctx) {
        return [
            drivingWithoutCard(ctx),
            cardRemovedTooEarly(ctx),
            wrongSlot(ctx),
            missingCoDriver(ctx),
        ].filter((x) => x !== null);
    },
};
function drivingWithoutCard(ctx) {
    const rule = ctx.rules.by_id.get(RULE_DRIVING_NO_CARD);
    if (!rule)
        return null;
    // Card-out windows = gaps in the card-session sequence within the range.
    const cardOut = ctx.timeline.card_sessions.length === 0
        ? [ctx.timeline.range]
        : findGaps(ctx.timeline.range, ctx.timeline.card_sessions);
    const offenders = ctx.timeline.activities.filter((a) => a.kind === "DRIVING" &&
        (!a.card_inserted ||
            cardOut.some((g) => a.start < g.end && a.end > g.start)));
    if (offenders.length === 0) {
        return { status: "compliant", rule_id: RULE_DRIVING_NO_CARD };
    }
    const violations = offenders.map((a) => buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: a.start,
        end_time: a.end,
        measured_value: durationMinutes(a),
        allowed_value: 0,
        excess_value: durationMinutes(a),
        unit: "minutes",
        source_activity_ids: [a.id],
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, RULE_DRIVING_NO_CARD),
    }));
    return { status: "evaluated", rule_id: RULE_DRIVING_NO_CARD, violations };
}
function cardRemovedTooEarly(ctx) {
    const rule = ctx.rules.by_id.get(RULE_CARD_REMOVED_EARLY);
    if (!rule)
        return null;
    if (ctx.timeline.card_sessions.length === 0) {
        return {
            status: "not_evaluable",
            rule_id: RULE_CARD_REMOVED_EARLY,
            reason: "no card sessions on timeline",
            missing_fields: ["timeline.card_sessions"],
        };
    }
    const violations = [];
    for (const session of ctx.timeline.card_sessions) {
        const next = ctx.timeline.activities.find((a) => a.start.getTime() >= session.end.getTime());
        if (!next)
            continue;
        const gapMs = next.start.getTime() - session.end.getTime();
        // If the next activity starts (almost) immediately and is WORK or DRIVING
        // the card was clearly pulled before the shift ended.
        if (gapMs < 60_000 && (next.kind === "WORK" || next.kind === "DRIVING")) {
            violations.push(buildViolation({
                rule,
                fines: ctx.fines,
                driver_id: ctx.timeline.driver_id,
                start_time: session.end,
                end_time: next.end,
                measured_value: durationMinutes({ start: session.end, end: next.end }),
                allowed_value: 0,
                excess_value: durationMinutes({ start: session.end, end: next.end }),
                unit: "minutes",
                source_activity_ids: [next.id],
                confidence: 1,
                rule_set_version: ruleSetVersionFor(ctx.rules, RULE_CARD_REMOVED_EARLY),
            }));
        }
    }
    return violations.length === 0
        ? { status: "compliant", rule_id: RULE_CARD_REMOVED_EARLY }
        : { status: "evaluated", rule_id: RULE_CARD_REMOVED_EARLY, violations };
}
function wrongSlot(ctx) {
    const rule = ctx.rules.by_id.get(RULE_WRONG_SLOT);
    if (!rule)
        return null;
    const offenders = ctx.timeline.activities.filter((a) => a.kind === "DRIVING" && a.slot === "CO_DRIVER");
    if (offenders.length === 0) {
        return { status: "compliant", rule_id: RULE_WRONG_SLOT };
    }
    const violations = offenders.map((a) => buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: a.start,
        end_time: a.end,
        measured_value: 1,
        allowed_value: 0,
        excess_value: 1,
        unit: "count",
        source_activity_ids: [a.id],
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, RULE_WRONG_SLOT),
    }));
    return { status: "evaluated", rule_id: RULE_WRONG_SLOT, violations };
}
function missingCoDriver(ctx) {
    const rule = ctx.rules.by_id.get(RULE_MISSING_CO_DRIVER);
    if (!rule)
        return null;
    const declared = ctx.timeline.activities.filter((a) => a.notes.some((n) => n === "multi_manning" || n === "MEHRFAHRER" || n === "ZAŁOGA"));
    if (declared.length === 0) {
        return { status: "compliant", rule_id: RULE_MISSING_CO_DRIVER };
    }
    const hasCoDriverData = ctx.timeline.activities.some((a) => a.slot === "CO_DRIVER");
    if (hasCoDriverData) {
        return { status: "compliant", rule_id: RULE_MISSING_CO_DRIVER };
    }
    const first = declared[0];
    const last = declared[declared.length - 1];
    const violations = [
        buildViolation({
            rule,
            fines: ctx.fines,
            driver_id: ctx.timeline.driver_id,
            start_time: first.start,
            end_time: last.end,
            measured_value: 0,
            allowed_value: 1,
            excess_value: 1,
            unit: "count",
            source_activity_ids: declared.map((a) => a.id),
            confidence: 0.8,
            rule_set_version: ruleSetVersionFor(ctx.rules, RULE_MISSING_CO_DRIVER),
        }),
    ];
    return { status: "evaluated", rule_id: RULE_MISSING_CO_DRIVER, violations };
}
//# sourceMappingURL=card.js.map
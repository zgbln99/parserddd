import { buildViolation, ruleSetVersionFor } from "./base.js";
const RULE_EVENT = "EU_165_TACHOGRAPH_EVENT";
const RULE_FAULT = "EU_165_TACHOGRAPH_FAULT";
const RULE_PRINTOUT = "EU_165_PRINTOUT_REQUIRED";
const RULE_MANIPULATION = "EU_165_MANIPULATION_INDICATOR";
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
export const eventsFaultsEvaluator = {
    rule_ids: [RULE_EVENT, RULE_FAULT, RULE_PRINTOUT, RULE_MANIPULATION],
    evaluate(ctx) {
        return [
            classify(ctx, RULE_EVENT, isEvent),
            classify(ctx, RULE_FAULT, isFault),
            classify(ctx, RULE_MANIPULATION, isManipulation),
            printout(ctx),
        ].filter((x) => x !== null);
    },
};
function isEvent(t) {
    return t.startsWith("EVENT_") || t.startsWith("E_");
}
function isFault(t) {
    return t.startsWith("FAULT_") || t.startsWith("F_");
}
function isManipulation(t) {
    return t.startsWith("MANIPULATION_") || t.startsWith("TAMPER_") || t === "MOTION_DATA_ERROR";
}
function classify(ctx, rule_id, match) {
    const rule = ctx.rules.by_id.get(rule_id);
    if (!rule)
        return null;
    const offenders = ctx.timeline.events.filter((e) => match(e.type));
    if (offenders.length === 0) {
        return { status: "compliant", rule_id };
    }
    const violations = offenders.map((e) => buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: e.begin,
        end_time: e.end ?? e.begin,
        measured_value: 1,
        allowed_value: 0,
        excess_value: 1,
        unit: "count",
        source_activity_ids: [],
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, rule_id),
    }));
    return { status: "evaluated", rule_id, violations };
}
function printout(ctx) {
    const rule = ctx.rules.by_id.get(RULE_PRINTOUT);
    if (!rule)
        return null;
    const requiringPrintout = ctx.timeline.events.filter((e) => isFault(e.type) || isManipulation(e.type));
    if (requiringPrintout.length === 0) {
        return { status: "compliant", rule_id: RULE_PRINTOUT };
    }
    const violations = [];
    for (const e of requiringPrintout) {
        const eventEnd = e.end ?? e.begin;
        const found = ctx.timeline.printouts.some((p) => {
            const dt = p.created_at.getTime() - e.begin.getTime();
            // A printout counts if it happens between event start and 2h after end.
            return (p.created_at >= e.begin &&
                p.created_at.getTime() <= eventEnd.getTime() + 2 * 3600 * 1000 &&
                dt >= 0);
        });
        if (!found) {
            violations.push(buildViolation({
                rule,
                fines: ctx.fines,
                driver_id: ctx.timeline.driver_id,
                start_time: e.begin,
                end_time: eventEnd,
                measured_value: 0,
                allowed_value: 1,
                excess_value: 1,
                unit: "count",
                source_activity_ids: [],
                confidence: 1,
                rule_set_version: ruleSetVersionFor(ctx.rules, RULE_PRINTOUT),
            }));
        }
    }
    return violations.length === 0
        ? { status: "compliant", rule_id: RULE_PRINTOUT }
        : { status: "evaluated", rule_id: RULE_PRINTOUT, violations };
}
//# sourceMappingURL=events-faults.js.map
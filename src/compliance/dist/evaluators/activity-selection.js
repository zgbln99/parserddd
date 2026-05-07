import { buildViolation, ruleSetVersionFor } from "./base.js";
import { durationMinutes } from "../calculations/time.js";
const RULE_REST_DURING_WORK = "EU_165_REST_DURING_WORK";
const RULE_OUT_MISUSE = "EU_165_OUT_MISUSE";
const RULE_AVAIL_INSTEAD = "EU_165_AVAILABILITY_INSTEAD_OF_WORK";
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
export const activitySelectionEvaluator = {
    rule_ids: [RULE_REST_DURING_WORK, RULE_OUT_MISUSE, RULE_AVAIL_INSTEAD],
    evaluate(ctx) {
        return [
            restDuringWork(ctx),
            outMisuse(ctx),
            availabilityInsteadOfWork(ctx),
        ].filter((x) => x !== null);
    },
};
function restDuringWork(ctx) {
    const rule = ctx.rules.by_id.get(RULE_REST_DURING_WORK);
    if (!rule)
        return null;
    const movingSessions = ctx.timeline.card_sessions.filter((s) => s.start_odometer_km != null &&
        s.end_odometer_km != null &&
        s.end_odometer_km - s.start_odometer_km >= 1);
    if (movingSessions.length === 0) {
        return { status: "compliant", rule_id: RULE_REST_DURING_WORK };
    }
    const violations = ctx.timeline.activities
        .filter((a) => a.kind === "REST" &&
        movingSessions.some((s) => a.start < s.end && a.end > s.start))
        .map((a) => buildViolation({
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
        confidence: 0.6,
        rule_set_version: ruleSetVersionFor(ctx.rules, RULE_REST_DURING_WORK),
    }));
    return violations.length === 0
        ? { status: "compliant", rule_id: RULE_REST_DURING_WORK }
        : { status: "evaluated", rule_id: RULE_REST_DURING_WORK, violations };
}
function outMisuse(ctx) {
    const rule = ctx.rules.by_id.get(RULE_OUT_MISUSE);
    if (!rule)
        return null;
    const max = rule.logic
        ?.max_consecutive_minutes ?? 720;
    const runs = [];
    for (const a of ctx.timeline.activities) {
        if (!a.out_of_scope)
            continue;
        const last = runs[runs.length - 1];
        if (last && last.end.getTime() === a.start.getTime()) {
            last.end = a.end;
            last.ids.push(a.id);
        }
        else {
            runs.push({ start: a.start, end: a.end, ids: [a.id] });
        }
    }
    const offenders = runs.filter((r) => Math.round((r.end.getTime() - r.start.getTime()) / 60_000) > max);
    if (offenders.length === 0) {
        return { status: "compliant", rule_id: RULE_OUT_MISUSE };
    }
    const violations = offenders.map((r) => buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: r.start,
        end_time: r.end,
        measured_value: Math.round((r.end.getTime() - r.start.getTime()) / 60_000),
        allowed_value: max,
        excess_value: Math.round((r.end.getTime() - r.start.getTime()) / 60_000) - max,
        unit: "minutes",
        source_activity_ids: r.ids,
        confidence: 0.7,
        rule_set_version: ruleSetVersionFor(ctx.rules, RULE_OUT_MISUSE),
    }));
    return { status: "evaluated", rule_id: RULE_OUT_MISUSE, violations };
}
function availabilityInsteadOfWork(ctx) {
    const rule = ctx.rules.by_id.get(RULE_AVAIL_INSTEAD);
    if (!rule)
        return null;
    const violations = [];
    const acts = ctx.timeline.activities;
    for (let i = 1; i < acts.length - 1; i++) {
        const prev = acts[i - 1];
        const curr = acts[i];
        const next = acts[i + 1];
        if (!prev || !curr || !next)
            continue;
        if (curr.kind === "AVAILABILITY" &&
            prev.kind === "DRIVING" &&
            next.kind === "DRIVING" &&
            durationMinutes(curr) >= 5 &&
            durationMinutes(curr) <= 90) {
            // Sandwich pattern: short availability between two driving runs.
            // Real availability would normally be hours, not minutes.
            violations.push(buildViolation({
                rule,
                fines: ctx.fines,
                driver_id: ctx.timeline.driver_id,
                start_time: curr.start,
                end_time: curr.end,
                measured_value: durationMinutes(curr),
                allowed_value: 0,
                excess_value: durationMinutes(curr),
                unit: "minutes",
                source_activity_ids: [curr.id],
                confidence: 0.5,
                rule_set_version: ruleSetVersionFor(ctx.rules, RULE_AVAIL_INSTEAD),
            }));
        }
    }
    return violations.length === 0
        ? { status: "compliant", rule_id: RULE_AVAIL_INSTEAD }
        : { status: "evaluated", rule_id: RULE_AVAIL_INSTEAD, violations };
}
//# sourceMappingURL=activity-selection.js.map
import { buildViolation, ruleSetVersionFor, } from "./base.js";
import { findGaps, sortIntervals } from "../calculations/time.js";
/**
 * EU 165/2014 Art. 34: between the moment the card is removed and the next
 * insertion, the driver must record activities manually on the next
 * insertion. We detect three failure modes:
 *
 *  1. EU_165_MISSING_MANUAL_ENTRY  — there is a card-out window NOT covered
 *                                    by any manual entry.
 *  2. EU_165_INCOMPLETE_MANUAL_ENTRY — the manual entry exists but is flagged
 *                                      `complete: false` by the parser.
 *  3. EU_165_DRIVING_WITHOUT_CARD  — DRIVING activity overlaps a card-out
 *                                    window (handled by separate evaluator;
 *                                    we only signal the manual-entry side here).
 *
 * The "card-out window" is the union of gaps in the card-session sequence
 * intersected with the timeline range.
 */
const RULE_MISSING = "EU_165_MISSING_MANUAL_ENTRY";
const RULE_INCOMPLETE = "EU_165_INCOMPLETE_MANUAL_ENTRY";
export const manualEntryEvaluator = {
    rule_ids: [RULE_MISSING, RULE_INCOMPLETE],
    evaluate(ctx) {
        const out = [];
        const r_missing = ctx.rules.by_id.get(RULE_MISSING);
        const r_incomplete = ctx.rules.by_id.get(RULE_INCOMPLETE);
        if (r_missing) {
            out.push(evaluateMissing(ctx));
        }
        if (r_incomplete) {
            out.push(evaluateIncomplete(ctx));
        }
        return out;
    },
};
function evaluateMissing(ctx) {
    const rule = ctx.rules.by_id.get(RULE_MISSING);
    if (!rule) {
        return { status: "not_evaluable", rule_id: RULE_MISSING, reason: "rule not loaded", missing_fields: [] };
    }
    // We need at least the timeline range. Card sessions may be empty
    // (legitimately, e.g. a brand-new driver), so we treat the entire range as
    // a single card-out window in that case ONLY if there are also no
    // activities — otherwise we cannot tell what happened and return
    // not_evaluable.
    if (ctx.timeline.card_sessions.length === 0 && ctx.timeline.activities.some((a) => a.kind !== "UNKNOWN")) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "activities present but no card sessions — cannot delimit card-out windows",
            missing_fields: ["timeline.card_sessions"],
        };
    }
    const cardOutGaps = findGaps(ctx.timeline.range, ctx.timeline.card_sessions);
    const manualCovered = ctx.timeline.manual_entries;
    const uncovered = subtractIntervals(cardOutGaps, manualCovered);
    // Filter out trivial gaps (< 1 minute) — those are clock-skew noise from
    // back-to-back card sessions, not real card-out events.
    const meaningful = uncovered.filter((g) => g.end.getTime() - g.start.getTime() >= 60_000);
    if (meaningful.length === 0) {
        return { status: "compliant", rule_id: rule.rule_id };
    }
    const violations = meaningful.map((gap) => buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: gap.start,
        end_time: gap.end,
        measured_value: Math.round((gap.end.getTime() - gap.start.getTime()) / 60_000),
        allowed_value: 0,
        excess_value: Math.round((gap.end.getTime() - gap.start.getTime()) / 60_000),
        unit: "minutes",
        source_activity_ids: ctx.timeline.activities
            .filter((a) => a.start < gap.end && a.end > gap.start)
            .map((a) => a.id),
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
    }));
    return { status: "evaluated", rule_id: rule.rule_id, violations };
}
function evaluateIncomplete(ctx) {
    const rule = ctx.rules.by_id.get(RULE_INCOMPLETE);
    if (!rule) {
        return { status: "not_evaluable", rule_id: RULE_INCOMPLETE, reason: "rule not loaded", missing_fields: [] };
    }
    const incomplete = ctx.timeline.manual_entries.filter((m) => !m.complete);
    if (incomplete.length === 0) {
        return { status: "compliant", rule_id: rule.rule_id };
    }
    const violations = incomplete.map((m) => buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: m.start,
        end_time: m.end,
        measured_value: 0,
        allowed_value: 1,
        excess_value: 1,
        unit: "count",
        source_activity_ids: [],
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
    }));
    return { status: "evaluated", rule_id: rule.rule_id, violations };
}
/**
 * Compute (A − B) on intervals: parts of `a` not covered by any element of
 * `b`. Both inputs are treated as sets; the result is sorted and disjoint.
 */
function subtractIntervals(a, b) {
    const out = [];
    const subtractors = sortIntervals(b);
    for (const interval of sortIntervals(a)) {
        let cursor = interval.start;
        for (const sub of subtractors) {
            if (sub.end <= cursor)
                continue;
            if (sub.start >= interval.end)
                break;
            const gapEnd = sub.start > cursor ? sub.start : cursor;
            if (gapEnd > cursor && gapEnd > interval.start && gapEnd < interval.end) {
                out.push({ start: cursor, end: gapEnd });
            }
            if (sub.end > cursor)
                cursor = sub.end > interval.end ? interval.end : sub.end;
            if (cursor >= interval.end)
                break;
        }
        if (cursor < interval.end) {
            out.push({ start: cursor, end: interval.end });
        }
    }
    return out.filter((g) => g.end > g.start);
}
//# sourceMappingURL=manual-entry.js.map
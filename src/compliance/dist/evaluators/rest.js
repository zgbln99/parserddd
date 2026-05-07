import { buildViolation, ruleSetVersionFor } from "./base.js";
import { findRestRuns } from "../calculations/rest-windows.js";
const RULE_DAILY = "EU_561_ART8_DAILY_REST";
const RULE_WEEKLY = "EU_561_ART8_WEEKLY_REST";
function readDailyRestLogic(rule) {
    const l = rule.logic;
    if (!l ||
        typeof l.regular_daily_rest_minutes !== "number" ||
        typeof l.reduced_daily_rest_minutes !== "number") {
        return null;
    }
    const ll = l;
    return {
        regular_daily_rest_minutes: l.regular_daily_rest_minutes,
        reduced_daily_rest_minutes: l.reduced_daily_rest_minutes,
        reduced_allowed_between_weekly_rests: l.reduced_allowed_between_weekly_rests ?? 3,
        window_minutes: l.window_minutes ?? 1440,
        split_first_min_minutes: ll.split_first_min_minutes ?? 180,
        split_second_min_minutes: ll.split_second_min_minutes ?? 540,
    };
}
function readWeeklyRestLogic(rule) {
    const l = rule.logic;
    if (!l ||
        typeof l.regular_weekly_rest_minutes !== "number" ||
        typeof l.reduced_weekly_rest_minutes !== "number") {
        return null;
    }
    return {
        regular_weekly_rest_minutes: l.regular_weekly_rest_minutes,
        reduced_weekly_rest_minutes: l.reduced_weekly_rest_minutes,
    };
}
/**
 * EU 561 Art. 8 — daily and weekly rest periods.
 *
 * Daily rest detection uses a "between-shift gap" approach: for every pair
 * of work/driving runs we measure the rest run that separates them. The
 * gap must be at least `reduced_daily_rest_minutes` (default 9h) and at
 * least `regular_daily_rest_minutes` (default 11h) — reductions are allowed
 * up to `reduced_allowed_between_weekly_rests` per week.
 *
 * Daily rest can be taken as one block OR as a 3+9 split (Art. 4(g)) —
 * `splitDailyRestMinutes` reports the equivalent total minutes when a valid
 * split is found in the inter-shift window; the evaluator picks whichever
 * interpretation is more favourable to compliance.
 *
 * Weekly rest follows Art. 8(6): a new weekly rest must begin within
 * 6×24h after the END of the previous weekly rest.
 */
export const restEvaluator = {
    rule_ids: [RULE_DAILY, RULE_WEEKLY],
    evaluate(ctx) {
        const out = [];
        const rDaily = ctx.rules.by_id.get(RULE_DAILY);
        const rWeekly = ctx.rules.by_id.get(RULE_WEEKLY);
        if (rDaily)
            out.push(evalDaily(ctx, rDaily));
        if (rWeekly)
            out.push(evalWeekly(ctx, rWeekly));
        return out;
    },
};
function findDailyRestEvents(rests, logic) {
    const events = [];
    const consumed = new Set();
    for (let i = 0; i < rests.length; i++) {
        if (consumed.has(i))
            continue;
        const r = rests[i];
        if (r.minutes >= logic.reduced_daily_rest_minutes) {
            events.push({ start: r.start, end: r.end, minutes: r.minutes, is_split: false });
            consumed.add(i);
            continue;
        }
        if (r.minutes >= logic.split_first_min_minutes) {
            // Look for a second block of >= split_second_min_minutes within 24h.
            const windowEnd = r.start.getTime() + 24 * 3600 * 1000;
            for (let j = i + 1; j < rests.length; j++) {
                const s = rests[j];
                if (s.end.getTime() > windowEnd)
                    break;
                if (s.minutes >= logic.split_second_min_minutes) {
                    events.push({
                        start: r.start,
                        end: s.end,
                        minutes: r.minutes + s.minutes,
                        is_split: true,
                    });
                    consumed.add(i);
                    consumed.add(j);
                    break;
                }
            }
        }
    }
    return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}
function evalDaily(ctx, rule) {
    const logic = readDailyRestLogic(rule);
    if (!logic) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "rule.logic missing daily-rest parameters",
            missing_fields: [
                "rule.logic.regular_daily_rest_minutes",
                "rule.logic.reduced_daily_rest_minutes",
            ],
        };
    }
    const rests = findRestRuns(ctx.timeline.activities);
    const events = findDailyRestEvents(rests, logic);
    // First non-rest activity = start of the very first shift.
    const firstWork = ctx.timeline.activities.find((a) => a.kind === "WORK" || a.kind === "DRIVING" || a.kind === "AVAILABILITY");
    if (!firstWork) {
        return { status: "compliant", rule_id: rule.rule_id };
    }
    // We anchor "shift starts" on the END of each daily-rest event (next shift
    // begins right after the rest ends). The very first shift starts at the
    // first work activity. Any short ("rest attempt", >=180 min but below the
    // reduced threshold AND not part of a valid split) becomes an attempted
    // daily rest that is too short → violation.
    const ATTEMPT_THRESHOLD = logic.split_first_min_minutes;
    const failedAttempts = rests.filter((r) => r.minutes >= ATTEMPT_THRESHOLD &&
        r.minutes < logic.reduced_daily_rest_minutes &&
        !events.some((e) => e.start <= r.start && e.end >= r.end));
    let reductionBudget = logic.reduced_allowed_between_weekly_rests;
    const violations = [];
    // Failed attempt = driver took a 3..9h rest that wasn't part of a valid
    // split. That means they intended a daily rest but it was too short.
    for (const attempt of failedAttempts) {
        violations.push(buildViolation({
            rule,
            fines: ctx.fines,
            driver_id: ctx.timeline.driver_id,
            start_time: attempt.start,
            end_time: attempt.end,
            measured_value: attempt.minutes,
            allowed_value: logic.reduced_daily_rest_minutes,
            excess_value: logic.reduced_daily_rest_minutes - attempt.minutes,
            unit: "minutes",
            source_activity_ids: [],
            confidence: 1,
            rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
        }));
    }
    // Reduced rest budget: every daily rest < regular consumes one slot.
    for (const e of events) {
        if (e.minutes >= logic.regular_daily_rest_minutes)
            continue;
        if (reductionBudget > 0) {
            reductionBudget -= 1;
            continue;
        }
        violations.push(buildViolation({
            rule,
            fines: ctx.fines,
            driver_id: ctx.timeline.driver_id,
            start_time: e.start,
            end_time: e.end,
            measured_value: e.minutes,
            allowed_value: logic.regular_daily_rest_minutes,
            excess_value: logic.regular_daily_rest_minutes - e.minutes,
            unit: "minutes",
            source_activity_ids: [],
            confidence: 1,
            rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
        }));
    }
    return violations.length === 0
        ? { status: "compliant", rule_id: rule.rule_id }
        : { status: "evaluated", rule_id: rule.rule_id, violations };
}
function evalWeekly(ctx, rule) {
    const logic = readWeeklyRestLogic(rule);
    if (!logic) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "rule.logic missing weekly-rest parameters",
            missing_fields: [
                "rule.logic.regular_weekly_rest_minutes",
                "rule.logic.reduced_weekly_rest_minutes",
            ],
        };
    }
    // EU 561 Art. 8(6): a new weekly rest period must begin no later than the
    // end of six consecutive 24-hour periods after the END of the previous
    // weekly rest period. Reduced weekly rest must start within the same 6×24h
    // window; the resulting rest must itself be at least `reduced_weekly`.
    //
    // Algorithm:
    //   1. Find candidate weekly rests (REST runs >= reduced_weekly_rest_minutes).
    //   2. Walk them in order. For each pair (prev, next) check that
    //      `next.start <= prev.end + 6*24h`. Otherwise emit a violation
    //      starting at `prev.end + 6*24h` and ending at `next.start`.
    //   3. For the open tail (after the last weekly rest): if more than 6×24h
    //      elapsed before the timeline range ends, emit a violation —
    //      otherwise abstain (open shift, may still be in compliance).
    const SIX_DAYS_MS = 6 * 24 * 3600 * 1000;
    const rests = findRestRuns(ctx.timeline.activities)
        .filter((r) => r.minutes >= logic.reduced_weekly_rest_minutes)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    const range = ctx.timeline.range;
    const violations = [];
    // 1. If no weekly rest at all and range > 6×24h: violation for the entire span.
    if (rests.length === 0) {
        if (range.end.getTime() - range.start.getTime() > SIX_DAYS_MS) {
            violations.push(buildViolation({
                rule,
                fines: ctx.fines,
                driver_id: ctx.timeline.driver_id,
                start_time: range.start,
                end_time: range.end,
                measured_value: 0,
                allowed_value: logic.reduced_weekly_rest_minutes,
                excess_value: logic.reduced_weekly_rest_minutes,
                unit: "minutes",
                source_activity_ids: [],
                confidence: 0.9,
                rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
            }));
        }
        return violations.length === 0
            ? { status: "compliant", rule_id: rule.rule_id }
            : { status: "evaluated", rule_id: rule.rule_id, violations };
    }
    // 2. Gap before the first weekly rest.
    const first = rests[0];
    if (first.start.getTime() - range.start.getTime() > SIX_DAYS_MS) {
        violations.push(buildViolation({
            rule,
            fines: ctx.fines,
            driver_id: ctx.timeline.driver_id,
            start_time: range.start,
            end_time: first.start,
            measured_value: 0,
            allowed_value: logic.reduced_weekly_rest_minutes,
            excess_value: logic.reduced_weekly_rest_minutes,
            unit: "minutes",
            source_activity_ids: [],
            confidence: 0.9,
            rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
        }));
    }
    // 3. Gaps between consecutive weekly rests.
    for (let i = 0; i < rests.length - 1; i++) {
        const prev = rests[i];
        const next = rests[i + 1];
        const deadline = prev.end.getTime() + SIX_DAYS_MS;
        if (next.start.getTime() > deadline) {
            violations.push(buildViolation({
                rule,
                fines: ctx.fines,
                driver_id: ctx.timeline.driver_id,
                start_time: new Date(deadline),
                end_time: next.start,
                measured_value: 0,
                allowed_value: logic.reduced_weekly_rest_minutes,
                excess_value: logic.reduced_weekly_rest_minutes,
                unit: "minutes",
                source_activity_ids: [],
                confidence: 1,
                rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
            }));
        }
    }
    // 4. Open tail. If the range continues more than 6×24h past the last
    //    weekly rest end, the next weekly rest is overdue.
    const last = rests[rests.length - 1];
    const tailDeadline = last.end.getTime() + SIX_DAYS_MS;
    if (range.end.getTime() > tailDeadline) {
        violations.push(buildViolation({
            rule,
            fines: ctx.fines,
            driver_id: ctx.timeline.driver_id,
            start_time: new Date(tailDeadline),
            end_time: range.end,
            measured_value: 0,
            allowed_value: logic.reduced_weekly_rest_minutes,
            excess_value: logic.reduced_weekly_rest_minutes,
            unit: "minutes",
            source_activity_ids: [],
            confidence: 0.9,
            rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
        }));
    }
    return violations.length === 0
        ? { status: "compliant", rule_id: rule.rule_id }
        : { status: "evaluated", rule_id: rule.rule_id, violations };
}
//# sourceMappingURL=rest.js.map
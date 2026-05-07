import { buildViolation, ruleSetVersionFor } from "./base.js";
import { buildDriverDays, buildDriverWeeks } from "../calculations/weekly.js";
import { tzOffsetMinutes } from "../calculations/time-zones.js";
const RULE_WEEKLY = "DE_KRFARBZG_WEEKLY_WORKING_TIME";
const RULE_BREAKS = "DE_KRFARBZG_BREAKS";
const RULE_DAILY = "DE_KRFARBZG_DAILY_WORKING_TIME";
const RULE_NIGHT = "DE_KRFARBZG_NIGHT_WORK";
function readWeekly(rule) {
    const l = rule.logic;
    if (!l ||
        typeof l.average_limit_hours !== "number" ||
        typeof l.maximum_limit_hours !== "number") {
        return null;
    }
    return {
        average_limit_hours: l.average_limit_hours,
        maximum_limit_hours: l.maximum_limit_hours,
        averaging_period_weeks: l.averaging_period_weeks ?? 16,
    };
}
function readBreaks(rule) {
    const l = rule.logic;
    if (!l ||
        typeof l.break_after_6h_minutes !== "number" ||
        typeof l.break_after_9h_minutes !== "number") {
        return null;
    }
    return {
        break_after_6h_minutes: l.break_after_6h_minutes,
        break_after_9h_minutes: l.break_after_9h_minutes,
        minimum_split_minutes: l.minimum_split_minutes ?? 15,
    };
}
function readDaily(rule) {
    const l = rule.logic;
    return l && typeof l.max_daily_minutes === "number"
        ? { max_daily_minutes: l.max_daily_minutes }
        : null;
}
function readNight(rule) {
    const l = rule.logic;
    if (!l ||
        typeof l.night_window_start_hour !== "number" ||
        typeof l.night_window_end_hour !== "number" ||
        typeof l.max_minutes_on_night_day !== "number") {
        return null;
    }
    return l;
}
/**
 * KrFArbZG (Arbeitszeit für Kraftfahrer) evaluators.
 *
 * Working time = WORK + DRIVING (AVAILABILITY does NOT count, REST/UNKNOWN
 * never count). Daily and weekly limits apply to that sum.
 *
 * Break rule (§ 5):
 *   - >6h working time → 30 min break required
 *   - >9h working time → 45 min break required
 *   Splits are allowed in chunks of >= minimum_split_minutes (default 15).
 */
export const workingTimeEvaluator = {
    rule_ids: [RULE_WEEKLY, RULE_BREAKS, RULE_DAILY, RULE_NIGHT],
    evaluate(ctx) {
        const days = buildDriverDays(ctx.timeline.activities, ctx.time_zone);
        const weeks = buildDriverWeeks(days, ctx.time_zone);
        const out = [];
        const rWeekly = ctx.rules.by_id.get(RULE_WEEKLY);
        const rBreaks = ctx.rules.by_id.get(RULE_BREAKS);
        const rDaily = ctx.rules.by_id.get(RULE_DAILY);
        const rNight = ctx.rules.by_id.get(RULE_NIGHT);
        if (rWeekly)
            out.push(evalWeekly(ctx, rWeekly, weeks));
        if (rBreaks)
            out.push(evalBreaks(ctx, rBreaks, days));
        if (rDaily)
            out.push(evalDaily(ctx, rDaily, days));
        if (rNight)
            out.push(evalNight(ctx, rNight, days));
        return out;
    },
};
function evalWeekly(ctx, rule, weeks) {
    const logic = readWeekly(rule);
    if (!logic) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "rule.logic missing average_limit_hours / maximum_limit_hours",
            missing_fields: [
                "rule.logic.average_limit_hours",
                "rule.logic.maximum_limit_hours",
            ],
        };
    }
    const maxMinutes = logic.maximum_limit_hours * 60;
    const violations = weeks
        .filter((w) => w.total_working_minutes > maxMinutes)
        .map((w) => buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: w.window.start,
        end_time: w.window.end,
        measured_value: w.total_working_minutes,
        allowed_value: maxMinutes,
        excess_value: w.total_working_minutes - maxMinutes,
        unit: "minutes",
        source_activity_ids: [],
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
    }));
    return violations.length === 0
        ? { status: "compliant", rule_id: rule.rule_id }
        : { status: "evaluated", rule_id: rule.rule_id, violations };
}
function evalBreaks(ctx, rule, days) {
    const logic = readBreaks(rule);
    if (!logic) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "rule.logic missing break parameters",
            missing_fields: ["rule.logic.break_after_6h_minutes"],
        };
    }
    const violations = [];
    for (const day of days) {
        const work = day.driving_minutes + day.working_minutes;
        if (work <= 360)
            continue;
        const required = work > 540 ? logic.break_after_9h_minutes : logic.break_after_6h_minutes;
        // Compute total qualifying break minutes (REST runs >= minimum_split_minutes).
        let qualifying = 0;
        let runMinutes = 0;
        const flush = () => {
            if (runMinutes >= logic.minimum_split_minutes)
                qualifying += runMinutes;
            runMinutes = 0;
        };
        for (const a of day.activities) {
            const isBreak = a.kind === "REST" || a.kind === "AVAILABILITY";
            if (isBreak) {
                runMinutes += Math.round((a.end.getTime() - a.start.getTime()) / 60_000);
            }
            else {
                flush();
            }
        }
        flush();
        if (qualifying >= required)
            continue;
        violations.push(buildViolation({
            rule,
            fines: ctx.fines,
            driver_id: ctx.timeline.driver_id,
            start_time: day.driver_day_window.start,
            end_time: day.driver_day_window.end,
            measured_value: qualifying,
            allowed_value: required,
            excess_value: required - qualifying,
            unit: "minutes",
            source_activity_ids: day.activities
                .filter((a) => a.kind === "WORK" || a.kind === "DRIVING")
                .map((a) => a.id),
            confidence: 1,
            rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
        }));
    }
    return violations.length === 0
        ? { status: "compliant", rule_id: rule.rule_id }
        : { status: "evaluated", rule_id: rule.rule_id, violations };
}
function evalDaily(ctx, rule, days) {
    const logic = readDaily(rule);
    if (!logic) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "rule.logic missing max_daily_minutes",
            missing_fields: ["rule.logic.max_daily_minutes"],
        };
    }
    const violations = [];
    for (const day of days) {
        const work = day.driving_minutes + day.working_minutes;
        if (work <= logic.max_daily_minutes)
            continue;
        violations.push(buildViolation({
            rule,
            fines: ctx.fines,
            driver_id: ctx.timeline.driver_id,
            start_time: day.driver_day_window.start,
            end_time: day.driver_day_window.end,
            measured_value: work,
            allowed_value: logic.max_daily_minutes,
            excess_value: work - logic.max_daily_minutes,
            unit: "minutes",
            source_activity_ids: day.activities
                .filter((a) => a.kind === "WORK" || a.kind === "DRIVING")
                .map((a) => a.id),
            confidence: 1,
            rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
        }));
    }
    return violations.length === 0
        ? { status: "compliant", rule_id: rule.rule_id }
        : { status: "evaluated", rule_id: rule.rule_id, violations };
}
function evalNight(ctx, rule, days) {
    const logic = readNight(rule);
    if (!logic) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "rule.logic missing night-work parameters",
            missing_fields: ["rule.logic.night_window_start_hour"],
        };
    }
    const violations = [];
    for (const day of days) {
        const isNight = day.activities.some((a) => activityIntersectsNightWindow(a, ctx.time_zone, logic));
        if (!isNight)
            continue;
        const work = day.driving_minutes + day.working_minutes;
        if (work <= logic.max_minutes_on_night_day)
            continue;
        violations.push(buildViolation({
            rule,
            fines: ctx.fines,
            driver_id: ctx.timeline.driver_id,
            start_time: day.driver_day_window.start,
            end_time: day.driver_day_window.end,
            measured_value: work,
            allowed_value: logic.max_minutes_on_night_day,
            excess_value: work - logic.max_minutes_on_night_day,
            unit: "minutes",
            source_activity_ids: day.activities
                .filter((a) => a.kind === "WORK" || a.kind === "DRIVING")
                .map((a) => a.id),
            confidence: 1,
            rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
        }));
    }
    return violations.length === 0
        ? { status: "compliant", rule_id: rule.rule_id }
        : { status: "evaluated", rule_id: rule.rule_id, violations };
}
function activityIntersectsNightWindow(a, time_zone, logic) {
    if (a.kind !== "WORK" && a.kind !== "DRIVING")
        return false;
    const offset = tzOffsetMinutes(a.start, time_zone);
    const localStartMs = a.start.getTime() + offset * 60_000;
    const localEndMs = a.end.getTime() + offset * 60_000;
    // Walk the activity in 1h steps and check if any falls into the night window.
    for (let t = localStartMs; t < localEndMs; t += 60 * 60 * 1000) {
        const hour = Math.floor((t / (3600 * 1000)) % 24);
        if (hour >= logic.night_window_start_hour &&
            hour < logic.night_window_end_hour) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=working-time.js.map
import { buildViolation, ruleSetVersionFor } from "./base.js";
import { buildDriverDays, buildDriverWeeks, rollingTwoWeekDriving, } from "../calculations/weekly.js";
const RULE_DAILY = "EU_561_ART6_DAILY_DRIVING";
const RULE_WEEKLY = "EU_561_ART6_WEEKLY_DRIVING";
const RULE_TWO_WEEK = "EU_561_ART6_TWO_WEEK_DRIVING";
function readDailyLogic(rule) {
    const l = rule.logic;
    if (!l || typeof l.normal_limit_minutes !== "number")
        return null;
    return {
        normal_limit_minutes: l.normal_limit_minutes,
        extended_limit_minutes: l.extended_limit_minutes ?? l.normal_limit_minutes,
        allowed_extensions_per_week: l.allowed_extensions_per_week ?? 0,
    };
}
function readWeeklyLogic(rule) {
    const l = rule.logic;
    return l && typeof l.weekly_limit_minutes === "number"
        ? { weekly_limit_minutes: l.weekly_limit_minutes }
        : null;
}
function readTwoWeekLogic(rule) {
    const l = rule.logic;
    return l && typeof l.two_week_limit_minutes === "number"
        ? { two_week_limit_minutes: l.two_week_limit_minutes }
        : null;
}
/**
 * EU 561 Art. 6:
 *  - Daily limit 9h, may be extended to 10h max twice per week.
 *  - Weekly limit 56h.
 *  - Two-consecutive-week limit 90h.
 *
 * The day limit is decided per day with this policy: a day's driving over
 * `normal_limit_minutes` is allowed only on up to `allowed_extensions_per_week`
 * days within the same ISO week, and never above `extended_limit_minutes`.
 *
 * If the YAML logic block is missing required parameters we return
 * `not_evaluable` rather than guessing — the spec is non-negotiable.
 */
export const drivingTimeEvaluator = {
    rule_ids: [RULE_DAILY, RULE_WEEKLY, RULE_TWO_WEEK],
    evaluate(ctx) {
        const days = buildDriverDays(ctx.timeline.activities, ctx.time_zone);
        const weeks = buildDriverWeeks(days, ctx.time_zone);
        const out = [];
        const ruleDaily = ctx.rules.by_id.get(RULE_DAILY);
        const ruleWeekly = ctx.rules.by_id.get(RULE_WEEKLY);
        const ruleTwoWeek = ctx.rules.by_id.get(RULE_TWO_WEEK);
        if (ruleDaily)
            out.push(evalDaily(ctx, ruleDaily, days, weeks));
        if (ruleWeekly)
            out.push(evalWeekly(ctx, ruleWeekly, weeks));
        if (ruleTwoWeek)
            out.push(evalTwoWeek(ctx, ruleTwoWeek, weeks));
        return out;
    },
};
function evalDaily(ctx, rule, days, weeks) {
    const logic = readDailyLogic(rule);
    if (!logic) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "rule.logic missing required keys (normal_limit_minutes)",
            missing_fields: ["rule.logic.normal_limit_minutes"],
        };
    }
    if (days.length === 0)
        return { status: "compliant", rule_id: rule.rule_id };
    // Track how many extensions each ISO week has already "used".
    const extensionsByWeek = new Map();
    for (const w of weeks)
        extensionsByWeek.set(weekKey(w.iso_year, w.iso_week), 0);
    // Sort days chronologically to make the "first n extensions" rule stable.
    const sorted = [...days].sort((a, b) => a.local_date.localeCompare(b.local_date));
    const violations = [];
    for (const day of sorted) {
        if (day.driving_minutes <= logic.normal_limit_minutes)
            continue;
        const wk = isoWeekFor(day);
        const usedExt = extensionsByWeek.get(wk.key) ?? 0;
        const canExtend = usedExt < logic.allowed_extensions_per_week;
        const effectiveLimit = canExtend
            ? logic.extended_limit_minutes
            : logic.normal_limit_minutes;
        if (canExtend && day.driving_minutes <= effectiveLimit) {
            // Legitimate use of an extension day — burn the budget, no violation.
            extensionsByWeek.set(wk.key, usedExt + 1);
            continue;
        }
        // Either the extension budget was already exhausted or the day exceeded
        // even the extended limit. Either way: violation.
        violations.push(buildViolation({
            rule,
            fines: ctx.fines,
            driver_id: ctx.timeline.driver_id,
            start_time: day.driver_day_window.start,
            end_time: day.driver_day_window.end,
            measured_value: day.driving_minutes,
            allowed_value: effectiveLimit,
            excess_value: day.driving_minutes - effectiveLimit,
            unit: "minutes",
            source_activity_ids: day.activities
                .filter((a) => a.kind === "DRIVING")
                .map((a) => a.id),
            confidence: 1,
            rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
        }));
        if (canExtend) {
            // Day exceeded extended limit — still consumes one extension slot.
            extensionsByWeek.set(wk.key, usedExt + 1);
        }
    }
    return violations.length === 0
        ? { status: "compliant", rule_id: rule.rule_id }
        : { status: "evaluated", rule_id: rule.rule_id, violations };
}
function evalWeekly(ctx, rule, weeks) {
    const logic = readWeeklyLogic(rule);
    if (!logic) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "rule.logic missing weekly_limit_minutes",
            missing_fields: ["rule.logic.weekly_limit_minutes"],
        };
    }
    const violations = weeks
        .filter((w) => w.total_driving_minutes > logic.weekly_limit_minutes)
        .map((w) => buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: w.window.start,
        end_time: w.window.end,
        measured_value: w.total_driving_minutes,
        allowed_value: logic.weekly_limit_minutes,
        excess_value: w.total_driving_minutes - logic.weekly_limit_minutes,
        unit: "minutes",
        source_activity_ids: w.days.flatMap((d) => d.activities.filter((a) => a.kind === "DRIVING").map((a) => a.id)),
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
    }));
    return violations.length === 0
        ? { status: "compliant", rule_id: rule.rule_id }
        : { status: "evaluated", rule_id: rule.rule_id, violations };
}
function evalTwoWeek(ctx, rule, weeks) {
    const logic = readTwoWeekLogic(rule);
    if (!logic) {
        return {
            status: "not_evaluable",
            rule_id: rule.rule_id,
            reason: "rule.logic missing two_week_limit_minutes",
            missing_fields: ["rule.logic.two_week_limit_minutes"],
        };
    }
    const totals = rollingTwoWeekDriving(weeks);
    const violations = totals
        .map((t, i) => ({ t, week: weeks[i] }))
        .filter(({ t }) => t.minutes > logic.two_week_limit_minutes)
        .filter(({ week }) => week !== undefined)
        .map(({ t, week }) => buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: week.window.start,
        end_time: week.window.end,
        measured_value: t.minutes,
        allowed_value: logic.two_week_limit_minutes,
        excess_value: t.minutes - logic.two_week_limit_minutes,
        unit: "minutes",
        source_activity_ids: [],
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
    }));
    return violations.length === 0
        ? { status: "compliant", rule_id: rule.rule_id }
        : { status: "evaluated", rule_id: rule.rule_id, violations };
}
function isoWeekFor(day) {
    const [y, m, d] = day.local_date.split("-").map((s) => Number(s));
    if (y === undefined || m === undefined || d === undefined) {
        throw new Error(`bad local_date: ${day.local_date}`);
    }
    const date = new Date(Date.UTC(y, m - 1, d));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return {
        iso_year: date.getUTCFullYear(),
        iso_week: week,
        key: weekKey(date.getUTCFullYear(), week),
    };
}
function weekKey(year, week) {
    return `${year}-W${String(week).padStart(2, "0")}`;
}
//# sourceMappingURL=driving-time.js.map
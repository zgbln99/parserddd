import type { Evaluator, EvaluatorContext } from "./base.js";
import { buildViolation, ruleSetVersionFor } from "./base.js";
import type { RuleEvaluation } from "../types/violation.js";
import type { Rule } from "../types/rule.js";
import { findRestRuns } from "../calculations/rest-windows.js";
import { MS_PER_MINUTE } from "../calculations/time.js";

const RULE_DAILY = "EU_561_ART8_DAILY_REST";
const RULE_WEEKLY = "EU_561_ART8_WEEKLY_REST";

interface DailyRestLogic {
  regular_daily_rest_minutes: number;
  reduced_daily_rest_minutes: number;
  reduced_allowed_between_weekly_rests: number;
  window_minutes: number;
}
interface WeeklyRestLogic {
  regular_weekly_rest_minutes: number;
  reduced_weekly_rest_minutes: number;
}

function readDailyRestLogic(rule: Rule): DailyRestLogic | null {
  const l = rule.logic as Partial<DailyRestLogic> | undefined;
  if (
    !l ||
    typeof l.regular_daily_rest_minutes !== "number" ||
    typeof l.reduced_daily_rest_minutes !== "number"
  ) {
    return null;
  }
  return {
    regular_daily_rest_minutes: l.regular_daily_rest_minutes,
    reduced_daily_rest_minutes: l.reduced_daily_rest_minutes,
    reduced_allowed_between_weekly_rests: l.reduced_allowed_between_weekly_rests ?? 3,
    window_minutes: l.window_minutes ?? 1440,
  };
}

function readWeeklyRestLogic(rule: Rule): WeeklyRestLogic | null {
  const l = rule.logic as Partial<WeeklyRestLogic> | undefined;
  if (
    !l ||
    typeof l.regular_weekly_rest_minutes !== "number" ||
    typeof l.reduced_weekly_rest_minutes !== "number"
  ) {
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
 * Note: we do NOT yet differentiate split daily rest (3+9). Adding that is
 * a logic-only extension to this same evaluator.
 */
export const restEvaluator: Evaluator = {
  rule_ids: [RULE_DAILY, RULE_WEEKLY],

  evaluate(ctx: EvaluatorContext): readonly RuleEvaluation[] {
    const out: RuleEvaluation[] = [];
    const rDaily = ctx.rules.by_id.get(RULE_DAILY);
    const rWeekly = ctx.rules.by_id.get(RULE_WEEKLY);

    if (rDaily) out.push(evalDaily(ctx, rDaily));
    if (rWeekly) out.push(evalWeekly(ctx, rWeekly));
    return out;
  },
};

function evalDaily(ctx: EvaluatorContext, rule: Rule): RuleEvaluation {
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

  // Identify "shift starts" as the start of each non-rest activity that
  // immediately follows a "rest attempt" (any continuous rest >= 3 hours —
  // shorter rests are in-shift breaks, not daily-rest candidates).
  const SHIFT_REST_THRESHOLD_MINUTES = 180;
  const shiftStarts: Date[] = [];
  let lastRest: { end: Date; minutes: number } | null = null;
  for (const a of ctx.timeline.activities) {
    const isRest = a.kind === "REST" || (a.ferry_train && a.kind !== "DRIVING");
    if (isRest) {
      const minutes = Math.round((a.end.getTime() - a.start.getTime()) / MS_PER_MINUTE);
      if (lastRest && lastRest.end.getTime() === a.start.getTime()) {
        lastRest = { end: a.end, minutes: lastRest.minutes + minutes };
      } else {
        lastRest = { end: a.end, minutes };
      }
      continue;
    }
    if (a.kind === "UNKNOWN") continue; // gaps are not shift starts
    if (lastRest && lastRest.minutes >= SHIFT_REST_THRESHOLD_MINUTES) {
      shiftStarts.push(a.start);
    } else if (shiftStarts.length === 0) {
      shiftStarts.push(a.start);
    }
    lastRest = null;
  }

  // For each pair of consecutive shifts the rest between them is the daily
  // rest period that closes the earlier shift. The last shift in the
  // timeline may still be open (no rest visible yet) — in that case we
  // abstain rather than fabricating a violation.
  let reductionBudget = logic.reduced_allowed_between_weekly_rests;
  const violations = [] as ReturnType<typeof buildViolation>[];

  for (let i = 0; i < shiftStarts.length - 1; i++) {
    const start = shiftStarts[i] as Date;
    const nextStart = shiftStarts[i + 1] as Date;

    const restBetween = rests.find(
      (r) => r.start >= start && r.end <= nextStart && r.minutes >= logic.reduced_daily_rest_minutes,
    );
    const measured = restBetween?.minutes ?? bestRestInWindow(rests, start, nextStart);

    if (measured >= logic.regular_daily_rest_minutes) continue;

    if (
      measured >= logic.reduced_daily_rest_minutes &&
      reductionBudget > 0
    ) {
      reductionBudget -= 1;
      continue;
    }

    const windowEnd = nextStart;
    violations.push(
      buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: start,
        end_time: windowEnd,
        measured_value: measured,
        allowed_value: logic.reduced_daily_rest_minutes,
        excess_value: logic.reduced_daily_rest_minutes - measured,
        unit: "minutes",
        source_activity_ids: [],
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
      }),
    );
  }

  return violations.length === 0
    ? { status: "compliant", rule_id: rule.rule_id }
    : { status: "evaluated", rule_id: rule.rule_id, violations };
}

function bestRestInWindow(
  rests: readonly { start: Date; end: Date; minutes: number }[],
  start: Date,
  end: Date,
): number {
  let best = 0;
  for (const r of rests) {
    if (r.end <= start || r.start >= end) continue;
    if (r.minutes > best) best = r.minutes;
  }
  return best;
}

function evalWeekly(ctx: EvaluatorContext, rule: Rule): RuleEvaluation {
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
  // EU 561 Art. 8(6): a weekly rest must start no later than the end of six
  // 24-hour periods after the previous weekly rest. We approximate by
  // finding all rests >= reduced_weekly_rest_minutes; if any 7-day window
  // contains none, that's a violation.
  const rests = findRestRuns(ctx.timeline.activities).filter(
    (r) => r.minutes >= logic.reduced_weekly_rest_minutes,
  );
  const range = ctx.timeline.range;
  const violations = [] as ReturnType<typeof buildViolation>[];

  // Walk the range in 7-day buckets.
  const bucketMs = 7 * 24 * 3600 * 1000;
  let cursor = range.start.getTime();
  while (cursor < range.end.getTime()) {
    const bucketEnd = Math.min(cursor + bucketMs, range.end.getTime());
    const found = rests.find(
      (r) => r.end.getTime() > cursor && r.start.getTime() < bucketEnd,
    );
    if (!found) {
      violations.push(
        buildViolation({
          rule,
          fines: ctx.fines,
          driver_id: ctx.timeline.driver_id,
          start_time: new Date(cursor),
          end_time: new Date(bucketEnd),
          measured_value: 0,
          allowed_value: logic.reduced_weekly_rest_minutes,
          excess_value: logic.reduced_weekly_rest_minutes,
          unit: "minutes",
          source_activity_ids: [],
          confidence: 0.7, // approximation: 7-day rolling vs 6 driving days
          rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
        }),
      );
    }
    cursor += bucketMs;
  }
  return violations.length === 0
    ? { status: "compliant", rule_id: rule.rule_id }
    : { status: "evaluated", rule_id: rule.rule_id, violations };
}

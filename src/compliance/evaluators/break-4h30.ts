import type { Evaluator, EvaluatorContext } from "./base.js";
import { buildViolation, ruleSetVersionFor } from "./base.js";
import type { RuleEvaluation } from "../types/violation.js";
import {
  maxContinuousDrivingMinutes,
  splitDrivingSegments,
  type ContinuousDrivingOptions,
} from "../calculations/continuous-driving.js";
import type { Rule } from "../types/rule.js";

const RULE_ID = "EU_561_ART7_BREAK_AFTER_4H30";

interface BreakLogic extends ContinuousDrivingOptions {
  required_break_minutes: number;
}

function readLogic(rule: Rule): BreakLogic | null {
  const l = rule.logic as
    | {
        max_continuous_driving_minutes?: number;
        required_break_minutes?: number;
        split_pattern?: number[];
      }
    | undefined;
  if (
    !l ||
    typeof l.max_continuous_driving_minutes !== "number" ||
    typeof l.required_break_minutes !== "number"
  ) {
    return null;
  }
  return {
    min_break_minutes: l.required_break_minutes,
    required_break_minutes: l.required_break_minutes,
    split_pattern: l.split_pattern,
  };
}

/**
 * EU 561 Art. 7: after at most 4h30 of cumulative driving without a
 * qualifying break, a 45-minute break (or 15 + 30 split) must occur.
 *
 * The continuous-driving helper returns segments separated by qualifying
 * breaks; if `maxContinuousDrivingMinutes(seg)` exceeds the threshold, we
 * emit one violation per offending segment.
 */
export const breakAfter4h30Evaluator: Evaluator = {
  rule_ids: [RULE_ID],

  evaluate(ctx: EvaluatorContext): readonly RuleEvaluation[] {
    const rule = ctx.rules.by_id.get(RULE_ID);
    if (!rule) return [];

    const logic = readLogic(rule);
    if (!logic) {
      return [
        {
          status: "not_evaluable",
          rule_id: RULE_ID,
          reason: "rule.logic missing break parameters",
          missing_fields: [
            "rule.logic.max_continuous_driving_minutes",
            "rule.logic.required_break_minutes",
          ],
        },
      ];
    }
    const threshold = (rule.logic as { max_continuous_driving_minutes: number })
      .max_continuous_driving_minutes;
    const segments = splitDrivingSegments(ctx.timeline.activities, logic);
    const offenders = segments.filter(
      (s) => maxContinuousDrivingMinutes(s) > threshold,
    );

    if (offenders.length === 0) {
      return [{ status: "compliant", rule_id: RULE_ID }];
    }

    const violations = offenders.map((seg) => {
      const measured = maxContinuousDrivingMinutes(seg);
      return buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: seg.start,
        end_time: seg.end,
        measured_value: measured,
        allowed_value: threshold,
        excess_value: measured - threshold,
        unit: "minutes",
        source_activity_ids: seg.activities
          .filter((a) => a.kind === "DRIVING")
          .map((a) => a.id),
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, RULE_ID),
      });
    });
    return [{ status: "evaluated", rule_id: RULE_ID, violations }];
  },
};

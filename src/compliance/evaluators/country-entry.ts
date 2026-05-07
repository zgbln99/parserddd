import type { RuleEvaluation } from "../types/violation.js";
import type { Evaluator, EvaluatorContext } from "./base.js";
import {
  buildViolation,
  ruleSetVersionFor,
} from "./base.js";

/**
 * EU 165/2014 Art. 34(7) + EU 561/2006 Art. 34: country must be entered at
 * the start and end of every working day.
 *
 * In practice, the obligation manifests in two distinct violations:
 *  - rule_id `EU_165_MISSING_START_COUNTRY` — country missing at card insertion
 *  - rule_id `EU_165_MISSING_END_COUNTRY`   — country missing at card withdrawal
 *
 * If neither rule is present in the loaded rule set we silently skip; the
 * engine never invents legal interpretations.
 */
const RULE_START = "EU_165_MISSING_START_COUNTRY";
const RULE_END = "EU_165_MISSING_END_COUNTRY";

export const countryEntryEvaluator: Evaluator = {
  rule_ids: [RULE_START, RULE_END],

  evaluate(ctx: EvaluatorContext): readonly RuleEvaluation[] {
    const out: RuleEvaluation[] = [];
    const rule_start = ctx.rules.by_id.get(RULE_START);
    const rule_end = ctx.rules.by_id.get(RULE_END);

    if (rule_start) {
      out.push(checkCountry(ctx, rule_start.rule_id, "start"));
    }
    if (rule_end) {
      out.push(checkCountry(ctx, rule_end.rule_id, "end"));
    }
    return out;
  },
};

function checkCountry(
  ctx: EvaluatorContext,
  rule_id: string,
  side: "start" | "end",
): RuleEvaluation {
  const rule = ctx.rules.by_id.get(rule_id);
  if (!rule) {
    return { status: "not_evaluable", rule_id, reason: "rule not loaded", missing_fields: [] };
  }

  // Required input: card sessions. If we have none, we cannot tell whether
  // start/end country was missing — return not_evaluable per spec.
  if (ctx.timeline.card_sessions.length === 0) {
    return {
      status: "not_evaluable",
      rule_id,
      reason: "no card sessions on timeline; cannot evaluate country entry",
      missing_fields: ["timeline.card_sessions"],
    };
  }

  const violations = ctx.timeline.card_sessions
    .filter((s) => (side === "start" ? s.start_country == null : s.end_country == null))
    .map((s) =>
      buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: side === "start" ? s.start : s.end,
        end_time: side === "start" ? s.start : s.end,
        measured_value: 0,
        allowed_value: 1,
        excess_value: 1,
        unit: "count",
        source_activity_ids: [],
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, rule.rule_id),
      }),
    );

  if (violations.length === 0) {
    return { status: "compliant", rule_id };
  }
  return { status: "evaluated", rule_id, violations };
}

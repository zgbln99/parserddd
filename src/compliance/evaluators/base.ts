import { createHash } from "node:crypto";
import type { Timeline } from "../types/timeline.js";
import type {
  FineIndex,
  Rule,
  RuleIndex,
} from "../types/rule.js";
import type {
  EvaluationResult,
  RuleEvaluation,
  Violation,
  ViolationStatus,
  ViolationUnit,
} from "../types/violation.js";
import type { ActivityId, MultilingualText } from "../types/common.js";
import { asViolationId } from "../types/common.js";

/** Static engine version. Bump on any output-shape or logic change. */
export const ENGINE_VERSION = "0.1.0";

export interface EvaluatorContext {
  readonly timeline: Timeline;
  readonly rules: RuleIndex;
  readonly fines: FineIndex;
  readonly evaluated_at: Date;
  /** IANA tz used for local-day grouping. */
  readonly time_zone: string;
}

/**
 * An evaluator owns one or more rule_ids and decides what violations they
 * produce. Evaluators are PURE — they must read only from `ctx` and return
 * a `RuleEvaluation` per rule they handle.
 *
 * If required data is missing on the timeline, the evaluator MUST return
 * `not_evaluable` rather than `compliant`. Defaulting to compliant on
 * missing data is a SPEC VIOLATION.
 */
export interface Evaluator {
  /** rule_ids this evaluator owns. */
  readonly rule_ids: readonly string[];
  evaluate(ctx: EvaluatorContext): readonly RuleEvaluation[];
}

/** Build a Violation with stable defaults — every evaluator should use this. */
export function buildViolation(args: {
  rule: Rule;
  fines: FineIndex;
  driver_id: Timeline["driver_id"];
  start_time: Date;
  end_time: Date;
  measured_value: number | null;
  allowed_value: number | null;
  excess_value: number | null;
  unit: ViolationUnit;
  source_activity_ids: readonly ActivityId[];
  confidence: number;
  status?: ViolationStatus;
  rule_set_version: string;
  explanation_override?: MultilingualText;
}): Violation {
  const fine = args.fines.by_rule_id.get(args.rule.rule_id);
  const driver_amount = fine?.driver?.amount_eur ?? null;
  const company_amount = fine?.company?.amount_eur ?? null;

  const explanation =
    args.explanation_override ??
    args.rule.explanation ?? {
      de: args.rule.title.de,
      en: args.rule.title.en,
      pl: args.rule.title.pl,
    };

  const seed = [
    args.rule.rule_id,
    args.driver_id,
    args.start_time.toISOString(),
    args.end_time.toISOString(),
    args.measured_value ?? "",
  ].join("|");
  const id = asViolationId(
    "v_" + createHash("sha256").update(seed).digest("hex").slice(0, 16),
  );

  return {
    violation_id: id,
    driver_id: args.driver_id,
    rule_id: args.rule.rule_id,
    category: args.rule.category,
    severity: args.rule.severity ?? null,
    legal_basis: args.rule.legal_basis,
    title: args.rule.title,
    explanation,
    start_time: args.start_time,
    end_time: args.end_time,
    measured_value: args.measured_value,
    allowed_value: args.allowed_value,
    excess_value: args.excess_value,
    unit: args.unit,
    source_activity_ids: Object.freeze([...args.source_activity_ids]),
    driver_fine_eur: driver_amount,
    company_fine_eur: company_amount,
    confidence: args.confidence,
    status: args.status ?? "pending",
    engine_version: ENGINE_VERSION,
    rule_set_version: args.rule_set_version,
  };
}

/** Helper: combine the per-rule evaluations into an EvaluationResult. */
export function combineEvaluations(
  ctx: EvaluatorContext,
  evaluations: readonly RuleEvaluation[],
): EvaluationResult {
  const violations: Violation[] = [];
  const not_evaluable: { rule_id: string; reason: string }[] = [];
  for (const ev of evaluations) {
    if (ev.status === "evaluated") {
      violations.push(...ev.violations);
    } else if (ev.status === "not_evaluable") {
      not_evaluable.push({ rule_id: ev.rule_id, reason: ev.reason });
    }
  }
  const versions: Record<string, string | number> = {};
  for (const set of ctx.rules.rule_sets) versions[set.rule_set] = set.version;
  for (const set of ctx.fines.fine_sets) versions[set.rule_set] = set.version;

  return Object.freeze({
    driver_id: ctx.timeline.driver_id,
    engine_version: ENGINE_VERSION,
    evaluated_at: ctx.evaluated_at,
    rule_set_versions: Object.freeze(versions),
    rule_evaluations: Object.freeze([...evaluations]),
    violations: Object.freeze(violations),
    not_evaluable: Object.freeze(not_evaluable),
  });
}

/** Resolve the rule_set version that owns a given rule. */
export function ruleSetVersionFor(rules: RuleIndex, rule_id: string): string {
  for (const set of rules.rule_sets) {
    if (set.rules.some((r) => r.rule_id === rule_id)) {
      return String(set.version);
    }
  }
  return "unknown";
}

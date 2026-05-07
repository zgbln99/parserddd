import type { Evaluator, EvaluatorContext } from "./base.js";
import { buildViolation, ruleSetVersionFor } from "./base.js";
import type { RuleEvaluation } from "../types/violation.js";
import type { Rule } from "../types/rule.js";
import type {
  AdministrativeContext,
  DownloadEvent,
  InspectionRecord,
} from "../types/administrative.js";

const RULE_CARD_28 = "EU_165_DOWNLOAD_CARD_28";
const RULE_VU_90 = "EU_165_DOWNLOAD_VU_90";
const RULE_RETENTION = "EU_165_DATA_RETENTION";
const RULE_INSPECTION = "EU_165_MISSING_INSPECTION";

const DAY_MS = 24 * 3600 * 1000;

/**
 * Category F — download cadence, retention, inspection records.
 *
 * Each rule REQUIRES the `EvaluatorContext.administrative` block. When that
 * block is absent we return `not_evaluable` per spec — never treat missing
 * data as compliance.
 */
export const downloadsEvaluator: Evaluator = {
  rule_ids: [RULE_CARD_28, RULE_VU_90, RULE_RETENTION, RULE_INSPECTION],

  evaluate(ctx: EvaluatorContext): readonly RuleEvaluation[] {
    return [
      cadence(ctx, RULE_CARD_28, "CARD", 28),
      cadence(ctx, RULE_VU_90, "VEHICLE_UNIT", 90),
      retention(ctx),
      inspection(ctx),
    ].filter((x): x is RuleEvaluation => x !== null);
  },
};

function cadence(
  ctx: EvaluatorContext,
  rule_id: string,
  source: DownloadEvent["source"],
  defaultDays: number,
): RuleEvaluation | null {
  const rule = ctx.rules.by_id.get(rule_id);
  if (!rule) return null;
  const admin = ctx.administrative;
  if (!admin) {
    return {
      status: "not_evaluable",
      rule_id,
      reason: "administrative.downloads not provided",
      missing_fields: ["EvaluatorContext.administrative.downloads"],
    };
  }
  const limit =
    (rule.logic as { max_days_between_downloads?: number } | undefined)
      ?.max_days_between_downloads ?? defaultDays;
  const limitMs = limit * DAY_MS;

  const sorted = [...admin.downloads]
    .filter((d) => d.source === source)
    .sort((a, b) => a.downloaded_at.getTime() - b.downloaded_at.getTime());

  if (sorted.length === 0) {
    // Treat the entire timeline range as one violation block — no download ever.
    return {
      status: "evaluated",
      rule_id,
      violations: [
        buildViolation({
          rule,
          fines: ctx.fines,
          driver_id: ctx.timeline.driver_id,
          start_time: ctx.timeline.range.start,
          end_time: ctx.timeline.range.end,
          measured_value: Math.round(
            (ctx.timeline.range.end.getTime() - ctx.timeline.range.start.getTime()) / DAY_MS,
          ),
          allowed_value: limit,
          excess_value: Math.round(
            (ctx.timeline.range.end.getTime() - ctx.timeline.range.start.getTime()) / DAY_MS - limit,
          ),
          unit: "days",
          source_activity_ids: [],
          confidence: 1,
          rule_set_version: ruleSetVersionFor(ctx.rules, rule_id),
        }),
      ],
    };
  }
  const violations = [] as ReturnType<typeof buildViolation>[];
  // Check gaps between consecutive downloads inside the timeline range.
  let prev: Date = sorted[0]?.downloaded_at ?? ctx.timeline.range.start;
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i] as DownloadEvent;
    const gapMs = curr.downloaded_at.getTime() - prev.getTime();
    if (gapMs > limitMs) {
      violations.push(
        buildViolation({
          rule,
          fines: ctx.fines,
          driver_id: ctx.timeline.driver_id,
          start_time: prev,
          end_time: curr.downloaded_at,
          measured_value: Math.round(gapMs / DAY_MS),
          allowed_value: limit,
          excess_value: Math.round(gapMs / DAY_MS - limit),
          unit: "days",
          source_activity_ids: [],
          confidence: 1,
          rule_set_version: ruleSetVersionFor(ctx.rules, rule_id),
        }),
      );
    }
    prev = curr.downloaded_at;
  }
  // Also check the gap between the latest download and `evaluated_at`.
  const tailMs = ctx.evaluated_at.getTime() - prev.getTime();
  if (tailMs > limitMs) {
    violations.push(
      buildViolation({
        rule,
        fines: ctx.fines,
        driver_id: ctx.timeline.driver_id,
        start_time: prev,
        end_time: ctx.evaluated_at,
        measured_value: Math.round(tailMs / DAY_MS),
        allowed_value: limit,
        excess_value: Math.round(tailMs / DAY_MS - limit),
        unit: "days",
        source_activity_ids: [],
        confidence: 1,
        rule_set_version: ruleSetVersionFor(ctx.rules, rule_id),
      }),
    );
  }
  return violations.length === 0
    ? { status: "compliant", rule_id }
    : { status: "evaluated", rule_id, violations };
}

function retention(ctx: EvaluatorContext): RuleEvaluation | null {
  const rule = ctx.rules.by_id.get(RULE_RETENTION);
  if (!rule) return null;
  const admin = ctx.administrative;
  if (!admin) {
    return {
      status: "not_evaluable",
      rule_id: RULE_RETENTION,
      reason: "administrative.retention not provided",
      missing_fields: ["EvaluatorContext.administrative.retention"],
    };
  }
  const days =
    (rule.logic as { retention_days?: number } | undefined)?.retention_days ?? 365;
  const requiredUntil = new Date(ctx.evaluated_at.getTime() - days * DAY_MS);

  const offenders = admin.retention.filter(
    (r) => r.removed_at !== null && r.removed_at < requiredUntil,
  );
  if (offenders.length === 0) {
    return { status: "compliant", rule_id: RULE_RETENTION };
  }
  const violations = offenders.map((r) =>
    buildViolation({
      rule,
      fines: ctx.fines,
      driver_id: ctx.timeline.driver_id,
      start_time: r.removed_at as Date,
      end_time: ctx.evaluated_at,
      measured_value: Math.round(
        (requiredUntil.getTime() - (r.removed_at as Date).getTime()) / DAY_MS,
      ),
      allowed_value: 0,
      excess_value: Math.round(
        (requiredUntil.getTime() - (r.removed_at as Date).getTime()) / DAY_MS,
      ),
      unit: "days",
      source_activity_ids: [],
      confidence: 1,
      rule_set_version: ruleSetVersionFor(ctx.rules, RULE_RETENTION),
    }),
  );
  return { status: "evaluated", rule_id: RULE_RETENTION, violations };
}

function inspection(ctx: EvaluatorContext): RuleEvaluation | null {
  const rule = ctx.rules.by_id.get(RULE_INSPECTION);
  if (!rule) return null;
  const admin = ctx.administrative;
  if (!admin) {
    return {
      status: "not_evaluable",
      rule_id: RULE_INSPECTION,
      reason: "administrative.inspections not provided",
      missing_fields: ["EvaluatorContext.administrative.inspections"],
    };
  }
  const limit =
    (rule.logic as { max_days_between_inspections?: number } | undefined)
      ?.max_days_between_inspections ?? 730;
  const limitMs = limit * DAY_MS;

  if (admin.inspections.length === 0) {
    return {
      status: "evaluated",
      rule_id: RULE_INSPECTION,
      violations: [
        buildViolation({
          rule,
          fines: ctx.fines,
          driver_id: ctx.timeline.driver_id,
          start_time: ctx.timeline.range.start,
          end_time: ctx.evaluated_at,
          measured_value: 0,
          allowed_value: 1,
          excess_value: 1,
          unit: "count",
          source_activity_ids: [],
          confidence: 1,
          rule_set_version: ruleSetVersionFor(ctx.rules, RULE_INSPECTION),
        }),
      ],
    };
  }
  const last = admin.inspections.reduce<InspectionRecord>((acc, x) =>
    x.performed_at > acc.performed_at ? x : acc,
  admin.inspections[0] as InspectionRecord);
  if (ctx.evaluated_at.getTime() - last.performed_at.getTime() > limitMs) {
    return {
      status: "evaluated",
      rule_id: RULE_INSPECTION,
      violations: [
        buildViolation({
          rule,
          fines: ctx.fines,
          driver_id: ctx.timeline.driver_id,
          start_time: last.performed_at,
          end_time: ctx.evaluated_at,
          measured_value: Math.round(
            (ctx.evaluated_at.getTime() - last.performed_at.getTime()) / DAY_MS,
          ),
          allowed_value: limit,
          excess_value: Math.round(
            (ctx.evaluated_at.getTime() - last.performed_at.getTime()) / DAY_MS - limit,
          ),
          unit: "days",
          source_activity_ids: [],
          confidence: 1,
          rule_set_version: ruleSetVersionFor(ctx.rules, RULE_INSPECTION),
        }),
      ],
    };
  }
  return { status: "compliant", rule_id: RULE_INSPECTION };
}

// (Type kept to silence "unused import" if AdministrativeContext is later imported elsewhere.)
export type _AdministrativeContextRef = AdministrativeContext;

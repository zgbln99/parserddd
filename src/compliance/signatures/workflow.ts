import { createHash } from "node:crypto";
import type { DriverSignature } from "../types/driver.js";
import type { Violation, ViolationStatus } from "../types/violation.js";
import type { DriverId } from "../types/common.js";

/**
 * Signature / dispute / correction workflow.
 *
 * The rule:
 *   pending  → signed | disputed
 *   disputed → corrected | signed
 *   corrected → signed
 *   signed   → terminal
 *   not_evaluable → terminal
 *
 * State transitions are validated here. Transitions are pure functions —
 * they return a new Violation; the audit log records the actual move.
 */

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

const ALLOWED: Readonly<Record<ViolationStatus, ReadonlyArray<ViolationStatus>>> = Object.freeze({
  pending: ["signed", "disputed"],
  disputed: ["corrected", "signed"],
  corrected: ["signed"],
  signed: [],
  not_evaluable: [],
});

function assertTransition(from: ViolationStatus, to: ViolationStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new WorkflowError(
      `illegal status transition: ${from} → ${to}`,
    );
  }
}

/**
 * Hash the canonical JSON representation of a violation so signatures can
 * later prove the signed payload was not edited.
 */
export function hashViolation(v: Violation): string {
  const payload = canonicalize(v);
  return createHash("sha256").update(payload).digest("hex");
}

export interface SignArgs {
  readonly violation: Violation;
  readonly driver_id: DriverId;
  readonly signer_name: string;
  readonly method: DriverSignature["method"];
  readonly signed_at: Date;
  readonly remark?: string | null;
}

export interface SignResult {
  readonly violation: Violation;
  readonly signature: DriverSignature;
}

export function signViolation(args: SignArgs): SignResult {
  assertTransition(args.violation.status, "signed");
  const hash = hashViolation(args.violation);
  const signature: DriverSignature = Object.freeze({
    driver_id: args.driver_id,
    signed_at: args.signed_at,
    subject_type: "VIOLATION",
    subject_id: args.violation.violation_id,
    method: args.method,
    signer_name: args.signer_name,
    payload_hash: hash,
    remark: args.remark ?? null,
  });
  const violation: Violation = Object.freeze({
    ...args.violation,
    status: "signed",
  });
  return { violation, signature };
}

export interface DisputeArgs {
  readonly violation: Violation;
  readonly driver_id: DriverId;
  readonly reason: string;
  readonly disputed_at: Date;
}

export function disputeViolation(args: DisputeArgs): {
  violation: Violation;
  remark: { driver_id: DriverId; at: Date; reason: string };
} {
  if (args.reason.trim().length === 0) {
    throw new WorkflowError("dispute reason must not be empty");
  }
  assertTransition(args.violation.status, "disputed");
  return {
    violation: Object.freeze({ ...args.violation, status: "disputed" }),
    remark: { driver_id: args.driver_id, at: args.disputed_at, reason: args.reason },
  };
}

export interface CorrectionArgs {
  readonly violation: Violation;
  readonly correction: Partial<
    Pick<Violation, "measured_value" | "allowed_value" | "excess_value" | "start_time" | "end_time">
  >;
  readonly corrector_name: string;
  readonly corrected_at: Date;
  readonly note: string;
}

export function correctViolation(args: CorrectionArgs): {
  violation: Violation;
  delta: Readonly<Record<string, unknown>>;
} {
  assertTransition(args.violation.status, "corrected");
  const next: Violation = Object.freeze({
    ...args.violation,
    ...args.correction,
    status: "corrected",
  });
  const delta: Record<string, unknown> = {};
  for (const key of Object.keys(args.correction) as (keyof typeof args.correction)[]) {
    delta[key as string] = {
      from: args.violation[key],
      to: next[key],
    };
  }
  delta.note = args.note;
  delta.corrector_name = args.corrector_name;
  delta.corrected_at = args.corrected_at.toISOString();
  return { violation: next, delta: Object.freeze(delta) };
}

/**
 * Stable canonical JSON: sorted keys, ISO dates, no fancy formatting. Used
 * for hashing signed payloads so identical content always hashes the same.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => ((acc[k] = obj[k]), acc), {});
    }
    return v;
  });
}

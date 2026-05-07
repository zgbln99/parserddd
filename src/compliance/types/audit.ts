import type { DriverId, ViolationId } from "./common.js";

/**
 * Append-only audit event. The audit log is a separate stream from the
 * violation list so corrections / disputes / signatures can be replayed
 * without rewriting the original engine output.
 */
export type AuditAction =
  | "EVALUATION_RUN"
  | "VIOLATION_CREATED"
  | "VIOLATION_SIGNED"
  | "VIOLATION_DISPUTED"
  | "VIOLATION_CORRECTED"
  | "TIMELINE_NORMALIZED"
  | "RULES_LOADED"
  | "FINES_LOADED";

export interface AuditLogEntry {
  readonly id: string;
  readonly action: AuditAction;
  readonly occurred_at: Date;
  readonly driver_id: DriverId | null;
  readonly violation_id: ViolationId | null;
  readonly actor: string;
  readonly engine_version: string;
  /** SHA-256 of the JSON payload, for tamper detection. */
  readonly payload_hash: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

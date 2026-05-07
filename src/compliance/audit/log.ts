import { createHash, randomUUID } from "node:crypto";
import type {
  AuditAction,
  AuditLogEntry,
} from "../types/audit.js";
import type { DriverId, ViolationId } from "../types/common.js";
import { canonicalize } from "../signatures/workflow.js";
import { ENGINE_VERSION } from "../evaluators/base.js";

/**
 * Append-only audit log.
 *
 * The log is intentionally an in-memory sequence wrapped by an explicit
 * `append`. Persistence (DB write, S3 sink, etc.) is the responsibility of
 * the caller — the engine must remain free of I/O side effects.
 *
 * Tamper detection: every entry carries `payload_hash`. We also chain
 * entries with `prev_hash` so any silent edit anywhere in the log
 * propagates to all later entries.
 */
export interface ChainedAuditLogEntry extends AuditLogEntry {
  readonly prev_hash: string | null;
  readonly chain_hash: string;
}

export class AuditLog {
  private readonly entries: ChainedAuditLogEntry[] = [];
  private last_hash: string | null = null;

  append(args: {
    action: AuditAction;
    actor: string;
    driver_id?: DriverId | null;
    violation_id?: ViolationId | null;
    payload: Readonly<Record<string, unknown>>;
    occurred_at?: Date;
  }): ChainedAuditLogEntry {
    const id = randomUUID();
    const occurred_at = args.occurred_at ?? new Date();
    const payload_str = canonicalize(args.payload);
    const payload_hash = createHash("sha256").update(payload_str).digest("hex");
    const chain_input = (this.last_hash ?? "") + payload_hash + id + occurred_at.toISOString();
    const chain_hash = createHash("sha256").update(chain_input).digest("hex");
    const entry: ChainedAuditLogEntry = Object.freeze({
      id,
      action: args.action,
      occurred_at,
      driver_id: args.driver_id ?? null,
      violation_id: args.violation_id ?? null,
      actor: args.actor,
      engine_version: ENGINE_VERSION,
      payload_hash,
      payload: args.payload,
      prev_hash: this.last_hash,
      chain_hash,
    });
    this.entries.push(entry);
    this.last_hash = chain_hash;
    return entry;
  }

  /** Read-only snapshot — caller must NOT mutate the array. */
  snapshot(): readonly ChainedAuditLogEntry[] {
    return Object.freeze([...this.entries]);
  }

  /**
   * Re-derive every chain hash from scratch and verify each entry matches.
   * Returns null on success or the index of the first inconsistent entry.
   */
  verify(): number | null {
    let prev: string | null = null;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i] as ChainedAuditLogEntry;
      const expected_payload_hash = createHash("sha256")
        .update(canonicalize(e.payload))
        .digest("hex");
      if (expected_payload_hash !== e.payload_hash) return i;
      const expected_chain_hash: string = createHash("sha256")
        .update((prev ?? "") + e.payload_hash + e.id + e.occurred_at.toISOString())
        .digest("hex");
      if (expected_chain_hash !== e.chain_hash) return i;
      if (e.prev_hash !== prev) return i;
      prev = e.chain_hash;
    }
    return null;
  }
}

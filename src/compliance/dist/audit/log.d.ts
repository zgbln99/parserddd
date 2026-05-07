import type { AuditAction, AuditLogEntry } from "../types/audit.js";
import type { DriverId, ViolationId } from "../types/common.js";
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
export declare class AuditLog {
    private readonly entries;
    private last_hash;
    append(args: {
        action: AuditAction;
        actor: string;
        driver_id?: DriverId | null;
        violation_id?: ViolationId | null;
        payload: Readonly<Record<string, unknown>>;
        occurred_at?: Date;
    }): ChainedAuditLogEntry;
    /** Read-only snapshot — caller must NOT mutate the array. */
    snapshot(): readonly ChainedAuditLogEntry[];
    /**
     * Re-derive every chain hash from scratch and verify each entry matches.
     * Returns null on success or the index of the first inconsistent entry.
     */
    verify(): number | null;
}
//# sourceMappingURL=log.d.ts.map
import type { DriverSignature } from "../types/driver.js";
import type { Violation } from "../types/violation.js";
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
export declare class WorkflowError extends Error {
    constructor(message: string);
}
/**
 * Hash the canonical JSON representation of a violation so signatures can
 * later prove the signed payload was not edited.
 */
export declare function hashViolation(v: Violation): string;
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
export declare function signViolation(args: SignArgs): SignResult;
export interface DisputeArgs {
    readonly violation: Violation;
    readonly driver_id: DriverId;
    readonly reason: string;
    readonly disputed_at: Date;
}
export declare function disputeViolation(args: DisputeArgs): {
    violation: Violation;
    remark: {
        driver_id: DriverId;
        at: Date;
        reason: string;
    };
};
export interface CorrectionArgs {
    readonly violation: Violation;
    readonly correction: Partial<Pick<Violation, "measured_value" | "allowed_value" | "excess_value" | "start_time" | "end_time">>;
    readonly corrector_name: string;
    readonly corrected_at: Date;
    readonly note: string;
}
export declare function correctViolation(args: CorrectionArgs): {
    violation: Violation;
    delta: Readonly<Record<string, unknown>>;
};
/**
 * Stable canonical JSON: sorted keys, ISO dates, no fancy formatting. Used
 * for hashing signed payloads so identical content always hashes the same.
 */
export declare function canonicalize(value: unknown): string;
//# sourceMappingURL=workflow.d.ts.map
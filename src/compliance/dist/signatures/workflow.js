import { createHash } from "node:crypto";
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
    constructor(message) {
        super(message);
        this.name = "WorkflowError";
    }
}
const ALLOWED = Object.freeze({
    pending: ["signed", "disputed"],
    disputed: ["corrected", "signed"],
    corrected: ["signed"],
    signed: [],
    not_evaluable: [],
});
function assertTransition(from, to) {
    if (!ALLOWED[from].includes(to)) {
        throw new WorkflowError(`illegal status transition: ${from} → ${to}`);
    }
}
/**
 * Hash the canonical JSON representation of a violation so signatures can
 * later prove the signed payload was not edited.
 */
export function hashViolation(v) {
    const payload = canonicalize(v);
    return createHash("sha256").update(payload).digest("hex");
}
export function signViolation(args) {
    assertTransition(args.violation.status, "signed");
    const hash = hashViolation(args.violation);
    const signature = Object.freeze({
        driver_id: args.driver_id,
        signed_at: args.signed_at,
        subject_type: "VIOLATION",
        subject_id: args.violation.violation_id,
        method: args.method,
        signer_name: args.signer_name,
        payload_hash: hash,
        remark: args.remark ?? null,
    });
    const violation = Object.freeze({
        ...args.violation,
        status: "signed",
    });
    return { violation, signature };
}
export function disputeViolation(args) {
    if (args.reason.trim().length === 0) {
        throw new WorkflowError("dispute reason must not be empty");
    }
    assertTransition(args.violation.status, "disputed");
    return {
        violation: Object.freeze({ ...args.violation, status: "disputed" }),
        remark: { driver_id: args.driver_id, at: args.disputed_at, reason: args.reason },
    };
}
export function correctViolation(args) {
    assertTransition(args.violation.status, "corrected");
    const next = Object.freeze({
        ...args.violation,
        ...args.correction,
        status: "corrected",
    });
    const delta = {};
    for (const key of Object.keys(args.correction)) {
        delta[key] = {
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
export function canonicalize(value) {
    return JSON.stringify(value, (_k, v) => {
        if (v instanceof Date)
            return v.toISOString();
        if (v && typeof v === "object" && !Array.isArray(v)) {
            const obj = v;
            return Object.keys(obj)
                .sort()
                .reduce((acc, k) => ((acc[k] = obj[k]), acc), {});
        }
        return v;
    });
}
//# sourceMappingURL=workflow.js.map
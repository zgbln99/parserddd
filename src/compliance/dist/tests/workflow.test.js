import { describe, expect, it } from "vitest";
import { correctViolation, disputeViolation, hashViolation, signViolation, WorkflowError, } from "../signatures/workflow.js";
import { AuditLog } from "../audit/log.js";
import { asActivityId, asDriverId, asViolationId } from "../types/common.js";
const sampleViolation = () => Object.freeze({
    violation_id: asViolationId("v_test"),
    driver_id: asDriverId("DRV"),
    rule_id: "TEST_RULE",
    category: "DRIVING_TIME",
    severity: null,
    legal_basis: { de: "x", en: "x", pl: "x" },
    title: { de: "x", en: "x", pl: "x" },
    explanation: { de: "x", en: "x", pl: "x" },
    start_time: new Date("2026-03-02T00:00:00Z"),
    end_time: new Date("2026-03-02T01:00:00Z"),
    measured_value: 60,
    allowed_value: 30,
    excess_value: 30,
    unit: "minutes",
    source_activity_ids: [asActivityId("a1")],
    driver_fine_eur: null,
    company_fine_eur: null,
    confidence: 1,
    status: "pending",
    engine_version: "0.1.0",
    rule_set_version: "2026.01",
});
describe("signatures + dispute + correction workflow", () => {
    it("signs a pending violation and produces a signature with content hash", () => {
        const v = sampleViolation();
        const result = signViolation({
            violation: v,
            driver_id: v.driver_id,
            signer_name: "Hans Mustermann",
            method: "DIGITAL",
            signed_at: new Date("2026-03-03T00:00:00Z"),
        });
        expect(result.violation.status).toBe("signed");
        expect(result.signature.payload_hash).toBe(hashViolation(v));
        expect(result.signature.method).toBe("DIGITAL");
    });
    it("rejects illegal transitions", () => {
        const v = { ...sampleViolation(), status: "signed" };
        expect(() => signViolation({
            violation: v,
            driver_id: v.driver_id,
            signer_name: "x",
            method: "WET",
            signed_at: new Date(),
        })).toThrow(WorkflowError);
    });
    it("disputes require a non-empty reason", () => {
        const v = sampleViolation();
        expect(() => disputeViolation({
            violation: v,
            driver_id: v.driver_id,
            reason: "   ",
            disputed_at: new Date(),
        })).toThrow(WorkflowError);
        const ok = disputeViolation({
            violation: v,
            driver_id: v.driver_id,
            reason: "I was actually on a ferry",
            disputed_at: new Date(),
        });
        expect(ok.violation.status).toBe("disputed");
    });
    it("corrections produce a delta with from/to fields", () => {
        const v = { ...sampleViolation(), status: "disputed" };
        const out = correctViolation({
            violation: v,
            correction: { measured_value: 45, excess_value: 15 },
            corrector_name: "Inspector",
            corrected_at: new Date("2026-03-05T00:00:00Z"),
            note: "ferry interruption",
        });
        expect(out.violation.status).toBe("corrected");
        const delta = out.delta;
        expect(delta.measured_value).toEqual({ from: 60, to: 45 });
        expect(delta.excess_value).toEqual({ from: 30, to: 15 });
    });
});
describe("AuditLog", () => {
    it("appends entries with a chained tamper-evident hash", () => {
        const log = new AuditLog();
        log.append({ action: "RULES_LOADED", actor: "engine", payload: { count: 5 } });
        log.append({ action: "EVALUATION_RUN", actor: "engine", payload: { violations: 3 } });
        expect(log.snapshot()).toHaveLength(2);
        expect(log.verify()).toBeNull();
    });
    it("verify returns the index of the first tampered entry", () => {
        const log = new AuditLog();
        const original = { v: 1 };
        log.append({ action: "RULES_LOADED", actor: "engine", payload: original });
        log.append({ action: "EVALUATION_RUN", actor: "engine", payload: { v: 2 } });
        // Object.freeze is shallow — the entry is frozen but the payload object
        // it references is not, so a real-world attacker could swap one of its
        // fields. Verify must catch that.
        original.v = 999;
        expect(log.verify()).toBe(0);
    });
});
//# sourceMappingURL=workflow.test.js.map
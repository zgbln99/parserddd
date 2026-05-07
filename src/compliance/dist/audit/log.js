import { createHash, randomUUID } from "node:crypto";
import { canonicalize } from "../signatures/workflow.js";
import { ENGINE_VERSION } from "../evaluators/base.js";
export class AuditLog {
    entries = [];
    last_hash = null;
    append(args) {
        const id = randomUUID();
        const occurred_at = args.occurred_at ?? new Date();
        const payload_str = canonicalize(args.payload);
        const payload_hash = createHash("sha256").update(payload_str).digest("hex");
        const chain_input = (this.last_hash ?? "") + payload_hash + id + occurred_at.toISOString();
        const chain_hash = createHash("sha256").update(chain_input).digest("hex");
        const entry = Object.freeze({
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
    snapshot() {
        return Object.freeze([...this.entries]);
    }
    /**
     * Re-derive every chain hash from scratch and verify each entry matches.
     * Returns null on success or the index of the first inconsistent entry.
     */
    verify() {
        let prev = null;
        for (let i = 0; i < this.entries.length; i++) {
            const e = this.entries[i];
            const expected_payload_hash = createHash("sha256")
                .update(canonicalize(e.payload))
                .digest("hex");
            if (expected_payload_hash !== e.payload_hash)
                return i;
            const expected_chain_hash = createHash("sha256")
                .update((prev ?? "") + e.payload_hash + e.id + e.occurred_at.toISOString())
                .digest("hex");
            if (expected_chain_hash !== e.chain_hash)
                return i;
            if (e.prev_hash !== prev)
                return i;
            prev = e.chain_hash;
        }
        return null;
    }
}
//# sourceMappingURL=log.js.map
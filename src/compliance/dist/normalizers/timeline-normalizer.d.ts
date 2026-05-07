import type { ActivityCandidate } from "../types/activity.js";
import type { CardSession, ManualEntry, Printout, TachographEvent, Timeline } from "../types/timeline.js";
import type { DriverId } from "../types/common.js";
/**
 * Raw input the normalizer accepts. Mirrors the shape of a parsed DDD
 * snapshot — see backend/core/parsers.py for the producer side.
 *
 * The normalizer is intentionally pure: same input → same output. It must
 * never read the clock, the filesystem, or any global state.
 */
export interface NormalizerInput {
    readonly driver_id: DriverId;
    readonly range_start: Date;
    readonly range_end: Date;
    readonly activity_candidates: readonly ActivityCandidate[];
    readonly card_sessions: readonly CardSession[];
    readonly manual_entries: readonly ManualEntry[];
    readonly events: readonly TachographEvent[];
    readonly printouts: readonly Printout[];
}
export declare class TimelineInvariantError extends Error {
    readonly invariant: string;
    constructor(invariant: string, detail: string);
}
/**
 * Build a deterministic Timeline from raw parsed input.
 *
 * Steps:
 *  1. Merge activity candidates (resolves overlaps, picks best source/kind).
 *  2. Fill holes with UNKNOWN activities so the resulting list is dense.
 *  3. Sort & deep-freeze for evaluator safety.
 *  4. Verify invariants and throw if anything is off — evaluators MUST be
 *     able to assume a clean timeline.
 */
export declare function normalizeTimeline(input: NormalizerInput): Timeline;
//# sourceMappingURL=timeline-normalizer.d.ts.map
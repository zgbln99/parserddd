import type { ActivityId, Confidence, CountryCode, DriverId, TimeInterval, VehicleId } from "./common.js";
/**
 * Tachograph activity kind, matching DDD activity semantics.
 *
 * REST       — type 0 in driver activity records
 * AVAILABILITY — type 1 (Bereitschaft / dyspozycja)
 * WORK       — type 2 (other work)
 * DRIVING    — type 3
 *
 * UNKNOWN is used only for gaps that the parser could not classify; it must
 * never be silently treated as REST or WORK.
 */
export type ActivityKind = "REST" | "AVAILABILITY" | "WORK" | "DRIVING" | "UNKNOWN";
/** Tachograph card slot. */
export type CardSlot = "DRIVER" | "CO_DRIVER";
/**
 * Source of an activity record.
 *
 * - CARD: read directly from the driver card chip.
 * - VEHICLE_UNIT: read from the vehicle unit, attributed to a driver.
 * - MANUAL_ENTRY: entered by the driver after card insertion.
 * - INFERRED: produced by the normalizer to fill a deterministic gap
 *             (e.g. "no card, vehicle stationary" → REST inferred).
 *             Inferred activities MUST carry a reduced confidence value.
 */
export type ActivitySource = "CARD" | "VEHICLE_UNIT" | "MANUAL_ENTRY" | "INFERRED";
/**
 * A single normalized activity span on the timeline.
 *
 * The interval is half-open: [start, end). The engine relies on this
 * everywhere — overlap detection, merge logic, duration sums.
 */
export interface Activity extends TimeInterval {
    readonly id: ActivityId;
    readonly driver_id: DriverId;
    readonly vehicle_id: VehicleId | null;
    readonly kind: ActivityKind;
    readonly source: ActivitySource;
    readonly slot: CardSlot;
    /** True when the driver card was inserted for the whole interval. */
    readonly card_inserted: boolean;
    /**
     * "OUT" flag: vehicle out-of-scope (Article 3 / Anlage 1 KrFArbZG).
     * When true, EU 561 rules do not apply but national rules may.
     */
    readonly out_of_scope: boolean;
    /**
     * "Ferry/Train" flag: regular daily/weekly rest interrupted by ferry/train
     * (EU 561 Art. 9(1)). The engine must not count the interruption against
     * the rest period when this is set.
     */
    readonly ferry_train: boolean;
    /** Country at the start of the interval (manual entry / VU GNSS). */
    readonly start_country: CountryCode | null;
    /** Country at the end of the interval. */
    readonly end_country: CountryCode | null;
    /**
     * Confidence in this record:
     * - 1.0 for CARD / VEHICLE_UNIT / explicit MANUAL_ENTRY,
     * - <1.0 only for INFERRED records.
     */
    readonly confidence: Confidence;
    /** Free-form notes from the parser; must not affect decisions. */
    readonly notes: readonly string[];
}
/** Merge-time hint for the normalizer. Not part of the persistent record. */
export interface ActivityCandidate extends Omit<Activity, "id" | "confidence"> {
    readonly id?: ActivityId;
    readonly confidence?: Confidence;
}
//# sourceMappingURL=activity.d.ts.map
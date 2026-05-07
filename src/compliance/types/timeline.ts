import type { Activity } from "./activity.js";
import type {
  CountryCode,
  DriverId,
  TimeInterval,
  VehicleId,
} from "./common.js";

/**
 * Card insertion / withdrawal events from the driver card.
 *
 * These are kept as a separate stream because the timeline normalizer needs
 * them to detect "driving without card" and "card removed too early".
 */
export interface CardSession extends TimeInterval {
  readonly driver_id: DriverId;
  readonly vehicle_id: VehicleId | null;
  /** Country recorded at insertion ("Anfangsland"). May be null if missing. */
  readonly start_country: CountryCode | null;
  /** Country recorded at withdrawal ("Endland"). May be null if missing. */
  readonly end_country: CountryCode | null;
  /** Odometer at insertion in km, or null. */
  readonly start_odometer_km: number | null;
  /** Odometer at withdrawal in km, or null. */
  readonly end_odometer_km: number | null;
}

/**
 * Manual entry block as written by the driver after card insertion.
 * Used to back-fill activities for the period the card was withdrawn.
 */
export interface ManualEntry extends TimeInterval {
  readonly driver_id: DriverId;
  readonly entered_at: Date;
  readonly complete: boolean;
  readonly notes: readonly string[];
}

/**
 * Tachograph events / faults as recorded by the VU
 * (EU 165/2014 Annex IC).
 */
export interface TachographEvent {
  readonly driver_id: DriverId | null;
  readonly vehicle_id: VehicleId | null;
  readonly type: string;
  readonly begin: Date;
  readonly end: Date | null;
  readonly raw_code: string | null;
  readonly notes: readonly string[];
}

/**
 * Printout (Ausdruck) record, EU 165/2014 Art. 35.
 */
export interface Printout {
  readonly driver_id: DriverId | null;
  readonly created_at: Date;
  readonly type: string;
  readonly reason: string | null;
}

/**
 * The merged, deterministic timeline used as evaluator input.
 *
 * Activities are sorted ascending by start, non-overlapping, and contiguous
 * (gaps are represented by explicit UNKNOWN activities). Validators in
 * normalizers/timeline.ts enforce these invariants before evaluators run.
 */
export interface Timeline {
  readonly driver_id: DriverId;
  readonly range: TimeInterval;
  readonly activities: readonly Activity[];
  readonly card_sessions: readonly CardSession[];
  readonly manual_entries: readonly ManualEntry[];
  readonly events: readonly TachographEvent[];
  readonly printouts: readonly Printout[];
}

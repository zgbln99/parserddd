import type { Activity } from "./activity.js";
import type {
  CountryCode,
  DriverId,
  TimeInterval,
} from "./common.js";

/**
 * A calculation period covering one calendar day for a single driver,
 * keyed by the local date the day belongs to (per company timezone).
 *
 * NOTE: a "day" in EU 561 is not the calendar day — it is the 24h window
 * after the end of the previous daily rest. `driver_day_window` carries
 * that interval; `local_date` is purely for reporting/grouping.
 */
export interface DriverDay {
  readonly driver_id: DriverId;
  readonly local_date: string;
  readonly driver_day_window: TimeInterval;
  readonly activities: readonly Activity[];
  readonly driving_minutes: number;
  readonly working_minutes: number;
  readonly availability_minutes: number;
  readonly rest_minutes: number;
  readonly start_country: CountryCode | null;
  readonly end_country: CountryCode | null;
}

/**
 * A weekly period under EU 561 Art. 4(i): Monday 00:00 to Sunday 24:00 local.
 *
 * `iso_year` / `iso_week` follow ISO-8601 week numbering so weeks across
 * year boundaries are stable.
 */
export interface DriverWeek {
  readonly driver_id: DriverId;
  readonly iso_year: number;
  readonly iso_week: number;
  readonly window: TimeInterval;
  readonly days: readonly DriverDay[];
  readonly total_driving_minutes: number;
  readonly total_working_minutes: number;
}

/**
 * Driver-level signature record used by reporting + audit trail.
 */
export interface DriverSignature {
  readonly driver_id: DriverId;
  readonly signed_at: Date;
  readonly subject_type: "REPORT" | "VIOLATION" | "TIMELINE";
  readonly subject_id: string;
  readonly method: "WET" | "DIGITAL" | "QES";
  readonly signer_name: string;
  /** Hash of the signed payload (SHA-256 hex), to detect later edits. */
  readonly payload_hash: string;
  /** Optional driver remark attached to the signature. */
  readonly remark: string | null;
}

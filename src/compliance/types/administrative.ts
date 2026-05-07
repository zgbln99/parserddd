import type { DriverId, VehicleId } from "./common.js";

/**
 * Administrative data that lives outside the activity timeline:
 * download history, inspection records, retention archive.
 *
 * Evaluators in category F (downloads / retention / inspection) consume
 * this stream. The compliance engine consumes pre-merged data only — it
 * does NOT read external systems at runtime.
 */
export interface DownloadEvent {
  readonly source: "CARD" | "VEHICLE_UNIT";
  readonly driver_id: DriverId | null;
  readonly vehicle_id: VehicleId | null;
  readonly downloaded_at: Date;
  readonly file_hash: string | null;
}

export interface InspectionRecord {
  readonly vehicle_id: VehicleId;
  readonly performed_at: Date;
  readonly workshop_card_id: string | null;
  readonly notes: readonly string[];
}

export interface RetentionRecord {
  readonly source: "CARD" | "VEHICLE_UNIT";
  readonly driver_id: DriverId | null;
  readonly vehicle_id: VehicleId | null;
  readonly archived_until: Date;
  readonly removed_at: Date | null;
}

/**
 * Optional bundle of administrative data. Whenever it is `undefined`,
 * category F evaluators must return `not_evaluable` rather than treating
 * the absence as compliance.
 */
export interface AdministrativeContext {
  readonly downloads: readonly DownloadEvent[];
  readonly inspections: readonly InspectionRecord[];
  readonly retention: readonly RetentionRecord[];
}

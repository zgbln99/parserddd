import type {
  ActivityCandidate,
  ActivityKind,
  ActivitySource,
  CardSlot,
} from "../types/activity.js";
import type {
  CardSession,
  ManualEntry,
  Printout,
  TachographEvent,
} from "../types/timeline.js";
import type {
  DownloadEvent,
  InspectionRecord,
  RetentionRecord,
} from "../types/administrative.js";
import {
  asActivityId,
  asDriverId,
  asVehicleId,
  type CountryCode,
  type DriverId,
  type VehicleId,
} from "../types/common.js";

/**
 * Tiny fluent builders for tests. They return PLAIN objects (no class
 * instances) so test assertions on shape stay simple.
 *
 * Time inputs accept either an ISO-8601 string or a Date — strings are
 * preferred in tests because they read better in failure messages.
 */

const D = (x: string | Date): Date => (typeof x === "string" ? new Date(x) : x);

export const TEST_DRIVER: DriverId = asDriverId("DRV-001");
export const TEST_VEHICLE: VehicleId = asVehicleId("VEH-001");

export interface ActivityBuilderOpts {
  driver_id?: DriverId;
  vehicle_id?: VehicleId | null;
  kind?: ActivityKind;
  source?: ActivitySource;
  slot?: CardSlot;
  card_inserted?: boolean;
  out_of_scope?: boolean;
  ferry_train?: boolean;
  start_country?: CountryCode | null;
  end_country?: CountryCode | null;
  confidence?: number;
  notes?: readonly string[];
}

export function activity(
  start: string | Date,
  end: string | Date,
  opts: ActivityBuilderOpts = {},
): ActivityCandidate {
  return {
    id: asActivityId(`fx_${D(start).toISOString()}`),
    driver_id: opts.driver_id ?? TEST_DRIVER,
    vehicle_id: opts.vehicle_id === undefined ? TEST_VEHICLE : opts.vehicle_id,
    kind: opts.kind ?? "DRIVING",
    source: opts.source ?? "CARD",
    slot: opts.slot ?? "DRIVER",
    card_inserted: opts.card_inserted ?? true,
    out_of_scope: opts.out_of_scope ?? false,
    ferry_train: opts.ferry_train ?? false,
    start_country: opts.start_country ?? null,
    end_country: opts.end_country ?? null,
    confidence: opts.confidence ?? 1,
    notes: opts.notes ?? [],
    start: D(start),
    end: D(end),
  };
}

export function cardSession(
  start: string | Date,
  end: string | Date,
  opts: Partial<CardSession> = {},
): CardSession {
  return {
    driver_id: opts.driver_id ?? TEST_DRIVER,
    vehicle_id: opts.vehicle_id === undefined ? TEST_VEHICLE : opts.vehicle_id,
    start_country: opts.start_country ?? null,
    end_country: opts.end_country ?? null,
    start_odometer_km: opts.start_odometer_km ?? null,
    end_odometer_km: opts.end_odometer_km ?? null,
    start: D(start),
    end: D(end),
  };
}

export function manualEntry(
  start: string | Date,
  end: string | Date,
  opts: Partial<ManualEntry> = {},
): ManualEntry {
  const startDate = D(start);
  return {
    driver_id: opts.driver_id ?? TEST_DRIVER,
    entered_at: opts.entered_at ?? D(end),
    complete: opts.complete ?? true,
    notes: opts.notes ?? [],
    start: startDate,
    end: D(end),
  };
}

export function tachoEvent(
  type: string,
  begin: string | Date,
  opts: Partial<TachographEvent> = {},
): TachographEvent {
  return {
    driver_id: opts.driver_id ?? TEST_DRIVER,
    vehicle_id: opts.vehicle_id ?? TEST_VEHICLE,
    type,
    begin: D(begin),
    end: opts.end ?? null,
    raw_code: opts.raw_code ?? null,
    notes: opts.notes ?? [],
  };
}

export function printoutFx(
  created_at: string | Date,
  type = "DRIVER_24H",
  opts: Partial<Printout> = {},
): Printout {
  return {
    driver_id: opts.driver_id ?? TEST_DRIVER,
    created_at: D(created_at),
    type,
    reason: opts.reason ?? null,
  };
}

export function downloadFx(
  source: DownloadEvent["source"],
  downloaded_at: string | Date,
  opts: Partial<DownloadEvent> = {},
): DownloadEvent {
  return {
    source,
    driver_id: opts.driver_id ?? (source === "CARD" ? TEST_DRIVER : null),
    vehicle_id: opts.vehicle_id ?? (source === "VEHICLE_UNIT" ? TEST_VEHICLE : null),
    downloaded_at: D(downloaded_at),
    file_hash: opts.file_hash ?? null,
  };
}

export function inspectionFx(
  performed_at: string | Date,
  opts: Partial<InspectionRecord> = {},
): InspectionRecord {
  return {
    vehicle_id: opts.vehicle_id ?? TEST_VEHICLE,
    performed_at: D(performed_at),
    workshop_card_id: opts.workshop_card_id ?? null,
    notes: opts.notes ?? [],
  };
}

export function retentionFx(
  source: RetentionRecord["source"],
  archived_until: string | Date,
  opts: Partial<RetentionRecord> = {},
): RetentionRecord {
  return {
    source,
    driver_id: opts.driver_id ?? (source === "CARD" ? TEST_DRIVER : null),
    vehicle_id: opts.vehicle_id ?? (source === "VEHICLE_UNIT" ? TEST_VEHICLE : null),
    archived_until: D(archived_until),
    removed_at: opts.removed_at ?? null,
  };
}

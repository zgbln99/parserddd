import type {
  ActivityCandidate,
  ActivityKind,
  ActivitySource,
  CardSlot,
} from "../types/activity.js";
import type {
  CardSession,
  ManualEntry,
} from "../types/timeline.js";
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

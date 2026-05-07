import type { ActivityCandidate, ActivityKind, ActivitySource, CardSlot } from "../types/activity.js";
import type { CardSession, ManualEntry, Printout, TachographEvent } from "../types/timeline.js";
import type { DownloadEvent, InspectionRecord, RetentionRecord } from "../types/administrative.js";
import { type CountryCode, type DriverId, type VehicleId } from "../types/common.js";
export declare const TEST_DRIVER: DriverId;
export declare const TEST_VEHICLE: VehicleId;
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
export declare function activity(start: string | Date, end: string | Date, opts?: ActivityBuilderOpts): ActivityCandidate;
export declare function cardSession(start: string | Date, end: string | Date, opts?: Partial<CardSession>): CardSession;
export declare function manualEntry(start: string | Date, end: string | Date, opts?: Partial<ManualEntry>): ManualEntry;
export declare function tachoEvent(type: string, begin: string | Date, opts?: Partial<TachographEvent>): TachographEvent;
export declare function printoutFx(created_at: string | Date, type?: string, opts?: Partial<Printout>): Printout;
export declare function downloadFx(source: DownloadEvent["source"], downloaded_at: string | Date, opts?: Partial<DownloadEvent>): DownloadEvent;
export declare function inspectionFx(performed_at: string | Date, opts?: Partial<InspectionRecord>): InspectionRecord;
export declare function retentionFx(source: RetentionRecord["source"], archived_until: string | Date, opts?: Partial<RetentionRecord>): RetentionRecord;
//# sourceMappingURL=builder.d.ts.map
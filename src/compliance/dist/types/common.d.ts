/**
 * Shared primitives for the compliance engine.
 *
 * All times are kept as `Date` objects representing absolute UTC instants.
 * The original DDD source is in UTC; local-time interpretation only happens
 * inside reporting helpers (see calculations/time.ts).
 */
export type Iso8601 = string;
export type Locale = "de" | "en" | "pl";
export type MultilingualText = Readonly<Record<Locale, string>>;
/** ISO-3166-1 alpha-2 country code (e.g. "DE", "PL", "AT"). */
export type CountryCode = string;
/** Branded id helpers — keep ids opaque to avoid accidental string mixing. */
export type ActivityId = string & {
    readonly __brand: "ActivityId";
};
export type DriverId = string & {
    readonly __brand: "DriverId";
};
export type VehicleId = string & {
    readonly __brand: "VehicleId";
};
export type RuleId = string;
export type ViolationId = string & {
    readonly __brand: "ViolationId";
};
/**
 * A half-open time interval [start, end). All durations in the engine are
 * derived from such intervals, so the convention must be enforced everywhere.
 */
export interface TimeInterval {
    readonly start: Date;
    readonly end: Date;
}
/** Confidence in a derived value, 0..1. 1.0 = direct measurement. */
export type Confidence = number;
/** Helper builder for branded ids — no runtime cost, type-only. */
export declare const asActivityId: (s: string) => ActivityId;
export declare const asDriverId: (s: string) => DriverId;
export declare const asVehicleId: (s: string) => VehicleId;
export declare const asViolationId: (s: string) => ViolationId;
//# sourceMappingURL=common.d.ts.map
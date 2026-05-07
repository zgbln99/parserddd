/**
 * Shared primitives for the compliance engine.
 *
 * All times are kept as `Date` objects representing absolute UTC instants.
 * The original DDD source is in UTC; local-time interpretation only happens
 * inside reporting helpers (see calculations/time.ts).
 */
/** Helper builder for branded ids — no runtime cost, type-only. */
export const asActivityId = (s) => s;
export const asDriverId = (s) => s;
export const asVehicleId = (s) => s;
export const asViolationId = (s) => s;
//# sourceMappingURL=common.js.map
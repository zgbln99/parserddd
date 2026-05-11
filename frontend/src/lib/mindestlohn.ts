// MiLoG minimum-wage helper — shared by the analysis and settlement views.
//
// effective €/h = monthly gross / hours worked (driving + other work +
// availability, i.e. the "Arbeitszeit" the analysis already sums). The
// monthly gross is the per-driver override when set, otherwise the
// company-wide default from the admin config.

import type { MindestlohnSettings } from './api';

/** Fallback used when /api/mindestlohn/settings is unavailable. */
export const DEFAULT_MINDESTLOHN_SETTINGS: MindestlohnSettings = {
  default_monthly_gross_eur: 2750,
  min_hourly_eur: 14,
};

export interface MindestlohnResult {
  workMinutes: number;
  workHours: number;
  monthlyGrossEur: number;
  effectiveHourlyEur: number;
  minHourlyEur: number;
  /** true when effective €/h is at or above the statutory floor */
  ok: boolean;
  /** gross still missing to reach the floor (0 when ok) */
  shortfallEur: number;
  grossSource: 'driver' | 'default';
}

/** Parse a "H:MM" / "HHH:MM" string to minutes; null when it doesn't parse. */
export function parseHmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^\s*(\d+):([0-5]?\d)\s*$/.exec(value);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function computeMindestlohn(
  workMinutes: number,
  opts: { monthlyGrossOverride?: number | null; settings: MindestlohnSettings },
): MindestlohnResult | null {
  const minHourly = opts.settings.min_hourly_eur > 0 ? opts.settings.min_hourly_eur : 14;
  const override = opts.monthlyGrossOverride;
  const useOverride = override != null && override > 0;
  const gross = useOverride ? override : (opts.settings.default_monthly_gross_eur || 0);
  if (gross <= 0 || workMinutes <= 0) return null;
  const workHours = workMinutes / 60;
  const effective = gross / workHours;
  const required = minHourly * workHours;
  return {
    workMinutes,
    workHours,
    monthlyGrossEur: gross,
    effectiveHourlyEur: effective,
    minHourlyEur: minHourly,
    ok: effective >= minHourly - 0.005,
    shortfallEur: Math.max(0, required - gross),
    grossSource: useOverride ? 'driver' : 'default',
  };
}

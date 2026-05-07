/**
 * JSON CLI for the compliance engine. Designed to be invoked from a
 * non-TypeScript host (Flask/Python) via subprocess or HTTP wrapper.
 *
 * Usage:
 *   node dist/cli/engine-cli.js evaluate < input.json > result.json
 *   node dist/cli/engine-cli.js report --locale=pl < result.json > report.json
 *
 * Input shape (`evaluate`):
 *   {
 *     "rules_root": "/abs/path/to/rules",
 *     "time_zone": "Europe/Berlin",
 *     "evaluated_at": "2026-03-01T00:00:00Z",
 *     "driver_id": "DRV-001",
 *     "range": { "start": "...", "end": "..." },
 *     "activity_candidates": [...],
 *     "card_sessions": [...],
 *     "manual_entries": [...],
 *     "events": [...],
 *     "printouts": [...],
 *     "administrative": { downloads:[], inspections:[], retention:[] }
 *   }
 *
 * Output: JSON-serialized EvaluationResult with Date → ISO strings.
 *
 * Exit codes:
 *   0  — success, result on stdout
 *   2  — input parse / schema error (stderr carries detail)
 *   3  — engine invariant error (stderr carries detail)
 */
import { readFileSync } from "node:fs";
import { loadComplianceBundle } from "../loaders/rule-loader.js";
import { normalizeTimeline } from "../normalizers/timeline-normalizer.js";
import { evaluateAll } from "../evaluators/registry.js";
import { buildPdfReport } from "../reporting/pdf-structure.js";
import {
  asDriverId,
  asVehicleId,
  asActivityId,
  type DriverId,
} from "../types/common.js";
import type {
  Activity,
  ActivityCandidate,
} from "../types/activity.js";
import type {
  CardSession,
  ManualEntry,
  Printout,
  TachographEvent,
} from "../types/timeline.js";
import type {
  AdministrativeContext,
  DownloadEvent,
  InspectionRecord,
  RetentionRecord,
} from "../types/administrative.js";

interface EvaluateInput {
  rules_root: string;
  time_zone?: string;
  evaluated_at: string;
  driver_id: string;
  range: { start: string; end: string };
  activity_candidates?: unknown[];
  card_sessions?: unknown[];
  manual_entries?: unknown[];
  events?: unknown[];
  printouts?: unknown[];
  administrative?: {
    downloads?: unknown[];
    inspections?: unknown[];
    retention?: unknown[];
  };
}

const D = (x: unknown): Date => {
  if (typeof x !== "string" || x.length === 0) {
    throw new Error(`expected ISO-8601 date string, got: ${JSON.stringify(x)}`);
  }
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid date: ${x}`);
  }
  return d;
};

const Dnull = (x: unknown): Date | null =>
  x == null ? null : D(x);

function readStdin(): string {
  return readFileSync(0, "utf8");
}

function fail(code: number, message: string): never {
  process.stderr.write(message + "\n");
  process.exit(code);
}

function asActivityCandidate(raw: unknown, idx: number): ActivityCandidate {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`activity_candidates[${idx}] is not an object`);
  }
  const r = raw as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? asActivityId(r.id) : undefined,
    driver_id: asDriverId(String(r.driver_id ?? "")),
    vehicle_id: r.vehicle_id == null ? null : asVehicleId(String(r.vehicle_id)),
    kind: (r.kind ?? "UNKNOWN") as Activity["kind"],
    source: (r.source ?? "CARD") as Activity["source"],
    slot: (r.slot ?? "DRIVER") as Activity["slot"],
    card_inserted: Boolean(r.card_inserted),
    out_of_scope: Boolean(r.out_of_scope),
    ferry_train: Boolean(r.ferry_train),
    start_country: typeof r.start_country === "string" ? r.start_country : null,
    end_country: typeof r.end_country === "string" ? r.end_country : null,
    confidence: typeof r.confidence === "number" ? r.confidence : 1,
    notes: Array.isArray(r.notes) ? (r.notes as string[]) : [],
    start: D(r.start),
    end: D(r.end),
  };
}

function asCardSession(raw: unknown, idx: number): CardSession {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`card_sessions[${idx}] is not an object`);
  }
  const r = raw as Record<string, unknown>;
  return {
    driver_id: asDriverId(String(r.driver_id ?? "")),
    vehicle_id: r.vehicle_id == null ? null : asVehicleId(String(r.vehicle_id)),
    start_country: typeof r.start_country === "string" ? r.start_country : null,
    end_country: typeof r.end_country === "string" ? r.end_country : null,
    start_odometer_km:
      typeof r.start_odometer_km === "number" ? r.start_odometer_km : null,
    end_odometer_km:
      typeof r.end_odometer_km === "number" ? r.end_odometer_km : null,
    start: D(r.start),
    end: D(r.end),
  };
}

function asManualEntry(raw: unknown, idx: number): ManualEntry {
  const r = raw as Record<string, unknown>;
  if (!r) throw new Error(`manual_entries[${idx}] is not an object`);
  return {
    driver_id: asDriverId(String(r.driver_id ?? "")),
    entered_at: D(r.entered_at ?? r.end),
    complete: r.complete !== false,
    notes: Array.isArray(r.notes) ? (r.notes as string[]) : [],
    start: D(r.start),
    end: D(r.end),
  };
}

function asEvent(raw: unknown, idx: number): TachographEvent {
  const r = raw as Record<string, unknown>;
  if (!r) throw new Error(`events[${idx}] is not an object`);
  return {
    driver_id: r.driver_id == null ? null : asDriverId(String(r.driver_id)),
    vehicle_id: r.vehicle_id == null ? null : asVehicleId(String(r.vehicle_id)),
    type: String(r.type ?? "UNKNOWN"),
    begin: D(r.begin),
    end: Dnull(r.end),
    raw_code: typeof r.raw_code === "string" ? r.raw_code : null,
    notes: Array.isArray(r.notes) ? (r.notes as string[]) : [],
  };
}

function asPrintout(raw: unknown, idx: number): Printout {
  const r = raw as Record<string, unknown>;
  if (!r) throw new Error(`printouts[${idx}] is not an object`);
  return {
    driver_id: r.driver_id == null ? null : asDriverId(String(r.driver_id)),
    created_at: D(r.created_at),
    type: String(r.type ?? "UNKNOWN"),
    reason: typeof r.reason === "string" ? r.reason : null,
  };
}

function asAdministrative(raw: unknown): AdministrativeContext {
  const r = (raw as Record<string, unknown>) ?? {};
  const downloads: DownloadEvent[] = (r.downloads as unknown[] | undefined ?? []).map(
    (d, i) => {
      const dr = d as Record<string, unknown>;
      if (!dr) throw new Error(`administrative.downloads[${i}] is not an object`);
      return {
        source: dr.source === "VEHICLE_UNIT" ? "VEHICLE_UNIT" : "CARD",
        driver_id: dr.driver_id == null ? null : asDriverId(String(dr.driver_id)),
        vehicle_id: dr.vehicle_id == null ? null : asVehicleId(String(dr.vehicle_id)),
        downloaded_at: D(dr.downloaded_at),
        file_hash: typeof dr.file_hash === "string" ? dr.file_hash : null,
      };
    },
  );
  const inspections: InspectionRecord[] = (
    r.inspections as unknown[] | undefined ?? []
  ).map((d, i) => {
    const dr = d as Record<string, unknown>;
    if (!dr) throw new Error(`administrative.inspections[${i}] is not an object`);
    return {
      vehicle_id: asVehicleId(String(dr.vehicle_id ?? "")),
      performed_at: D(dr.performed_at),
      workshop_card_id:
        typeof dr.workshop_card_id === "string" ? dr.workshop_card_id : null,
      notes: Array.isArray(dr.notes) ? (dr.notes as string[]) : [],
    };
  });
  const retention: RetentionRecord[] = (
    r.retention as unknown[] | undefined ?? []
  ).map((d, i) => {
    const dr = d as Record<string, unknown>;
    if (!dr) throw new Error(`administrative.retention[${i}] is not an object`);
    return {
      source: dr.source === "VEHICLE_UNIT" ? "VEHICLE_UNIT" : "CARD",
      driver_id: dr.driver_id == null ? null : asDriverId(String(dr.driver_id)),
      vehicle_id: dr.vehicle_id == null ? null : asVehicleId(String(dr.vehicle_id)),
      archived_until: D(dr.archived_until),
      removed_at: Dnull(dr.removed_at),
    };
  });
  return { downloads, inspections, retention };
}

async function cmdEvaluate(): Promise<void> {
  let input: EvaluateInput;
  try {
    input = JSON.parse(readStdin()) as EvaluateInput;
  } catch (err) {
    fail(2, `invalid input JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!input.rules_root) fail(2, "missing rules_root");
  if (!input.driver_id) fail(2, "missing driver_id");
  if (!input.range?.start || !input.range?.end) fail(2, "missing range");

  let bundle;
  try {
    bundle = await loadComplianceBundle(input.rules_root);
  } catch (err) {
    fail(2, `loadComplianceBundle failed: ${err instanceof Error ? err.message : err}`);
  }

  const driver_id: DriverId = asDriverId(input.driver_id);
  let timeline;
  try {
    timeline = normalizeTimeline({
      driver_id,
      range_start: D(input.range.start),
      range_end: D(input.range.end),
      activity_candidates: (input.activity_candidates ?? []).map(asActivityCandidate),
      card_sessions: (input.card_sessions ?? []).map(asCardSession),
      manual_entries: (input.manual_entries ?? []).map(asManualEntry),
      events: (input.events ?? []).map(asEvent),
      printouts: (input.printouts ?? []).map(asPrintout),
    });
  } catch (err) {
    fail(3, `normalizeTimeline failed: ${err instanceof Error ? err.message : err}`);
  }

  const result = evaluateAll({
    timeline,
    rules: bundle.rules,
    fines: bundle.fines,
    evaluated_at: D(input.evaluated_at),
    time_zone: input.time_zone ?? "Europe/Berlin",
    administrative: input.administrative ? asAdministrative(input.administrative) : undefined,
  });

  process.stdout.write(JSON.stringify(serialize(result)) + "\n");
}

async function cmdReport(locale: "de" | "en" | "pl"): Promise<void> {
  let result;
  try {
    result = JSON.parse(readStdin());
  } catch (err) {
    fail(2, `invalid input JSON: ${err instanceof Error ? err.message : err}`);
  }
  // Re-hydrate the dates the engine emitted as ISO strings.
  result.evaluated_at = new Date(result.evaluated_at);
  for (const v of result.violations ?? []) {
    v.start_time = new Date(v.start_time);
    v.end_time = new Date(v.end_time);
  }
  const report = buildPdfReport(result, locale);
  process.stdout.write(JSON.stringify(report) + "\n");
}

/** JSON.stringify replacer that ISO-formats Date objects. */
function serialize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (v instanceof Date ? v.toISOString() : v)),
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "evaluate") {
    await cmdEvaluate();
    return;
  }
  if (cmd === "report") {
    const localeArg = process.argv.find((a) => a.startsWith("--locale="));
    const locale = (localeArg?.split("=")[1] ?? "de") as "de" | "en" | "pl";
    if (!["de", "en", "pl"].includes(locale)) {
      fail(2, `unsupported locale: ${locale}`);
    }
    await cmdReport(locale);
    return;
  }
  fail(2, `unknown command: ${cmd ?? "(none)"}\nusage: engine-cli evaluate | report --locale=pl`);
}

main().catch((err) => fail(3, `fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`));

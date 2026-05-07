import { resolve } from "node:path";
import { loadComplianceBundle } from "../loaders/rule-loader.js";
import { normalizeTimeline } from "../normalizers/timeline-normalizer.js";
import type { EvaluatorContext } from "../evaluators/base.js";
import type { ActivityCandidate } from "../types/activity.js";
import type {
  CardSession,
  ManualEntry,
  Printout,
  TachographEvent,
} from "../types/timeline.js";
import type { AdministrativeContext } from "../types/administrative.js";
import { TEST_DRIVER } from "./builder.js";

export const RULES_ROOT = resolve(__dirname, "..", "..", "..", "rules");

let cache: Awaited<ReturnType<typeof loadComplianceBundle>> | null = null;

export async function loadBundleCached(): Promise<typeof cache> {
  if (cache) return cache;
  cache = await loadComplianceBundle(RULES_ROOT);
  return cache;
}

export interface ScenarioInput {
  range: { start: string | Date; end: string | Date };
  activities?: ActivityCandidate[];
  card_sessions?: CardSession[];
  manual_entries?: ManualEntry[];
  events?: TachographEvent[];
  printouts?: Printout[];
  administrative?: AdministrativeContext;
  evaluated_at?: string | Date;
  time_zone?: string;
}

const D = (x: string | Date): Date => (typeof x === "string" ? new Date(x) : x);

export async function makeScenario(input: ScenarioInput): Promise<EvaluatorContext> {
  const bundle = await loadBundleCached();
  if (!bundle) throw new Error("rule bundle failed to load");
  const timeline = normalizeTimeline({
    driver_id: TEST_DRIVER,
    range_start: D(input.range.start),
    range_end: D(input.range.end),
    activity_candidates: input.activities ?? [],
    card_sessions: input.card_sessions ?? [],
    manual_entries: input.manual_entries ?? [],
    events: input.events ?? [],
    printouts: input.printouts ?? [],
  });
  return {
    timeline,
    rules: bundle.rules,
    fines: bundle.fines,
    evaluated_at: D(input.evaluated_at ?? "2026-03-01T00:00:00Z"),
    time_zone: input.time_zone ?? "Europe/Berlin",
    administrative: input.administrative,
  };
}

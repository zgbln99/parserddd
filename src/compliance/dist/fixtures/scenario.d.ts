import { loadComplianceBundle } from "../loaders/rule-loader.js";
import type { EvaluatorContext } from "../evaluators/base.js";
import type { ActivityCandidate } from "../types/activity.js";
import type { CardSession, ManualEntry, Printout, TachographEvent } from "../types/timeline.js";
import type { AdministrativeContext } from "../types/administrative.js";
export declare const RULES_ROOT: string;
declare let cache: Awaited<ReturnType<typeof loadComplianceBundle>> | null;
export declare function loadBundleCached(): Promise<typeof cache>;
export interface ScenarioInput {
    range: {
        start: string | Date;
        end: string | Date;
    };
    activities?: ActivityCandidate[];
    card_sessions?: CardSession[];
    manual_entries?: ManualEntry[];
    events?: TachographEvent[];
    printouts?: Printout[];
    administrative?: AdministrativeContext;
    evaluated_at?: string | Date;
    time_zone?: string;
}
export declare function makeScenario(input: ScenarioInput): Promise<EvaluatorContext>;
export {};
//# sourceMappingURL=scenario.d.ts.map
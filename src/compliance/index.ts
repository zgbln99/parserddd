/**
 * Public entry point for the compliance engine.
 *
 * Consumers should use this module ONLY — internal modules are subject to
 * refactor without notice.
 */

export * from "./types/index.js";

export {
  loadComplianceBundle,
  loadFineSetFile,
  loadRuleSetFile,
  RuleLoadError,
  buildFineIndex,
  buildRuleIndex,
} from "./loaders/rule-loader.js";

export {
  validateFineSet,
  validateRuleSet,
  formatIssues,
} from "./validators/schema-validator.js";

export {
  normalizeTimeline,
  TimelineInvariantError,
} from "./normalizers/timeline-normalizer.js";
export type { NormalizerInput } from "./normalizers/timeline-normalizer.js";

export {
  buildDriverDays,
  buildDriverWeeks,
  rollingTwoWeekDriving,
} from "./calculations/weekly.js";

export {
  durationMinutes,
  sumMinutes,
  overlaps,
  intersect,
  contains,
  findGaps,
  sortIntervals,
} from "./calculations/time.js";

export {
  splitDrivingSegments,
  maxContinuousDrivingMinutes,
} from "./calculations/continuous-driving.js";

export {
  mergeActivities,
  fillGapsAsUnknown,
} from "./calculations/activity-merge.js";

export {
  ENGINE_VERSION,
  buildViolation,
  combineEvaluations,
  ruleSetVersionFor,
} from "./evaluators/base.js";
export type { Evaluator, EvaluatorContext } from "./evaluators/base.js";

export {
  DEFAULT_EVALUATORS,
  evaluateAll,
} from "./evaluators/registry.js";

export { countryEntryEvaluator } from "./evaluators/country-entry.js";
export { manualEntryEvaluator } from "./evaluators/manual-entry.js";

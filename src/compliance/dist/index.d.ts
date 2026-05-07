/**
 * Public entry point for the compliance engine.
 *
 * Consumers should use this module ONLY — internal modules are subject to
 * refactor without notice.
 */
export * from "./types/index.js";
export { loadComplianceBundle, loadFineSetFile, loadRuleSetFile, RuleLoadError, buildFineIndex, buildRuleIndex, } from "./loaders/rule-loader.js";
export { validateFineSet, validateRuleSet, formatIssues, } from "./validators/schema-validator.js";
export { normalizeTimeline, TimelineInvariantError, } from "./normalizers/timeline-normalizer.js";
export type { NormalizerInput } from "./normalizers/timeline-normalizer.js";
export { buildDriverDays, buildDriverWeeks, rollingTwoWeekDriving, } from "./calculations/weekly.js";
export { durationMinutes, sumMinutes, overlaps, intersect, contains, findGaps, sortIntervals, } from "./calculations/time.js";
export { splitDrivingSegments, maxContinuousDrivingMinutes, } from "./calculations/continuous-driving.js";
export { mergeActivities, fillGapsAsUnknown, } from "./calculations/activity-merge.js";
export { ENGINE_VERSION, buildViolation, combineEvaluations, ruleSetVersionFor, } from "./evaluators/base.js";
export type { Evaluator, EvaluatorContext } from "./evaluators/base.js";
export { DEFAULT_EVALUATORS, evaluateAll, } from "./evaluators/registry.js";
export { countryEntryEvaluator } from "./evaluators/country-entry.js";
export { manualEntryEvaluator } from "./evaluators/manual-entry.js";
export { cardEvaluator } from "./evaluators/card.js";
export { activitySelectionEvaluator } from "./evaluators/activity-selection.js";
export { drivingTimeEvaluator } from "./evaluators/driving-time.js";
export { breakAfter4h30Evaluator } from "./evaluators/break-4h30.js";
export { restEvaluator } from "./evaluators/rest.js";
export { workingTimeEvaluator } from "./evaluators/working-time.js";
export { downloadsEvaluator } from "./evaluators/downloads.js";
export { eventsFaultsEvaluator } from "./evaluators/events-faults.js";
export { findRestRuns, longestRestWithin } from "./calculations/rest-windows.js";
export { summarizeViolations, groupViolations, violationToRow, } from "./reporting/summary.js";
export type { ViolationSummary, GroupedViolations, ViolationRow, } from "./reporting/summary.js";
export { buildPdfReport, } from "./reporting/pdf-structure.js";
export type { PdfReport, PdfSection, } from "./reporting/pdf-structure.js";
export { signViolation, disputeViolation, correctViolation, hashViolation, canonicalize, WorkflowError, } from "./signatures/workflow.js";
export type { SignArgs, SignResult, DisputeArgs, CorrectionArgs, } from "./signatures/workflow.js";
export { AuditLog } from "./audit/log.js";
export type { ChainedAuditLogEntry } from "./audit/log.js";
//# sourceMappingURL=index.d.ts.map
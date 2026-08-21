/** Priority slice — public surface. engine.ts is the only intended caller. */
export { buildSitemapPathSet, buildImportanceIndex } from "./importance";
export type { ImportanceIndexResult } from "./importance";
export { SEVERITY_WEIGHT, priorityFor, computeFindings, buildRuleStatusDetail } from "./priority";
export type { ComputeFindingsInput, BuildRuleStatusDetailInput } from "./priority";
export { computeWorstPages } from "./worstPages";
export type { ComputeWorstPagesInput } from "./worstPages";
export { siteKeyFromStartUrl, loadSiteMutes, muteRule, unmuteRule } from "./muteStore";
export type {
  AnalysisReportExtension,
  FindingReport,
  FindingStatus,
  MuteRecord,
  PageImportanceResult,
  PriorityFactors,
  RuleErrorDetail,
  RuleMetaById,
  SkippedRuleDetail,
  WorstPageEntry,
} from "./types";

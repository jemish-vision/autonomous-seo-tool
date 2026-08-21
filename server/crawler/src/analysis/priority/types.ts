/**
 * Priority slice — types only. Kept out of ../../models/types.ts (contended by concurrent
 * agents) per the pattern automation/classification.ts already proved: own metadata lives in
 * this directory, keyed by rule id, and the report is extended by intersection in engine.ts
 * rather than by editing AnalysisReport. Zero lines touched in models/types.ts.
 */
import type { IssueSeverity, RuleMeta } from "../../models/types";
import type { AutomationLevel, DetectionTier, EffortLevel } from "../automation/types";

export type FindingStatus = "failing" | "passed" | "skipped-data-unavailable" | "errored" | "muted";

/** All four multiplicands of Kishan's priority formula, each 0..1 and independently shown —
 * a priority number nobody can decompose is a magic number. */
export interface PriorityFactors {
  severity: number;
  reach: number;
  importance: number;
  confidence: number;
}

/** Rule-level rollup for one crawl — mirrors packages/db/prisma/schema.prisma's Finding model
 * field-for-field (priority/reach/importance/effort/automation/priorityFactors), so whatever
 * process later loads this into Postgres has a 1:1 source. */
export interface FindingReport {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  severity: IssueSeverity;
  status: FindingStatus;
  affectedPages: number;
  affectedInstances: number;
  evaluatedPages: number;
  reach: number | null;
  importance: number | null;
  confidence: number | null;
  priority: number;
  priorityFactors: PriorityFactors | null;
  /** weight(severity) * sqrt(affectedPages/evaluatedPages) — same number the health score charges
   * this rule, so "why is my score X" and "why is this finding priority Y" read off one figure. */
  damage: number | null;
  effort: EffortLevel;
  effortWhy: string;
  automation: AutomationLevel;
  detectionTier: DetectionTier;
  automationReviewed: boolean;
  /** RuleMeta.description, as-is — already the "why this matters" text (see engine.ts comment on
   * the RuleMeta blocker: description already serves this role, no new field needed). */
  why: string;
  howToFix: string;
  sampleUrls: string[];
  skipReason: string | null;
  errorNote: string | null;
  mutedAt: string | null;
  mutedNote: string | null;
}

export interface PageImportanceResult {
  pageId: string;
  /** 0..1, never 0 — see importance.ts's doc comment on the no-graph fallback. */
  score: number;
  source: "pagerank" | "fallback-depth-inlinks";
  components: { rank: number; depth: number; inlinks: number; sitemap: number };
}

export interface WorstPageEntry {
  pageId: string;
  url: string;
  /** Sum of severityWeight(issue) * confidence(rule) across the page's own (non-muted) issues. */
  harm: number;
  issueCount: number;
  topRuleIds: string[];
}

export interface MuteRecord {
  ruleId: string;
  note: string | null;
  mutedBy: string | null;
  mutedAt: string;
  expiresAt: string | null;
}

/** {ruleId, pageCount, missing} is the documented shape the dashboard's /issues/rules-run
 * endpoint expects; category/scope are additive extras a consumer can ignore. */
export interface SkippedRuleDetail {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  pageCount: number;
  missing: string[];
}

export interface RuleErrorDetail {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  message: string;
  pageCount: number;
}

/** Additive-only extension of AnalysisReport, merged by intersection in engine.ts — the report
 * type itself in ../../models/types.ts is never edited. */
export interface AnalysisReportExtension {
  findings: FindingReport[];
  worstPages: WorstPageEntry[];
  rulesErrored: string[];
  rulesErroredDetail: RuleErrorDetail[];
  rulesSkippedDetail: SkippedRuleDetail[];
  mutedRuleIds: string[];
  graphAvailable: boolean;
}

export type RuleMetaById = Map<string, RuleMeta>;

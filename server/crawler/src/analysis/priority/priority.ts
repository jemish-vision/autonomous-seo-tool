/**
 * Kishan's four-factor priority (server/index.js priorityOf, lines ~1042-1088): severity is a
 * property of the RULE; priority is a property of THIS crawl. severity x reach x importance x
 * confidence, each 0-1, every factor exposed on the finding because an unexplainable ranking is
 * an unranked ranking.
 *
 * Confidence and automation/effort are READ, never re-derived, from
 * ../automation/{registry,effort}.ts — that module hand-reviewed all 105 rules; this file is not
 * a second opinion on it.
 */
import type { Issue, IssueSeverity, RuleMeta } from "../../models/types";
import { deriveEffort } from "../automation/effort";
import { buildCatalogMap, type CatalogEntry } from "../automation/registry";
import type {
  FindingReport,
  FindingStatus,
  MuteRecord,
  PageImportanceResult,
  PriorityFactors,
  RuleErrorDetail,
  RuleMetaById,
  SkippedRuleDetail,
} from "./types";

/** Kishan's critical/warning/notice weights. This rulebook's highest tier is "error" (there is
 * no separate "critical"), so error stands in for his critical. */
export const SEVERITY_WEIGHT: Record<IssueSeverity, number> = { error: 1, warning: 0.6, notice: 0.3 };

const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 0, warning: 1, notice: 2 };

export function priorityFor(input: {
  severity: IssueSeverity;
  scope: "page" | "site";
  affectedPages: number;
  evaluatedPages: number;
  importance: number;
  confidence: number;
}): { priority: number; reach: number; factors: PriorityFactors } {
  const sev = SEVERITY_WEIGHT[input.severity];
  // Square-rooted so one finding on 500 pages still registers instead of rounding to nothing,
  // while a finding on every page still outranks it. Site rules describe the whole site, reach 1.
  const reach =
    input.scope === "site" ? 1 : Math.sqrt(Math.min(1, input.affectedPages / Math.max(1, input.evaluatedPages)));
  const priority = Math.round(100 * sev * reach * input.importance * input.confidence);
  return {
    priority,
    reach,
    factors: {
      severity: Number(sev.toFixed(2)),
      reach: Number(reach.toFixed(2)),
      importance: Number(input.importance.toFixed(2)),
      confidence: Number(input.confidence.toFixed(2)),
    },
  };
}

export interface ComputeFindingsInput {
  issues: Issue[];
  ruleMetaById: RuleMetaById;
  evaluatedPagesByRule: Map<string, number>;
  urlToPageId: Map<string, string>;
  pagesAnalyzed: number;
  importanceIndex: Map<string, PageImportanceResult>;
  meanImportance: number;
  damageByRule: Map<string, number>;
  mutes: Map<string, MuteRecord>;
  erroredRuleIds: Set<string>;
}

function resolvePageId(issue: Issue, urlToPageId: Map<string, string>): string {
  return issue.pageId ?? (issue.url ? urlToPageId.get(issue.url) : undefined) ?? `__unanchored__:${issue.url ?? issue.ruleId}`;
}

/** One FindingReport per rule the run attempted (ran, skipped, errored, or muted) — mirrors
 * Prisma's Finding model, ~one row per rule per crawl. */
export function computeFindings(input: ComputeFindingsInput): FindingReport[] {
  const catalog = buildCatalogMap();

  const issuesByRule = new Map<string, Issue[]>();
  for (const issue of input.issues) {
    const list = issuesByRule.get(issue.ruleId);
    if (list) list.push(issue);
    else issuesByRule.set(issue.ruleId, [issue]);
  }

  const findings: FindingReport[] = [];
  for (const [ruleId, evaluatedPages] of input.evaluatedPagesByRule) {
    const meta: RuleMeta | undefined = input.ruleMetaById.get(ruleId);
    const cat: CatalogEntry | undefined = catalog.get(ruleId);
    const items = issuesByRule.get(ruleId) ?? [];
    const scope: "page" | "site" = cat?.scope ?? "page";
    const category = cat?.category ?? meta?.category ?? "unknown";

    const pageIdSet = new Set<string>();
    for (const issue of items) pageIdSet.add(resolvePageId(issue, input.urlToPageId));
    const affectedPages = pageIdSet.size;
    const affectedInstances = items.length;

    const mute = input.mutes.get(ruleId);
    const errored = input.erroredRuleIds.has(ruleId);

    let status: FindingStatus;
    if (mute) status = "muted";
    else if (affectedPages > 0) status = "failing";
    else if (errored) status = "errored";
    else if (evaluatedPages === 0) status = "skipped-data-unavailable";
    else status = "passed";

    let severity: IssueSeverity = meta?.defaultSeverity ?? cat?.defaultSeverity ?? "notice";
    if (items.length > 0) {
      severity = items.reduce((worst, i) => (SEVERITY_RANK[i.severity] < SEVERITY_RANK[worst] ? i.severity : worst), items[0]!.severity);
    }

    let reach: number | null = null;
    let importance: number | null = null;
    let priority = 0;
    let priorityFactors: PriorityFactors | null = null;
    if (affectedPages > 0) {
      if (scope === "site") {
        importance = input.meanImportance;
      } else {
        let sum = 0;
        for (const pid of pageIdSet) sum += input.importanceIndex.get(pid)?.score ?? input.meanImportance;
        importance = sum / pageIdSet.size;
      }
      const confidence = cat?.confidence ?? 0.7;
      const result = priorityFor({ severity, scope, affectedPages, evaluatedPages: Math.max(evaluatedPages, 1), importance, confidence });
      reach = result.reach;
      priority = result.priority;
      priorityFactors = result.factors;
    }

    const automation = cat?.automation ?? "human-only";
    const effort = deriveEffort({ automation, scope, affectedPages, pagesAnalyzed: input.pagesAnalyzed });

    const sampleUrls = [...new Set(items.map((i) => i.url).filter((u): u is string => u !== null))].slice(0, 5);

    findings.push({
      ruleId,
      category,
      scope,
      severity,
      status,
      affectedPages,
      affectedInstances,
      evaluatedPages,
      reach,
      importance,
      confidence: cat?.confidence ?? null,
      priority,
      priorityFactors,
      damage: input.damageByRule.get(ruleId) ?? null,
      effort: effort.level,
      effortWhy: effort.why,
      automation,
      detectionTier: cat?.tier ?? "heuristic",
      automationReviewed: cat?.reviewed ?? false,
      why: meta?.description ?? cat?.rationale ?? "",
      howToFix: meta?.howToFix ?? "",
      sampleUrls,
      skipReason: status === "skipped-data-unavailable" ? `no page in this run had the data ${ruleId} needs` : null,
      errorNote: errored ? "one or more pages threw during evaluation — see rulesErroredDetail" : null,
      mutedAt: mute?.mutedAt ?? null,
      mutedNote: mute?.note ?? null,
    });
  }

  findings.sort((a, b) => b.priority - a.priority || a.ruleId.localeCompare(b.ruleId));
  return findings;
}

export interface BuildRuleStatusDetailInput {
  evaluatedPagesByRule: Map<string, number>;
  ruleMetaById: RuleMetaById;
  /** ruleId -> {message, pageCount} for rules that threw during evaluate() at least once. */
  erroredRuleInfo: Map<string, { message: string; pageCount: number }>;
  pagesAnalyzed: number;
}

/** Structured companion to the flat rulesSkippedDataUnavailable/rulesErrored lists — a consumer
 * (e.g. the dashboard's /issues/rules-run endpoint) needs which rule, how many pages, and what
 * data was missing, not just a bare id. `missing` is RuleMeta.dataRequirements verbatim: the
 * rule's own declared fields, already exactly "what data was missing". */
export function buildRuleStatusDetail(
  input: BuildRuleStatusDetailInput,
): { skipped: SkippedRuleDetail[]; errored: RuleErrorDetail[] } {
  const catalog = buildCatalogMap();
  const skipped: SkippedRuleDetail[] = [];
  const errored: RuleErrorDetail[] = [];

  for (const [ruleId, evaluatedPages] of input.evaluatedPagesByRule) {
    const cat = catalog.get(ruleId);
    const meta = input.ruleMetaById.get(ruleId);
    const scope: "page" | "site" = cat?.scope ?? "page";
    const category = cat?.category ?? meta?.category ?? "unknown";
    const err = input.erroredRuleInfo.get(ruleId);

    if (err) {
      errored.push({ ruleId, category, scope, message: err.message, pageCount: err.pageCount });
    } else if (evaluatedPages === 0) {
      skipped.push({ ruleId, category, scope, pageCount: input.pagesAnalyzed, missing: meta?.dataRequirements ?? [] });
    }
  }

  skipped.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  errored.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  return { skipped, errored };
}

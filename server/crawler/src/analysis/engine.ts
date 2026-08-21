/** Slice A3 implements. Priority/importance/effort/automation wave (./priority/) is additive
 * only — see AnalysisReportExtension in ./priority/types.ts. Nothing in ../models/types.ts was
 * touched to ship it. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AnalysisReport,
  CrawledPage,
  CrawlSummary,
  FailureRecord,
  GraphReport,
  Issue,
  IssueSeverity,
  RobotsEvidence,
  SitemapResult,
} from "../models/types";
import type { AnalysisConfig } from "./config";
import { pageRules } from "./rules/page/index";
import { siteRules } from "./rules/site/index";
import { writeIssues } from "./store";
import { computeGraph } from "../graph/pagerank";
import {
  buildImportanceIndex,
  buildRuleStatusDetail,
  computeFindings,
  computeWorstPages,
  loadSiteMutes,
  siteKeyFromStartUrl,
} from "./priority";
import type { AnalysisReportExtension, MuteRecord, PageImportanceResult, RuleMetaById } from "./priority/types";

async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return fallback;
    throw err;
  }
}

interface PageEntry {
  page: CrawledPage;
  /** Derived from the pages/<pageId>.json filename — pageId is never stored on the record itself. */
  pageId: string;
}

async function readPages(runDir: string): Promise<PageEntry[]> {
  const pagesDir = path.join(runDir, "pages");
  let files: string[];
  try {
    files = await readdir(pagesDir);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return [];
    throw err;
  }
  const entries: PageEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const page = JSON.parse(await readFile(path.join(pagesDir, file), "utf-8")) as CrawledPage;
    entries.push({ page, pageId: file.slice(0, -".json".length) });
  }
  return entries;
}

function isRuleEnabled(ruleId: string, config: AnalysisConfig): boolean {
  return config.rules[ruleId]?.enabled !== false;
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, notice: 2 };

/** Stable ordering: severity -> ruleId -> url, so the same run + config always produce byte-identical issues.json. */
function compareIssues(a: Issue, b: Issue): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  const au = a.url ?? "";
  const bu = b.url ?? "";
  if (au !== bu) return au < bu ? -1 : 1;
  return 0;
}

interface HealthWeights {
  error: number;
  warning: number;
  notice: number;
  /** Total damage at which the score halves — the saturation constant. */
  halfScoreDamage: number;
}

const DEFAULT_HEALTH_WEIGHTS: HealthWeights = { error: 10, warning: 3, notice: 1, halfScoreDamage: 10 };

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Read off thresholds (the only config branch loadConfig merges) and defaulted per-key, so a
 * config file written before the weights existed still scores. */
function healthWeights(config: AnalysisConfig): HealthWeights {
  const t: Record<string, number | undefined> = config.thresholds;
  return {
    error: positiveOr(t.healthErrorWeight, DEFAULT_HEALTH_WEIGHTS.error),
    warning: positiveOr(t.healthWarningWeight, DEFAULT_HEALTH_WEIGHTS.warning),
    notice: positiveOr(t.healthNoticeWeight, DEFAULT_HEALTH_WEIGHTS.notice),
    halfScoreDamage: positiveOr(t.healthHalfScoreDamage, DEFAULT_HEALTH_WEIGHTS.halfScoreDamage),
  };
}

export interface HealthContribution {
  ruleId: string;
  /** Worst severity the rule emitted — one error makes the whole check an error-weight failure. */
  severity: IssueSeverity;
  affectedPages: number;
  evaluatedPages: number;
  reach: number;
  damage: number;
}

export interface HealthScoreDetail {
  score: number;
  totalDamage: number;
  /** Highest damage first, so "why is the score this" is answerable from the top few rows. */
  contributions: HealthContribution[];
}

import { computeTransparentHealthScore } from "./score";

/** Category-weighted transparent health score, 0-100. */
export function computeHealthScoreDetail(
  issues: Issue[],
  evaluatedPagesByRule: Map<string, number>,
  urlToPageId: Map<string, string>,
  config: AnalysisConfig,
): HealthScoreDetail {
  const result = computeTransparentHealthScore(issues, evaluatedPagesByRule, urlToPageId);
  return {
    score: result.score,
    totalDamage: result.totalDamage,
    contributions: result.contributions,
  };
}

export function computeHealthScore(
  issues: Issue[],
  evaluatedPagesByRule: Map<string, number>,
  urlToPageId: Map<string, string>,
  config: AnalysisConfig,
): number {
  return computeHealthScoreDetail(issues, evaluatedPagesByRule, urlToPageId, config).score;
}

/** Report shape actually returned by runAnalysis: the original AnalysisReport plus the priority
 * wave's additive fields. writeIssues/readIssues still type against plain AnalysisReport — a
 * wider object satisfies a narrower parameter structurally, so nothing downstream needed to
 * change to keep receiving (and persisting) the extra fields. */
export type PriorityAnalysisReport = AnalysisReport & AnalysisReportExtension;

/**
 * Run the full rulebook (page rules + site passes) over a stored run directory and return the
 * assembled report (already persisted via store.writeIssues). Deterministic: same run + same
 * config → byte-identical issues (generatedAt aside).
 */
export async function runAnalysis(runDir: string, config: AnalysisConfig): Promise<PriorityAnalysisReport> {
  const pageEntries = await readPages(runDir);
  const failures = await readJsonSafe<FailureRecord[]>(path.join(runDir, "failures.json"), []);
  const blocked = await readJsonSafe<string[]>(path.join(runDir, "blocked.json"), []);
  const sitemap = await readJsonSafe<SitemapResult | null>(path.join(runDir, "sitemaps.json"), null);
  const robots = await readJsonSafe<RobotsEvidence | null>(path.join(runDir, "robots.json"), null);
  const summary = await readJsonSafe<CrawlSummary | null>(path.join(runDir, "report.json"), null);

  const urlToPageId = new Map<string, string>();
  for (const { page, pageId } of pageEntries) {
    urlToPageId.set(page.url, pageId);
    if (page.finalUrl) urlToPageId.set(page.finalUrl, pageId);
  }

  const issues: Issue[] = [];
  // Per-rule count of pages the rule could actually read. Drives both the score's reach
  // denominator and the skipped list, so a rule blind on one page is not dropped from either.
  const evaluatedPagesByRule = new Map<string, number>();
  // ruleId -> RuleMeta, built once here from the exact rule objects this run used — findings.ts
  // reads description/howToFix/dataRequirements off it rather than re-importing the registries.
  const ruleMetaById: RuleMetaById = new Map();
  // A throw inside any single rule.evaluate() must never abort the run (FR: one unguarded
  // dereference used to take out the whole analysis). Caught, excluded from the score
  // denominator exactly like a null result, and recorded here instead of silently swallowed.
  const erroredRuleInfo = new Map<string, { message: string; pageCount: number }>();
  function recordPageRuleError(ruleId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const prev = erroredRuleInfo.get(ruleId);
    if (prev) prev.pageCount += 1;
    else erroredRuleInfo.set(ruleId, { message, pageCount: 1 });
  }
  let rulesRun = 0;

  const rules = pageRules();
  for (const rule of rules) {
    ruleMetaById.set(rule.meta.id, rule.meta);
    if (!isRuleEnabled(rule.meta.id, config)) continue;
    rulesRun++;
    let evaluated = 0;
    for (const { page, pageId } of pageEntries) {
      let result: Issue[] | null;
      try {
        result = rule.evaluate(page, config);
      } catch (err) {
        recordPageRuleError(rule.meta.id, err);
        continue; // treated as data-unavailable for this page — never aborts the run
      }
      if (result === null) continue;
      evaluated++;
      for (const issue of result) {
        issue.pageId = issue.pageId ?? pageId;
        issues.push(issue);
      }
    }
    evaluatedPagesByRule.set(rule.meta.id, evaluated);
  }

  try {
    const siteRuleList = siteRules();
    const ctx = {
      pages: pageEntries.map((e) => e.page),
      failures,
      blocked,
      sitemap,
      robots,
      summary,
    };
    for (const rule of siteRuleList) {
      ruleMetaById.set(rule.meta.id, rule.meta);
      if (!isRuleEnabled(rule.meta.id, config)) continue;
      rulesRun++;
      evaluatedPagesByRule.set(rule.meta.id, 0);
      let result: Issue[] | null;
      try {
        result = rule.evaluate(ctx, config);
      } catch (err) {
        // A4's siteRules()/store.ts may still be a stub during A3's own dev/test cycle — proceed
        // page-only rather than block; integration wires the real implementation.
        if (err instanceof Error && err.message.startsWith("stub:")) {
          console.warn(`[analysis] site rule ${rule.meta.id} unavailable (${err.message}) — skipping`);
          continue;
        }
        erroredRuleInfo.set(rule.meta.id, {
          message: err instanceof Error ? err.message : String(err),
          pageCount: Math.max(pageEntries.length, 1),
        });
        continue; // one site rule crashing must not take out the rest of the site pass
      }
      if (result === null) continue;
      // A site rule sees the whole crawl in one call, so its reach denominator is the crawl itself.
      evaluatedPagesByRule.set(rule.meta.id, Math.max(pageEntries.length, 1));
      // Loop, never spread: a site rule on a 1k+-page run can return enough issues that
      // spreading them as call arguments overflows the stack (hit live on books.toscrape).
      for (const issue of result) issues.push(issue);
    }
  } catch (err) {
    // siteRules() itself (not any one rule) failing to even build its list — proceed page-only.
    if (err instanceof Error && err.message.startsWith("stub:")) {
      console.warn(`[analysis] site rules unavailable (${err.message}) — proceeding page-only`);
    } else {
      throw err;
    }
  }

  issues.sort(compareIssues);

  const counts: Record<IssueSeverity, number> = { error: 0, warning: 0, notice: 0 };
  for (const issue of issues) counts[issue.severity]++;

  const pagesAnalyzed = pageEntries.length;

  // --- Priority wave: PageRank, page importance, per-rule priority, worst pages, mutes ---

  // PageRank as part of normal analysis (previously only ~2 of ~102 runs ever had one, because
  // nothing called the graph pass). Pure computeGraph() + a direct write into runDir — NOT
  // ensureGraphReport()'s outDir/runId resolution, which assumes runDir already IS
  // "<outDir>/runs/<runId>" and silently resolves to the wrong path otherwise (true for every
  // unit-test temp dir in this repo). Same algorithm, same output shape, correct path always.
  let graphReport: GraphReport | null = null;
  try {
    graphReport = computeGraph(pageEntries.map((e) => e.page), path.basename(runDir));
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "graph.json"), JSON.stringify(graphReport, null, 2), "utf8");
  } catch (err) {
    console.warn(
      `[analysis] graph pass failed (${err instanceof Error ? err.message : String(err)}) — page importance falls back to depth+inlinks`,
    );
    graphReport = null;
  }

  // Same never-crash-the-run discipline as the graph pass above: a malformed legacy page record
  // could in principle make the fallback (raw link-scanning) path throw too.
  let importanceIndex: Map<string, PageImportanceResult>;
  let meanImportance: number;
  try {
    const result = buildImportanceIndex(pageEntries, graphReport, sitemap);
    importanceIndex = result.index;
    meanImportance = result.meanImportance;
  } catch (err) {
    console.warn(
      `[analysis] page-importance pass failed (${err instanceof Error ? err.message : String(err)}) — using a neutral 0.5 default`,
    );
    importanceIndex = new Map(
      pageEntries.map((e) => [
        e.pageId,
        { pageId: e.pageId, score: 0.5, source: "fallback-depth-inlinks" as const, components: { rank: 0, depth: 0.5, inlinks: 0.5, sitemap: 1 } },
      ]),
    );
    meanImportance = 0.5;
  }

  // Mutes are keyed per SITE (start-URL host), not per run, so they survive re-crawls. Only
  // trusted when runDir actually sits at "<storageRoot>/runs/<runId>" (true in production via
  // cli.ts) — otherwise mutes are (correctly) empty rather than guessing a path.
  const siteKey = siteKeyFromStartUrl(summary?.startUrl);
  const runsParent = path.basename(path.dirname(runDir)) === "runs";
  const storageRoot = runsParent ? path.resolve(runDir, "..", "..") : null;
  const mutes: Map<string, MuteRecord> = storageRoot ? await loadSiteMutes(storageRoot, siteKey) : new Map();

  // damage per rule, from the FULL (unmuted) issue set — even a muted finding still shows the
  // damage it would otherwise cost, matching "it still runs, still counts as muted".
  const fullHealthDetail = computeHealthScoreDetail(issues, evaluatedPagesByRule, urlToPageId, config);
  const damageByRule = new Map(fullHealthDetail.contributions.map((c) => [c.ruleId, c.damage] as const));

  // Applied AFTER findings are computed: the score and totals recompute, the finding itself
  // never disappears (status flips to "muted" inside computeFindings instead).
  const scorableIssues = mutes.size > 0 ? issues.filter((i) => !mutes.has(i.ruleId)) : issues;
  const healthScore = computeHealthScore(scorableIssues, evaluatedPagesByRule, urlToPageId, config);

  const findings = computeFindings({
    issues,
    ruleMetaById,
    evaluatedPagesByRule,
    urlToPageId,
    pagesAnalyzed,
    importanceIndex,
    meanImportance,
    damageByRule,
    mutes,
    erroredRuleIds: new Set(erroredRuleInfo.keys()),
  });

  const pageUrlById = new Map(pageEntries.map((e) => [e.pageId, e.page.finalUrl ?? e.page.url]));
  const worstPages = computeWorstPages({
    issues: scorableIssues,
    urlToPageId,
    pageUrlById,
    mutedRuleIds: new Set(mutes.keys()),
  });

  const { skipped: rulesSkippedDetail, errored: rulesErroredDetail } = buildRuleStatusDetail({
    evaluatedPagesByRule,
    ruleMetaById,
    erroredRuleInfo,
    pagesAnalyzed,
  });

  const report: PriorityAnalysisReport = {
    runId: path.basename(runDir),
    generatedAt: new Date().toISOString(),
    rulebookVersion: config.rulebookVersion,
    configSnapshot: config,
    healthScore,
    pagesAnalyzed,
    counts,
    rulesRun,
    rulesSkippedDataUnavailable: rulesSkippedDetail.map((s) => s.ruleId).sort(),
    issues,
    findings,
    worstPages,
    rulesErrored: [...erroredRuleInfo.keys()].sort(),
    rulesErroredDetail,
    rulesSkippedDetail,
    mutedRuleIds: [...mutes.keys()].sort(),
    graphAvailable: graphReport !== null,
  };

  try {
    await writeIssues(runDir, report);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("stub:")) {
      console.warn(`[analysis] writeIssues unavailable (${err.message}) — report computed but not persisted`);
    } else {
      throw err;
    }
  }

  return report;
}

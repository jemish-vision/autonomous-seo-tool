/**
 * Automation report — the per-rule auto-safe / auto-with-review / human-only classification the
 * old app read from automation-report.json (poc/seo-crawler-poc/src/analysis/automation/report.ts,
 * lib/data-issue-extras.ts).
 *
 *   GET /api/crawls/:runId/automation  ->  AutomationReport
 *
 * Derive-on-read, no new table: the automation tier / effort / confidence / detection tier for
 * every rule already live on the crawl's stored findings (Finding table, written by the analysis
 * pipeline that owns the hand-reviewed classification). This endpoint reconstructs the exact
 * AutomationReport shape the client expects (client/src/lib/data-issue-extras.ts) by grouping the
 * run's issues by rule (like the old buildAutomationReport, which iterated issues) and joining the
 * per-rule finding onto each group. A rule that fired issues but has no finding falls back to the
 * conservative human-only default, never to auto-safe.
 *
 * If the run has no analysis at all, an empty-but-well-formed report (zero counts, empty rules) is
 * returned — the Issues UI already degrades to "not classified" when the rules list is empty.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbReadCrawlAnalysis, type AnalysisFindingRow, type AnalysisIssueRow } from "../../db/src/crawl/readStore.js";
import { isSafeId } from "../../lib/apiShared.js";

type AutomationLevel = "auto-safe" | "auto-with-review" | "human-only";

/** Confidence is a function of detection tier alone (never hand-tuned per rule) — ported verbatim
 *  from poc/seo-crawler-poc/src/analysis/automation/types.ts TIER_CONFIDENCE. */
const TIER_CONFIDENCE: Record<"observed" | "derived" | "heuristic", number> = {
  observed: 1,
  derived: 0.9,
  heuristic: 0.7,
};

interface RuleAutomationSummary {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  automation: AutomationLevel;
  confidence: number;
  reviewed: boolean;
  rationale: string;
  affectedPages: number;
  instances: number;
  effort: { level: "low" | "medium" | "high"; why: string };
}

/** Health-score-style dedup key: pageId, falling back to url, falling back to an unanchored bucket
 *  (mirrors report.ts affectedKey). */
function affectedKey(issue: AnalysisIssueRow, ruleId: string): string {
  return issue.pageId ?? issue.url ?? `unanchored:${ruleId}`;
}

export const automationRouter = Router();

automationRouter.get(
  "/:runId/automation",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    const report = await dbReadCrawlAnalysis(prisma, runId);
    if (!report) {
      // No analysis for this run — return the same clean, well-formed empty report the UI degrades on.
      res.json({
        runId,
        generatedAt: new Date().toISOString(),
        pagesAnalyzed: 0,
        counts: { "auto-safe": 0, "auto-with-review": 0, "human-only": 0 },
        rules: [],
        unreviewedRuleIds: [],
      });
      return;
    }

    const findingByRule = new Map<string, AnalysisFindingRow>((report.findings ?? []).map((f) => [f.ruleId, f]));

    // Group issues by rule (only rules that actually fired, matching the old report generator).
    const byRule = new Map<string, AnalysisIssueRow[]>();
    for (const issue of report.issues) {
      const list = byRule.get(issue.ruleId);
      if (list) list.push(issue);
      else byRule.set(issue.ruleId, [issue]);
    }

    const rules: RuleAutomationSummary[] = [];
    const counts: Record<AutomationLevel, number> = { "auto-safe": 0, "auto-with-review": 0, "human-only": 0 };
    const unreviewedRuleIds: string[] = [];

    for (const [ruleId, issues] of byRule) {
      const finding = findingByRule.get(ruleId);
      const first = issues[0]!;
      const scope = finding?.scope ?? first.scope;
      // No finding for this rule => it wasn't classified => conservative human-only default (never auto-safe).
      const automation: AutomationLevel = finding?.automation ?? "human-only";
      const tier = finding?.detectionTier ?? "heuristic";
      const confidence = finding?.confidence ?? TIER_CONFIDENCE[tier];
      const reviewed = finding !== undefined;
      const affected = new Set(issues.map((i) => affectedKey(i, ruleId)));

      counts[automation]++;
      if (!reviewed) unreviewedRuleIds.push(ruleId);

      rules.push({
        ruleId,
        category: finding?.category ?? first.category,
        scope,
        automation,
        confidence,
        reviewed,
        rationale: finding?.why ?? "",
        affectedPages: affected.size,
        instances: issues.length,
        effort: { level: finding?.effort ?? "medium", why: finding?.effortWhy ?? "" },
      });
    }

    rules.sort((a, b) => a.ruleId.localeCompare(b.ruleId));

    res.json({
      runId: report.runId,
      generatedAt: report.generatedAt,
      pagesAnalyzed: report.pagesAnalyzed,
      counts,
      rules,
      unreviewedRuleIds: unreviewedRuleIds.sort(),
    });
  }),
);

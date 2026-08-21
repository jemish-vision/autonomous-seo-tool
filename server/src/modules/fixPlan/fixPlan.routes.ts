/**
 * Fix plan — the deterministic per-URL change list the old app generated from a run's issues
 * (poc/seo-crawler-poc/src/analysis/fixplan/generate.ts + builders.ts). Every auto-safe finding is
 * turned into a concrete, computable, reversible change — the plan is NEVER applied here.
 *
 *   GET /api/crawls/:runId/fix-plan  ->  FixPlan  (client/src/lib/types.ts)
 *
 * Derive-on-read, no new table. "Auto-safe" is read off the run's stored findings (Finding table —
 * the same automation classification the automation report uses), then a per-rule builder turns
 * each auto-safe issue into a concrete change from the issue's own evidence. Rules classified
 * auto-safe with no wired builder, or issues with no computable value, are surfaced in `skipped`
 * (never silently dropped).
 *
 * `applied` cross-references this user's recorded applied-fixes (public.applied_fixes): each item
 * carries an `applied` flag reflecting whether a matching fix has been recorded, and the plan-level
 * `applied` is true only when every generated change has already been applied.
 *
 * NOTE on image-missing-dimensions: the old builder read the crawl's MEASURED naturalWidth/Height
 * off the page record. This dashboard's crawl store persists only DECLARED image dimensions (which
 * are null for exactly the images this rule fires on), so those measured values are unavailable —
 * such issues are reported as skips, never guessed.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbReadCrawlAnalysis, type AnalysisFindingRow, type AnalysisIssueRow } from "../../db/src/crawl/readStore.js";
import { isSafeId } from "../../lib/apiShared.js";
import { readAppliedFixes } from "../appliedFixes/appliedFixes.routes.js";

const ITEM_CAP = 500;

interface FixPlanItem {
  rule: string;
  issue: string;
  url: string | null;
  pageId: string | null;
  action: string;
  where: string;
  change: string | string[];
  note: string;
  /** Extra field (beyond the client's FixPlanItem type — harmlessly ignored by older readers):
   *  true when a matching applied-fix has been recorded for this rule+page. */
  applied: boolean;
}

interface FixPlanSkip {
  rule: string;
  url: string | null;
  reason: string;
}

interface BuildResult {
  items: Omit<FixPlanItem, "applied">[];
  skipped: FixPlanSkip[];
}

type EvidenceItem = { field?: string; value?: unknown };

function evidenceOf(issue: AnalysisIssueRow): EvidenceItem[] {
  return Array.isArray(issue.evidence) ? (issue.evidence as EvidenceItem[]) : [];
}

function evidenceValue(issue: AnalysisIssueRow, field: string): unknown {
  return evidenceOf(issue).find((e) => e.field === field)?.value;
}

// ── Per-rule builders (ported from analysis/fixplan/builders.ts) ──────────────────────────────

function canonicalAbsentBuilder(issue: AnalysisIssueRow): BuildResult {
  const self = issue.url;
  if (!self) {
    return { items: [], skipped: [{ rule: issue.ruleId, url: issue.url, reason: "no URL available to self-reference" }] };
  }
  return {
    items: [
      {
        rule: issue.ruleId,
        issue: issue.message,
        url: issue.url,
        pageId: issue.pageId,
        action: "add-tag",
        where: "<head>",
        change: `<link rel="canonical" href="${self}">`,
        note: "self-referencing canonical — the correct value is the page's own URL",
      },
    ],
    skipped: [],
  };
}

function mixedContentBuilder(issue: AnalysisIssueRow): BuildResult {
  const rewrites = evidenceOf(issue)
    .filter((e): e is { field?: string; value: string } => typeof e.value === "string" && e.value.toLowerCase().startsWith("http://"))
    .map((e) => `${e.value} → ${e.value.replace(/^http:/i, "https:")}`);
  if (rewrites.length === 0) {
    return { items: [], skipped: [{ rule: issue.ruleId, url: issue.url, reason: "no http:// subresource URLs found in evidence" }] };
  }
  return {
    items: [
      {
        rule: issue.ruleId,
        issue: issue.message,
        url: issue.url,
        pageId: issue.pageId,
        action: "rewrite-urls",
        where: "subresource URLs",
        change: rewrites,
        note: "the same host already serves this page over TLS",
      },
    ],
    skipped: [],
  };
}

interface RedirectHop {
  from: string;
  to: string;
  statusCode: number;
}

function redirectChainBuilder(issue: AnalysisIssueRow): BuildResult {
  const chain = evidenceValue(issue, "redirectChain") as RedirectHop[] | undefined;
  if (!chain || chain.length === 0) {
    return { items: [], skipped: [{ rule: issue.ruleId, url: issue.url, reason: "no redirectChain evidence on this issue" }] };
  }
  const first = chain[0]!.from;
  const final = chain[chain.length - 1]!.to;
  return {
    items: [
      {
        rule: issue.ruleId,
        issue: issue.message,
        url: issue.url,
        pageId: issue.pageId,
        action: "shorten-redirect",
        where: "server redirect rule",
        change: `${first} → ${final} (currently ${chain.length} hop${chain.length === 1 ? "" : "s"})`,
        note: "point the first URL directly at the final destination",
      },
    ],
    skipped: [],
  };
}

/** Measured pixel dimensions are not persisted in this dashboard's crawl store, so this rule can
 *  never produce a concrete change here — surfaced as a skip, never guessed. */
function imageMissingDimensionsBuilder(issue: AnalysisIssueRow): BuildResult {
  return {
    items: [],
    skipped: [
      {
        rule: issue.ruleId,
        url: issue.url,
        reason: "measured pixel dimensions are not persisted in this dashboard's crawl store — no fix generated (never guessed)",
      },
    ],
  };
}

const FIX_PLAN_BUILDERS: Record<string, (issue: AnalysisIssueRow) => BuildResult> = {
  "canonical-absent": canonicalAbsentBuilder,
  "mixed-content": mixedContentBuilder,
  "image-missing-dimensions": imageMissingDimensionsBuilder,
  "redirect-chain": redirectChainBuilder,
};

// ── Route ─────────────────────────────────────────────────────────────────────────────────────

export const fixPlanRouter = Router();

fixPlanRouter.get(
  "/:runId/fix-plan",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    const report = await dbReadCrawlAnalysis(prisma, runId);
    if (!report) {
      res.json({
        runId,
        generatedAt: new Date().toISOString(),
        applied: false,
        note: "No analysis has been generated for this run yet — run the analyzer first.",
        rules: [],
        totalChanges: 0,
        items: [],
        skipped: [],
      });
      return;
    }

    const findingByRule = new Map<string, AnalysisFindingRow>((report.findings ?? []).map((f) => [f.ruleId, f]));
    const autoSafeIssues = report.issues.filter((i) => findingByRule.get(i.ruleId)?.automation === "auto-safe");

    const rawItems: Omit<FixPlanItem, "applied">[] = [];
    const skipped: FixPlanSkip[] = [];
    const findingsByRule = new Map<string, number>();

    for (const issue of autoSafeIssues) {
      findingsByRule.set(issue.ruleId, (findingsByRule.get(issue.ruleId) ?? 0) + 1);
      const builder = FIX_PLAN_BUILDERS[issue.ruleId];
      if (!builder) {
        skipped.push({ rule: issue.ruleId, url: issue.url, reason: "classified auto-safe but no fix-plan builder is wired for this rule id" });
        continue;
      }
      const result = builder(issue);
      rawItems.push(...result.items);
      skipped.push(...result.skipped);
    }

    // Cross-reference this user's recorded applied-fixes so `applied` reflects reality. Degrades to
    // "nothing applied" when unauthenticated / Supabase unconfigured (readAppliedFixes returns []).
    const appliedFixes = await readAppliedFixes(req.userId, runId);
    const appliedKeys = new Set(appliedFixes.map((f) => `${f.ruleId}::${f.pageId ?? "site"}`));

    const items: FixPlanItem[] = rawItems
      .slice(0, ITEM_CAP)
      .map((it) => ({ ...it, applied: appliedKeys.has(`${it.rule}::${it.pageId ?? "site"}`) }));

    const applied = items.length > 0 && items.every((it) => it.applied);

    res.json({
      runId: report.runId,
      generatedAt: report.generatedAt,
      applied,
      note:
        "These changes are safe to apply automatically — the correct value is computable from data already " +
        "captured, the change is reversible, and the blast radius is one page. This tool does not apply them; " +
        "review and ship through your own deploy path.",
      rules: [...findingsByRule.entries()].map(([id, findings]) => ({ id, findings })),
      totalChanges: rawItems.length,
      items,
      skipped,
    });
  }),
);

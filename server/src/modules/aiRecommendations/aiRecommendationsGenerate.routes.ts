/**
 * POST /api/crawls/:runId/ai-recommendations/generate  { ruleId?, pageId?, top? }
 *
 * Generates AI exact-fix recommendations for a run and PERSISTS them into the AiRecommendation
 * table (the read sibling aiRecommendations.routes.ts serves them back). Supabase-only: the LLM
 * pipeline (server/src/lib/ai-recommend/*) is a port of the old dashboard's lib/ai-recommend with
 * all node:fs disk I/O and the GSC/OpenSERP enrichment stripped — context is built from the run's
 * own crawl data (dbGetCrawlPages) + analysis (dbReadCrawlAnalysis), the provider is Gemini/etc via
 * createProviderFromEnv (GEMINI_API_KEY in server/.env). Nothing is written to disk.
 *
 * Responses:
 *   200  { runId, generatedAt, model, totalGenerated, totalSkipped, totalPersisted, rulesConsidered }
 *   422  invalid runId
 *   404  run has no analysis to generate from
 *   503  no AI provider configured
 *   500  provider was reachable-but-failed for every item (surfaced verbatim, never faked as "0")
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { isSafeId } from "../../lib/apiShared.js";
import { dbReadCrawlAnalysis, dbGetCrawlPages, type AnalysisReportRow, type CrawledPageRow } from "../../db/src/crawl/readStore.js";
import { createProviderFromEnv, hasProviderConfigured } from "../../lib/ai-recommend/provider.js";
import { generateAiRecommendations } from "../../lib/ai-recommend/generate.js";
import type { AnalysisReport, CrawledPageWithId, Issue, IssueEvidence, AiRecommendation } from "../../lib/ai-recommend/types.js";
import type { Prisma } from "../../db/generated/client/index.js";

export const aiRecommendationsGenerateRouter = Router();

// ---------------------------------------------------------------------------
// Adapters: Supabase read-layer rows -> the pipeline's local crawler-domain types
// ---------------------------------------------------------------------------

/** AnalysisIssueRow.evidence is stored JSONB; the pipeline expects {field,value,pageId?}[]. */
function adaptEvidence(raw: unknown[]): IssueEvidence[] {
  if (!Array.isArray(raw)) return [];
  const out: IssueEvidence[] = [];
  for (const e of raw) {
    if (e && typeof e === "object" && "field" in e) {
      const rec = e as Record<string, unknown>;
      out.push({
        field: String(rec.field ?? ""),
        value: rec.value,
        pageId: typeof rec.pageId === "string" ? rec.pageId : undefined,
      });
    }
  }
  return out;
}

function adaptAnalysis(report: AnalysisReportRow): AnalysisReport {
  const issues: Issue[] = report.issues.map((i) => ({
    ruleId: i.ruleId,
    category: i.category,
    severity: i.severity,
    scope: i.scope,
    url: i.url,
    pageId: i.pageId,
    message: i.message,
    howToFix: i.howToFix,
    evidence: adaptEvidence(i.evidence),
  }));
  return { runId: report.runId, issues };
}

/** Map the lossy Supabase page projection into the pipeline's page shape. The parity-gap fields
 *  the sync doesn't yet capture (headMeta, document structure, per-image DOM context) are simply
 *  left undefined — the context builder degrades to "(none)" for them, never fabricates. */
function adaptPages(rows: CrawledPageRow[]): CrawledPageWithId[] {
  return rows.map((p) => ({
    pageId: p.pageId,
    title: p.title,
    metaDescription: p.metaDescription,
    canonical: p.canonical,
    robots: p.robots,
    headings: p.headings,
    links: p.links.map((l) => ({ type: l.type })),
    images: p.images.map((img) => ({ url: img.url, alt: img.alt, width: img.width, height: img.height, format: img.format })),
    videos: p.videos,
    structuredData: p.structuredData.map((sd) => ({ parsed: sd.parsed })),
    content: p.content,
    url: p.url,
    normalizedUrl: p.normalizedUrl,
    finalUrl: p.finalUrl,
    statusCode: p.statusCode,
    performance: p.performance,
    // headMeta / structure: parity gaps — not on the Supabase projection.
  }));
}

// ---------------------------------------------------------------------------
// Persistence: generated recommendations -> AiRecommendation rows
// ---------------------------------------------------------------------------

interface IssueLookupRow {
  id: string;
  ruleSlug: string;
  pageId: string | null;
  evidencePaths: string[];
}

/** Resolve the Issue row a generated recommendation belongs to. Matches on rule slug + page (the
 *  rec's pageId is a pageKey; resolve it to the Page UUID), and for multi-instance rules narrows
 *  to the Issue whose evidencePaths cover the rec's instanceKey (e.g. "images[3]"). Returns null
 *  when no backing Issue exists — such a rec is not persisted (issueId is a required FK). */
function resolveIssueId(
  rec: AiRecommendation,
  issuesByRule: Map<string, IssueLookupRow[]>,
  pageKeyToUuid: Map<string, string>,
): string | null {
  const candidates = issuesByRule.get(rec.issueRuleId);
  if (!candidates || candidates.length === 0) return null;

  const wantPageUuid = rec.pageId ? (pageKeyToUuid.get(rec.pageId) ?? null) : null;
  const pageMatches = candidates.filter((c) => c.pageId === wantPageUuid);
  const pool = pageMatches.length > 0 ? pageMatches : candidates;

  if (rec.instanceKey) {
    const byInstance = pool.find((c) => c.evidencePaths.some((p) => p.startsWith(rec.instanceKey!)));
    if (byInstance) return byInstance.id;
  }
  return pool[0]!.id;
}

aiRecommendationsGenerateRouter.post(
  "/:runId/ai-recommendations/generate",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    if (!hasProviderConfigured()) {
      res.status(503).json({
        error: "No AI provider configured",
        message: "Set GEMINI_API_KEY (or OPENROUTER_API_KEY / NVIDIA_API_KEY / OPENAI_API_KEY) in server/.env to generate recommendations.",
      });
      return;
    }

    const body = (req.body ?? {}) as { ruleId?: unknown; pageId?: unknown; top?: unknown };
    const ruleId = typeof body.ruleId === "string" && body.ruleId ? body.ruleId : undefined;
    const pageIdFilter = typeof body.pageId === "string" && body.pageId ? body.pageId : undefined;
    const top = typeof body.top === "number" && Number.isFinite(body.top) && body.top > 0 ? Math.floor(body.top) : undefined;

    const crawl = await prisma.crawl.findFirst({ where: { slug: runId, deletedAt: null }, select: { id: true, projectId: true } });
    if (!crawl) {
      res.status(404).json({ error: "Run not found", runId });
      return;
    }

    const analysisRow = await dbReadCrawlAnalysis(prisma, runId);
    if (!analysisRow) {
      res.status(404).json({ error: "No analysis for run — nothing to generate recommendations from", runId });
      return;
    }

    const pageRows = await dbGetCrawlPages(prisma, runId);
    const analysis = adaptAnalysis(analysisRow);
    const pages = adaptPages(pageRows);

    const provider = createProviderFromEnv();

    const report = await generateAiRecommendations({
      runId,
      analysis,
      pages,
      provider,
      ruleFilter: ruleId ? [ruleId] : undefined,
      pageIdFilter,
      top,
    });

    // Drop index-oriented meta recommendations (page title / meta description / social OG+Twitter /
    // duplicate title+description) for pages that render as NOINDEX. An SEO plugin never outputs
    // those tags on a noindex page, so a "Fix & Apply" there would save a value that can never
    // appear on the live page — pure noise. Other categories stay: image alt is accessibility and
    // headings are on-page content, both of which matter regardless of index status.
    const INDEX_ORIENTED = new Set(["title", "meta-description", "social", "duplicate-content"]);
    const noindexPageKeys = new Set(pages.filter((p) => p.robots?.noindex).map((p) => p.pageId));
    const recommendations = report.recommendations.filter(
      (rec) => !(rec.pageId && noindexPageKeys.has(rec.pageId) && INDEX_ORIENTED.has(rec.category)),
    );
    const skippedNoindex = report.recommendations.length - recommendations.length;

    // --- persist into AiRecommendation ---
    const [issues, pageRecords] = await Promise.all([
      prisma.issue.findMany({ where: { crawlId: crawl.id }, select: { id: true, ruleSlug: true, pageId: true, evidencePaths: true } }),
      prisma.page.findMany({ where: { crawlId: crawl.id }, select: { id: true, pageKey: true } }),
    ]);
    const issuesByRule = new Map<string, IssueLookupRow[]>();
    for (const i of issues) {
      const list = issuesByRule.get(i.ruleSlug) ?? [];
      list.push(i);
      issuesByRule.set(i.ruleSlug, list);
    }
    const pageKeyToUuid = new Map(pageRecords.map((p) => [p.pageKey, p.id]));

    // Dedupe on the table's unique key (issueId, instanceKey); last write wins.
    const rowsByKey = new Map<string, Prisma.AiRecommendationCreateManyInput>();
    let unresolved = 0;
    for (const rec of recommendations) {
      const issueId = resolveIssueId(rec, issuesByRule, pageKeyToUuid);
      if (!issueId) {
        unresolved += 1;
        continue;
      }
      const pageUuid = rec.pageId ? (pageKeyToUuid.get(rec.pageId) ?? null) : null;
      rowsByKey.set(`${issueId}::${rec.instanceKey ?? ""}`, {
        crawlId: crawl.id,
        issueId,
        projectId: crawl.projectId,
        ruleSlug: rec.issueRuleId,
        category: rec.category,
        url: rec.url,
        pageId: pageUuid,
        instanceKey: rec.instanceKey,
        model: rec.model,
        promptVersion: rec.promptVersion,
        whatIsWrong: rec.whatIsWrong,
        currentValue: rec.currentValue,
        recommendedValue: rec.recommendedValue,
        recommendedValuePlain: rec.recommendedValuePlain,
        whyThisValue: rec.whyThisValue,
        basedOn: rec.basedOn as unknown as Prisma.InputJsonValue,
        howToApply: rec.howToApply,
        confidence: rec.confidence,
        selfReportedConfidence: rec.selfReportedConfidence,
        needsHumanInput: rec.needsHumanInput,
        needsHumanInputReason: rec.needsHumanInputReason,
        validation: rec.validation as unknown as Prisma.InputJsonValue,
        contentHash: rec.contentHash ?? null,
        evidenceSig: rec.evidenceSig ?? null,
      });
    }
    const rows = [...rowsByKey.values()];
    const affectedIssueIds = [...new Set(rows.map((r) => r.issueId))];

    if (affectedIssueIds.length > 0) {
      // Rewrite semantics: replace any prior recommendations for the issues we regenerated, then
      // insert the fresh set — mirroring how the old app fully rewrote the run's report for its
      // generation scope. Out-of-scope issues' recommendations are left untouched.
      await prisma.$transaction([
        prisma.aiRecommendation.deleteMany({ where: { crawlId: crawl.id, issueId: { in: affectedIssueIds } } }),
        prisma.aiRecommendation.createMany({ data: rows }),
      ]);
    }

    // Stamp the "generation ran" marker on EVERY successful run, even one that produced zero
    // persisted recommendations. This is what lets the read route tell "generated, zero recs"
    // (marker set, no rows) apart from "never generated" (marker null) — see aiRecommendations.routes.ts.
    await prisma.crawl.update({ where: { id: crawl.id }, data: { aiRecsGeneratedAt: new Date() } });

    res.json({
      runId,
      generatedAt: report.generatedAt,
      model: report.model,
      totalGenerated: report.totalGenerated,
      totalSkipped: report.totalSkipped,
      totalPersisted: rows.length,
      totalUnresolved: unresolved,
      skippedNoindex,
      rulesConsidered: report.rulesConsidered,
    });
  }),
);

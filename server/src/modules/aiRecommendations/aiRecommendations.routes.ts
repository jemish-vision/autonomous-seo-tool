/**
 * AI-authored exact-fix recommendations for a run (qi-feature-plam.md §9). The old app read a
 * server-written ai-recommendations.json; here they come from the AiRecommendation table, scoped
 * to the crawl (resolve crawl by slug=runId, then its rows). Mapped to the AiRecommendationReport
 * shape the Issues UI consumes (lib/ai-recommend/types.ts). No filesystem.
 *
 *   GET /api/crawls/:runId/ai-recommendations  ->  AiRecommendationReport (recommendations: [] when none)
 *
 * The response carries an explicit `generated` boolean so the UI can tell three states apart on a
 * uniform 200 payload (never a bare 404 the client would have to special-case):
 *   - never generated       -> { generated: false, recommendations: [] }
 *   - generated, zero recs   -> { generated: true,  recommendations: [] }   (generation ran, produced none)
 *   - generated, has recs    -> { generated: true,  recommendations: [...] }
 * The "generated" signal is the Crawl.aiRecsGeneratedAt marker the generate route stamps on every
 * run — rows alone can't distinguish "ran but produced zero" from "never ran".
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { isSafeId } from "../../lib/apiShared.js";

export const aiRecommendationsRouter = Router();

function emptyReport(runId: string, generated: boolean, generatedAt?: Date | null) {
  return {
    runId,
    generated,
    generatedAt: (generatedAt ?? new Date()).toISOString(),
    provider: "",
    model: "",
    promptVersion: "",
    rulesConsidered: [] as string[],
    totalGenerated: 0,
    totalSkipped: 0,
    recommendations: [] as unknown[],
    skipped: [] as unknown[],
  };
}

aiRecommendationsRouter.get(
  "/:runId/ai-recommendations",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    const crawl = await prisma.crawl.findFirst({
      where: { slug: runId, deletedAt: null },
      select: { id: true, aiRecsGeneratedAt: true },
    });
    if (!crawl) {
      // Unknown run -> never generated (honest, never 500): the panel shows "not generated yet".
      res.json(emptyReport(runId, false));
      return;
    }

    const [rows, pages] = await Promise.all([
      prisma.aiRecommendation.findMany({ where: { crawlId: crawl.id }, orderBy: { createdAt: "asc" } }),
      // Map the DB pageId (Page UUID) back to the dashboard pageKey the UI groups by.
      prisma.page.findMany({ where: { crawlId: crawl.id }, select: { id: true, pageKey: true } }),
    ]);

    // No rows can mean "never generated" or "generation ran but produced zero" — the marker
    // (aiRecsGeneratedAt, stamped by the generate route on every run) is the only thing that tells
    // them apart. Rows present always implies generated.
    const generated = crawl.aiRecsGeneratedAt !== null;
    if (rows.length === 0) {
      res.json(emptyReport(runId, generated, crawl.aiRecsGeneratedAt));
      return;
    }

    const pageKeyByUuid = new Map(pages.map((p) => [p.id, p.pageKey]));

    const recommendations = rows.map((r) => ({
      issueRuleId: r.ruleSlug,
      category: r.category,
      url: r.url,
      pageId: r.pageId ? pageKeyByUuid.get(r.pageId) ?? null : null,
      instanceKey: r.instanceKey,
      generatedAt: r.createdAt.toISOString(),
      model: r.model,
      promptVersion: r.promptVersion,
      whatIsWrong: r.whatIsWrong,
      currentValue: r.currentValue,
      recommendedValue: r.recommendedValue,
      recommendedValuePlain: r.recommendedValuePlain ?? "",
      whyThisValue: r.whyThisValue,
      basedOn: (r.basedOn as unknown[]) ?? [],
      howToApply: r.howToApply,
      confidence: r.confidence,
      selfReportedConfidence: r.selfReportedConfidence,
      needsHumanInput: r.needsHumanInput,
      needsHumanInputReason: r.needsHumanInputReason,
      validation: r.validation,
      contentHash: r.contentHash,
      evidenceSig: r.evidenceSig,
    }));

    const generatedAt = rows.reduce<Date>((max, r) => (r.createdAt > max ? r.createdAt : max), rows[0].createdAt);
    res.json({
      runId,
      generated: true,
      generatedAt: generatedAt.toISOString(),
      provider: "",
      model: rows[0].model,
      promptVersion: rows[0].promptVersion,
      rulesConsidered: [...new Set(rows.map((r) => r.ruleSlug))],
      totalGenerated: rows.length,
      totalSkipped: 0,
      recommendations,
      skipped: [],
    });
  }),
);

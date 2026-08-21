/**
 * Rule mutes — "accept this risk" for a rule, keyed per SITE (survives re-crawls), matching the old
 * app/api/mutes route. Supabase-only: the mute lives in the RuleMute table, not a
 * storage/mutes/<host>.json file.
 *
 *   POST   /api/mutes  { runId, ruleId, note? }  -> upsert a RuleMute for the run's site
 *   DELETE /api/mutes  { runId, ruleId }          -> remove it
 *
 * The `ruleId` in the request/response is the human RULE SLUG (e.g. "duplicate-title") — the same
 * identifier the Issues UI uses and that dbReadCrawlAnalysis returns as `mutedRuleIds`. The
 * RuleMute row also stores the Rule's UUID (`ruleId` column, a required FK) which we resolve from
 * the run's Finding for that slug (the rule is, by definition, one the run's analysis surfaced).
 *
 * healthScore recompute (NO rules engine needed): the old app re-ran the full crawler rules engine
 * after a mute/unmute just to get a fresh healthScore. That engine is crawler/disk-only, but the
 * score is a PURE function of already-stored finding data — per rule its category, worst severity,
 * distinct affected-page count, and evaluated-page count — and muting a rule simply drops that
 * rule's deduction. So we recompute the exact same category-weighted score IN-REPO from the run's
 * stored findings (dbReadCrawlAnalysis) minus the currently-muted rules, and return the real number.
 * See ../../lib/healthScore.ts (a faithful port of the engine's score.ts). The mute itself is fully
 * persisted and honoured by every subsequent read (dbReadCrawlAnalysis filters non-expired RuleMute
 * rows into `mutedRuleIds`).
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { isSafeId } from "../../lib/apiShared.js";
import { recomputeHealthScore } from "../../lib/healthScore.js";
import { dbReadCrawlAnalysis } from "../../db/src/crawl/readStore.js";

export const mutesRouter = Router();

interface MuteBody {
  runId?: unknown;
  ruleId?: unknown;
  note?: unknown;
}

/** Recompute the run's healthScore from its stored findings with the given active mute set applied.
 *  Uses the same read path (dbReadCrawlAnalysis) every other module uses. Returns null only when the
 *  run has no analysis to score (no findings imported yet) — an honest "nothing to score", never a
 *  fabricated number. */
async function healthScoreFor(runId: string, mutedRuleIds: string[]): Promise<number | null> {
  const analysis = await dbReadCrawlAnalysis(prisma, runId);
  if (!analysis?.findings?.length) return null;
  return recomputeHealthScore(analysis.findings, mutedRuleIds);
}

/** Resolve the run (Crawl.slug) to its site + project. Returns null when the run isn't synced. */
async function resolveRun(runId: string): Promise<{ id: string; siteId: string; projectId: string } | null> {
  return prisma.crawl.findFirst({
    where: { slug: runId, deletedAt: null },
    select: { id: true, siteId: true, projectId: true },
  });
}

/** The site's currently-active (non-expired) muted rule SLUGS — the exact shape
 *  dbReadCrawlAnalysis exposes as `mutedRuleIds`, so the two stay consistent. */
async function activeMutedRuleIds(siteId: string): Promise<string[]> {
  const mutes = await prisma.ruleMute.findMany({
    where: { siteId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { ruleSlug: true },
  });
  return mutes.map((m) => m.ruleSlug);
}

mutesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as MuteBody;
    const runId = typeof body.runId === "string" ? body.runId : "";
    const ruleId = typeof body.ruleId === "string" ? body.ruleId : "";
    const note = typeof body.note === "string" ? body.note : null;

    if (!runId || !isSafeId(runId)) {
      res.status(422).json({ error: "runId is required and must be a safe id." });
      return;
    }
    if (!ruleId || !isSafeId(ruleId)) {
      res.status(422).json({ error: "ruleId is required and must be a safe id." });
      return;
    }

    const crawl = await resolveRun(runId);
    if (!crawl) {
      res.status(404).json({ error: `No crawl found for run "${runId}".` });
      return;
    }

    // The Rule UUID (a required FK on RuleMute) — resolve from the run's Finding for this slug,
    // falling back to the Rule table (a global or project rule). A slug with no matching rule at
    // all can't be muted (nothing to key the FK to).
    const finding = await prisma.finding.findFirst({
      where: { crawlId: crawl.id, ruleSlug: ruleId },
      select: { ruleId: true },
    });
    let ruleUuid = finding?.ruleId ?? null;
    if (!ruleUuid) {
      const rule = await prisma.rule.findFirst({
        where: { slug: ruleId, OR: [{ projectId: crawl.projectId }, { projectId: null }] },
        orderBy: { version: "desc" },
        select: { id: true },
      });
      ruleUuid = rule?.id ?? null;
    }
    if (!ruleUuid) {
      res.status(404).json({ error: `Rule "${ruleId}" is not known for run "${runId}" — nothing to mute.` });
      return;
    }

    await prisma.ruleMute.upsert({
      where: { siteId_ruleSlug: { siteId: crawl.siteId, ruleSlug: ruleId } },
      create: {
        projectId: crawl.projectId,
        siteId: crawl.siteId,
        ruleId: ruleUuid,
        ruleSlug: ruleId,
        note,
      },
      update: { note, ruleId: ruleUuid, expiresAt: null },
    });

    const mutedRuleIds = await activeMutedRuleIds(crawl.siteId);
    res.json({
      ok: true,
      action: "mute",
      ruleId,
      mutedRuleIds,
      healthScore: await healthScoreFor(runId, mutedRuleIds),
    });
  }),
);

mutesRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as MuteBody;
    const runId = typeof body.runId === "string" ? body.runId : "";
    const ruleId = typeof body.ruleId === "string" ? body.ruleId : "";

    if (!runId || !isSafeId(runId)) {
      res.status(422).json({ error: "runId is required and must be a safe id." });
      return;
    }
    if (!ruleId || !isSafeId(ruleId)) {
      res.status(422).json({ error: "ruleId is required and must be a safe id." });
      return;
    }

    const crawl = await resolveRun(runId);
    if (!crawl) {
      res.status(404).json({ error: `No crawl found for run "${runId}".` });
      return;
    }

    await prisma.ruleMute.deleteMany({ where: { siteId: crawl.siteId, ruleSlug: ruleId } });

    const mutedRuleIds = await activeMutedRuleIds(crawl.siteId);
    res.json({
      ok: true,
      action: "unmute",
      ruleId,
      mutedRuleIds,
      healthScore: await healthScoreFor(runId, mutedRuleIds),
    });
  }),
);

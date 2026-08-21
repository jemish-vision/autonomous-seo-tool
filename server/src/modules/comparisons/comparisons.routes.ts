/**
 * Saved comparisons — persisted crawl-over-crawl diffs and competitor aggregates, backed by
 * Supabase (public.comparisons, per-user).
 *
 * Ports the OLD Next.js app/api/comparisons/** routes + lib/data-comparisons.ts, which persisted
 * comparisons as JSON files under storage/comparisons/. Here they are rows scoped per user.
 * The NEW app already has a LIVE diff (GET /api/crawls/:head/diff, compare module); this module adds
 * the PERSISTED create/list/detail entity on top of the same computeCrawlDiff computation.
 *
 * Per-user scoping matches the sources module: SERVICE-ROLE Supabase client (bypasses RLS) → every
 * query is scoped by user_id = req.userId in code. RLS policies remain as defense-in-depth
 * (see scripts/comparisons-migration.sql).
 *
 *   POST /api/comparisons                        -> ComparisonResult (201; computes + persists)
 *   GET  /api/comparisons?siteId=                -> ComparisonSummary[] (this user's, newest first)
 *   GET  /api/comparisons/:id?section=summary    -> section slice of the stored result
 *                          section=pages|issues|measurements
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { asyncHandler } from "../../middleware/error.js";
import { getServiceClient } from "../../supabase/service.js";
import { isSafeId, parseOffsetPaging, paginate } from "../../lib/apiShared.js";
import { prisma } from "../../db/prisma.js";
import { dbCrawlExists, dbGetCrawlRun, dbReadCrawlAnalysis } from "../../db/src/crawl/readStore.js";
import { computeCrawlDiff, type CrawlDiff } from "../compare/computeDiff.js";

// ── Types (mirror the OLD lib/data-comparisons.ts contract) ──────────────────────────────────

type ComparisonMode = "run-over-run" | "competitor";

interface ComparisonSummary {
  id: string;
  siteId: string | null;
  baseCrawlId: string;
  againstCrawlId: string;
  mode: ComparisonMode;
  createdAt: string;
  status: "completed";
}

interface CompetitorAggregate {
  base: { runId: string; healthScore: number | null; pagesAnalyzed: number | null; coveragePercent: number };
  against: { runId: string; healthScore: number | null; pagesAnalyzed: number | null; coveragePercent: number };
}

interface ComparisonResult extends ComparisonSummary {
  runOverRun: CrawlDiff | null;
  competitor: CompetitorAggregate | null;
}

/** What lands in the `result` JSONB column (the summary fields live in dedicated columns). */
interface StoredResult {
  status: "completed";
  runOverRun: CrawlDiff | null;
  competitor: CompetitorAggregate | null;
}

interface ComparisonRow {
  id: string;
  user_id: string;
  site_id: string | null;
  base_crawl_id: string;
  against_crawl_id: string;
  mode: ComparisonMode;
  result: StoredResult | null;
  created_at: string;
}

// ── Row -> contract mapping ───────────────────────────────────────────────────────────────────

function rowToSummary(row: ComparisonRow): ComparisonSummary {
  return {
    id: row.id,
    siteId: row.site_id,
    baseCrawlId: row.base_crawl_id,
    againstCrawlId: row.against_crawl_id,
    mode: row.mode,
    createdAt: row.created_at,
    status: "completed",
  };
}

function rowToResult(row: ComparisonRow): ComparisonResult {
  return {
    ...rowToSummary(row),
    runOverRun: row.result?.runOverRun ?? null,
    competitor: row.result?.competitor ?? null,
  };
}

// ── Service-client + per-user scoping helpers (same shape as the sources module) ──────────────

function client(res: Response) {
  const state = getServiceClient();
  if (!state.configured) {
    res.status(500).json({ error: "Supabase service client not configured", reason: state.reason });
    return null;
  }
  return state.client;
}

function userId(req: Request, res: Response): string | null {
  const id = req.userId;
  if (!id) {
    res.status(401).json({ error: "Unauthorized", reason: "no user id on request" });
    return null;
  }
  return id;
}

// ── Router ───────────────────────────────────────────────────────────────────────────────────

export const comparisonsRouter = Router();

/** POST / — compute a comparison (run-over-run diff OR competitor aggregate) and persist it. */
comparisonsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const body = (req.body ?? {}) as {
      baseCrawlId?: unknown;
      againstCrawlId?: unknown;
      mode?: unknown;
      siteId?: unknown;
    };
    const baseCrawlId = typeof body.baseCrawlId === "string" ? body.baseCrawlId : "";
    const againstCrawlId = typeof body.againstCrawlId === "string" ? body.againstCrawlId : "";
    const siteId = typeof body.siteId === "string" && body.siteId ? body.siteId : null;
    const mode: ComparisonMode = body.mode === "competitor" ? "competitor" : "run-over-run";

    if (!baseCrawlId) {
      res.status(400).json({ error: "baseCrawlId is required." });
      return;
    }
    if (!againstCrawlId) {
      res.status(400).json({ error: "againstCrawlId is required." });
      return;
    }
    if (!isSafeId(baseCrawlId) || !isSafeId(againstCrawlId)) {
      res.status(422).json({ error: "baseCrawlId and againstCrawlId must be safe ids." });
      return;
    }

    // Both runs must exist (parity with the OLD 404 on a missing run).
    const [baseExists, againstExists] = await Promise.all([
      dbCrawlExists(prisma, baseCrawlId),
      dbCrawlExists(prisma, againstCrawlId),
    ]);
    if (!baseExists) {
      res.status(404).json({ error: `Base run "${baseCrawlId}" not found.` });
      return;
    }
    if (!againstExists) {
      res.status(404).json({ error: `Comparison run "${againstCrawlId}" not found.` });
      return;
    }

    let runOverRun: CrawlDiff | null = null;
    let competitor: CompetitorAggregate | null = null;

    if (mode === "run-over-run") {
      runOverRun = await computeCrawlDiff(baseCrawlId, againstCrawlId);
    } else {
      const [baseRun, againstRun, baseReport, againstReport] = await Promise.all([
        dbGetCrawlRun(prisma, baseCrawlId),
        dbGetCrawlRun(prisma, againstCrawlId),
        dbReadCrawlAnalysis(prisma, baseCrawlId),
        dbReadCrawlAnalysis(prisma, againstCrawlId),
      ]);
      competitor = {
        base: {
          runId: baseCrawlId,
          healthScore: baseReport?.healthScore ?? null,
          pagesAnalyzed: baseReport?.pagesAnalyzed ?? null,
          coveragePercent: baseRun?.report?.coveragePercent ?? 0,
        },
        against: {
          runId: againstCrawlId,
          healthScore: againstReport?.healthScore ?? null,
          pagesAnalyzed: againstReport?.pagesAnalyzed ?? null,
          coveragePercent: againstRun?.report?.coveragePercent ?? 0,
        },
      };
    }

    const id = randomUUID();
    const storedResult: StoredResult = { status: "completed", runOverRun, competitor };

    const { data, error } = await supabase
      .from("comparisons")
      .insert({
        id,
        user_id: uid, // service role bypasses the auth.uid() default — set it explicitly
        site_id: siteId,
        base_crawl_id: baseCrawlId,
        against_crawl_id: againstCrawlId,
        mode,
        result: storedResult,
      })
      .select("*")
      .single();
    if (error) throw new Error(`[comparisons] create failed: ${error.message}`);
    res.status(201).json(rowToResult(data as ComparisonRow));
  }),
);

/** GET /?siteId= — this user's saved comparisons (summaries), newest first. */
comparisonsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    let query = supabase
      .from("comparisons")
      .select("id, user_id, site_id, base_crawl_id, against_crawl_id, mode, created_at")
      .eq("user_id", uid);

    const siteId = typeof req.query.siteId === "string" ? req.query.siteId : "";
    if (siteId) query = query.eq("site_id", siteId);

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw new Error(`[comparisons] list failed: ${error.message}`);
    res.json((data as ComparisonRow[]).map(rowToSummary));
  }),
);

/** GET /:id?section=summary|pages|issues|measurements — the stored result, sliced by section. */
comparisonsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const supabase = client(res);
    if (!supabase) return;
    const uid = userId(req, res);
    if (!uid) return;

    const { id } = req.params;
    if (!isSafeId(id)) {
      res.status(422).json({ error: "id must be a safe id." });
      return;
    }

    const { data, error } = await supabase
      .from("comparisons")
      .select("*")
      .eq("user_id", uid)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`[comparisons] load failed: ${error.message}`);
    if (!data) {
      res.status(404).json({ error: `No comparison found for id "${id}".` });
      return;
    }
    const comparison = rowToResult(data as ComparisonRow);

    const section = typeof req.query.section === "string" ? req.query.section : "summary";

    if (section === "measurements") {
      res.json({ available: false, reason: "Measurement-level comparison is not part of the stored diff shape yet." });
      return;
    }
    if (section === "pages") {
      if (!comparison.runOverRun) {
        res.json({ available: false, reason: "This comparison is competitor mode — page-level diff is aggregate-only." });
        return;
      }
      const { page, pageSize } = parseOffsetPaging(new URLSearchParams(req.query as Record<string, string>));
      res.json(paginate(comparison.runOverRun.changed, page, pageSize));
      return;
    }
    if (section === "issues") {
      res.json({ issues: comparison.runOverRun?.issues ?? null });
      return;
    }
    if (section === "summary") {
      res.json({
        id: comparison.id,
        siteId: comparison.siteId,
        baseCrawlId: comparison.baseCrawlId,
        againstCrawlId: comparison.againstCrawlId,
        mode: comparison.mode,
        createdAt: comparison.createdAt,
        status: comparison.status,
        runOverRunSummary: comparison.runOverRun
          ? {
              added: comparison.runOverRun.added.length,
              removed: comparison.runOverRun.removed.length,
              changed: comparison.runOverRun.changed.length,
              unchanged: comparison.runOverRun.unchangedCount,
            }
          : null,
        competitor: comparison.competitor,
      });
      return;
    }
    res.status(400).json({ error: `Unknown section "${section}".` });
  }),
);

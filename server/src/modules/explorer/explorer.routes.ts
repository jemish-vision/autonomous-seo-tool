/**
 * Pages explorer rows — the flat row list the PagesExplorerClient renders (one row per crawled
 * page + one per failure + one per robots-blocked URL). Ported from lib/data-explorer.ts /
 * lib/explorer-shared.ts's buildExplorerRows over the vendored read layer. No filesystem.
 *
 *   GET /api/crawls/:runId/explorer  -> { rows: ExplorerRow[] }
 *
 * The client hook (@/api/explorer) does the filtering/sorting/grouping itself from this raw list,
 * so the server just unifies the three sources into the ExplorerRow shape.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlRun, dbGetCrawlPages } from "../../db/src/crawl/readStore.js";
import { isSafeId } from "../../lib/apiShared.js";
import { computeGraph } from "../graph/graph.routes.js";

export const explorerRouter = Router();

// --- shapes (mirrors lib/explorer-shared.ts's ExplorerRow) -------------------

type StatusBucket = "2xx" | "3xx" | "4xx" | "5xx" | "failed" | "blocked";

interface ExplorerRow {
  key: string;
  url: string;
  pageId: string | null;
  bucket: StatusBucket;
  statusCode: number | null;
  renderedWith: "http" | "playwright" | null;
  depth: number | null;
  wordCount: number | null;
  responseTimeMs: number | null;
  reason: string | null;
  // Internal-link graph fields — filled for crawled pages from the live PageRank pass (graph
  // module), null for failure/blocked rows which aren't nodes in the graph. Additive: the client's
  // ExplorerRow already declares `pagerank?`, older consumers ignore the extra keys.
  pagerank: number | null;
  inlinks: number | null;
  outlinks: number | null;
}

function bucketForStatus(code: number | null): StatusBucket {
  if (code === null) return "failed";
  const b = Math.floor(code / 100);
  if (b === 2) return "2xx";
  if (b === 3) return "3xx";
  if (b === 4) return "4xx";
  if (b === 5) return "5xx";
  return "failed";
}

explorerRouter.get(
  "/:runId/explorer",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    const [pages, detail] = await Promise.all([dbGetCrawlPages(prisma, runId), dbGetCrawlRun(prisma, runId)]);
    const failures = detail?.failures ?? [];
    const blocked = detail?.blocked ?? [];

    // Live internal-link graph — one PageRank pass per request, keyed by pageId so each row can
    // read its own authority/inlink/outlink counts (fills the Pages table's PageRank column).
    const graphByPageId = new Map(computeGraph(pages).map((g) => [g.pageId, g]));

    const rows: ExplorerRow[] = pages.map((p) => {
      const g = graphByPageId.get(p.pageId);
      return {
        key: `page-${p.pageId}`,
        url: p.url,
        pageId: p.pageId,
        bucket: bucketForStatus(p.statusCode),
        statusCode: p.statusCode,
        renderedWith: p.renderedWith,
        depth: p.crawl.depth,
        wordCount: p.content.wordCount,
        responseTimeMs: p.performance.responseTimeMs,
        reason: null,
        pagerank: g?.pagerank ?? null,
        inlinks: g?.inlinks ?? null,
        outlinks: g?.outlinks ?? null,
      };
    });

    failures.forEach((f, i) => {
      rows.push({
        key: `failure-${i}-${f.url}`,
        url: f.url,
        pageId: null,
        bucket: "failed",
        statusCode: f.statusCode,
        renderedWith: null,
        depth: f.depth,
        wordCount: null,
        responseTimeMs: null,
        reason: f.reason,
        pagerank: null,
        inlinks: null,
        outlinks: null,
      });
    });

    blocked.forEach((url, i) => {
      rows.push({
        key: `blocked-${i}-${url}`,
        url,
        pageId: null,
        bucket: "blocked",
        statusCode: null,
        renderedWith: null,
        depth: null,
        wordCount: null,
        responseTimeMs: null,
        reason: "blocked-robots",
        pagerank: null,
        inlinks: null,
        outlinks: null,
      });
    });

    res.json({ rows });
  }),
);

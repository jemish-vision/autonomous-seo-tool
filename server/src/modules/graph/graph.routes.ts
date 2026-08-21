/**
 * Internal-link graph + PageRank for a crawl run.
 *
 * Ports the old Next.js app's lib/data-graph.ts (buildGraph) and app/api/crawls/[runId]/graph
 * over the Supabase read layer. The old code read flat pages/*.json off disk (and preferred a
 * durable storage/runs/<id>/graph.json when the crawler had written one); this app has no
 * filesystem, so it reconstructs the same page + internal-link edges from Postgres via the
 * vendored dbGetCrawlPages and computes PageRank live in-request.
 *
 *   GET /api/crawls/:runId/graph  -> { data: GraphRow[], page }   (paginated, ?sort/?order)
 *
 * The pure computeGraph() is also imported by the explorer module so the Pages table's PageRank
 * column fills from the exact same computation — one pass per request, no duplicated logic.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlPages } from "../../db/src/crawl/readStore.js";
import type { CrawledPageRow } from "../../db/src/crawl/readStore.js";
import { isSafeId, parseOffsetPaging, paginate } from "../../lib/apiShared.js";

export interface GraphRow {
  pageId: string;
  url: string;
  depth: number | null;
  inlinks: number;
  outlinks: number;
  pagerank: number;
  source: "computed";
}

/** Same identity key the old lib/data-graph.ts used: normalized URL, falling back to the raw URL. */
function normKey(p: CrawledPageRow): string {
  return p.normalizedUrl || p.url;
}

/**
 * Power-iteration PageRank over the internal link graph, damping 0.85, 20 iterations — ported
 * verbatim from lib/data-graph.ts's buildGraph (the from-scratch branch; this app has no durable
 * graph.json to prefer). Scoped to pages actually crawled in this run: only edges whose target was
 * itself crawled count, self-links are dropped. Dangling nodes (no outlinks) redistribute their
 * mass evenly so total rank doesn't leak. Rows are returned sorted by PageRank descending.
 */
export function computeGraph(pages: CrawledPageRow[]): GraphRow[] {
  const byKey = new Map<string, CrawledPageRow>();
  for (const p of pages) byKey.set(normKey(p), p);

  const outEdges = new Map<string, Set<string>>();
  const inCounts = new Map<string, number>();
  for (const p of pages) {
    const key = normKey(p);
    const targets = new Set<string>();
    for (const link of p.links) {
      if (link.type !== "internal" || !link.targetNormalized) continue;
      if (!byKey.has(link.targetNormalized) || link.targetNormalized === key) continue;
      targets.add(link.targetNormalized);
    }
    outEdges.set(key, targets);
    for (const t of targets) inCounts.set(t, (inCounts.get(t) ?? 0) + 1);
  }

  const n = pages.length;
  const keys = [...byKey.keys()];
  const damping = 0.85;
  let rank = new Map<string, number>(keys.map((k) => [k, 1 / n]));

  for (let iter = 0; iter < 20 && n > 0; iter++) {
    let danglingMass = 0;
    for (const k of keys) {
      const out = outEdges.get(k);
      if (!out || out.size === 0) danglingMass += rank.get(k)!;
    }
    const next = new Map<string, number>();
    const base = (1 - damping) / n + (damping * danglingMass) / n;
    for (const k of keys) next.set(k, base);
    for (const k of keys) {
      const out = outEdges.get(k);
      if (!out || out.size === 0) continue;
      const share = (damping * rank.get(k)!) / out.size;
      for (const t of out) next.set(t, (next.get(t) ?? base) + share);
    }
    rank = next;
  }

  return pages
    .map((p) => {
      const key = normKey(p);
      return {
        pageId: p.pageId,
        url: p.url,
        depth: p.crawl.depth,
        inlinks: inCounts.get(key) ?? 0,
        outlinks: outEdges.get(key)?.size ?? 0,
        pagerank: Math.round((rank.get(key) ?? 0) * 100000) / 100000,
        source: "computed" as const,
      };
    })
    .sort((a, b) => b.pagerank - a.pagerank);
}

/** Small comparator (the old route used lib/api-shared's cmp; inlined here, nulls sort last). */
function cmp(a: number | null, b: number | null, order: "asc" | "desc"): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return order === "asc" ? a - b : b - a;
}

export const graphRouter = Router();

/** GET /:runId/graph — per-page depth, inlinks, outlinks, PageRank (spec §7). Computed live. */
graphRouter.get(
  "/:runId/graph",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    const pages = await dbGetCrawlPages(prisma, runId);
    if (pages.length === 0) {
      res.status(404).json({ error: "No completed run found", runId });
      return;
    }

    let rows = computeGraph(pages);

    const sortKey = req.query.sort === "inlinks" ? "inlinks" : req.query.sort === "depth" ? "depth" : req.query.sort === "outlinks" ? "outlinks" : "pagerank";
    const order = req.query.order === "asc" ? "asc" : "desc";
    rows = [...rows].sort((a, b) => cmp(a[sortKey], b[sortKey], order));

    const { page, pageSize } = parseOffsetPaging(new URLSearchParams(req.query as Record<string, string>));
    res.json(paginate(rows, page, pageSize));
  }),
);

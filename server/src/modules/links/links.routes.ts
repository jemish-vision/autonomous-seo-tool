/**
 * Link inventory for the /links page. Rolls the per-page link edges (PageLink, loaded through the
 * vendored dbGetCrawlPages) up into one row per unique destination — "who links here", inbound
 * count, nofollow count, anchors, broken/crawled flags — which is the shape lib/data-links.ts
 * (buildLinkRows) produced for the UI table. No filesystem.
 *
 *   GET /api/crawls/:runId/links   -> { data: LinkRow[], page }
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlPages } from "../../db/src/crawl/readStore.js";
import { isSafeId, parseOffsetPaging, paginate } from "../../lib/apiShared.js";

export const linksRouter = Router();

interface LinkSource {
  pageId: string;
  url: string;
  anchor: string;
  nofollow: boolean;
}

interface LinkRow {
  key: string;
  target: string;
  targetNormalized: string | null;
  type: "internal" | "external";
  status: number | null;
  crawled: boolean;
  broken: boolean;
  inboundCount: number;
  nofollowCount: number;
  anchors: string[];
  sources: LinkSource[];
}

linksRouter.get(
  "/:runId/links",
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

    const statusByNormUrl = new Map(pages.map((p) => [p.normalizedUrl, p.statusCode]));
    const pageIdByNormUrl = new Map(pages.map((p) => [p.normalizedUrl, p.pageId]));

    const rows = new Map<string, LinkRow>();
    for (const p of pages) {
      for (const l of p.links) {
        const key = `${l.type}|${l.target}`;
        const targetStatus = l.targetNormalized ? (statusByNormUrl.get(l.targetNormalized) ?? null) : null;
        const source: LinkSource = { pageId: p.pageId, url: p.url, anchor: l.anchor, nofollow: l.nofollow };
        const existing = rows.get(key);
        if (existing) {
          existing.inboundCount++;
          if (l.nofollow) existing.nofollowCount++;
          if (l.anchor && !existing.anchors.includes(l.anchor)) existing.anchors.push(l.anchor);
          if (existing.sources.length < 50) existing.sources.push(source);
          continue;
        }
        rows.set(key, {
          key,
          target: l.target,
          targetNormalized: l.targetNormalized,
          type: l.type,
          status: targetStatus,
          crawled: l.targetNormalized ? pageIdByNormUrl.has(l.targetNormalized) : false,
          broken: targetStatus !== null && targetStatus >= 400,
          inboundCount: 1,
          nofollowCount: l.nofollow ? 1 : 0,
          anchors: l.anchor ? [l.anchor] : [],
          sources: [source],
        });
      }
    }

    let out = [...rows.values()].sort((a, b) => b.inboundCount - a.inboundCount);

    // Optional filters mirroring the old edge-list route's ?kind / ?status=broken.
    const kind = req.query.kind;
    if (kind === "internal" || kind === "external") out = out.filter((r) => r.type === kind);
    if (req.query.status === "broken") out = out.filter((r) => r.broken);

    const { page, pageSize } = parseOffsetPaging(new URLSearchParams(req.query as Record<string, string>));
    res.json(paginate(out, page, pageSize));
  }),
);

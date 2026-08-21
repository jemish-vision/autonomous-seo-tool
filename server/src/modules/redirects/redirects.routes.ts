/**
 * Redirect inventory for the /redirects page. Reads each page's stored redirect chain
 * (PageRedirectHop, loaded through the vendored dbGetCrawlPages) and classifies it — the shape
 * lib/data-redirects.ts (buildRedirectRows) produced for the UI table. No filesystem.
 *
 *   GET /api/crawls/:runId/redirects  -> { data: RedirectRow[], page }
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlPages } from "../../db/src/crawl/readStore.js";
import { isSafeId, parseOffsetPaging, paginate } from "../../lib/apiShared.js";

export const redirectsRouter = Router();

type RedirectType = "permanent" | "temporary" | "loop" | "to-error";

interface RedirectRow {
  pageId: string;
  requestedUrl: string;
  chain: { from: string; to: string; statusCode: number }[];
  hops: number;
  finalUrl: string | null;
  finalStatus: number | null;
  type: RedirectType;
  crossHost: boolean;
  toHttps: boolean;
}

function classify(chain: { statusCode: number }[], finalStatus: number | null): RedirectType {
  if (finalStatus !== null && finalStatus >= 400) return "to-error";
  if (new Set(chain.map((c) => c.statusCode)).size < chain.length && chain.length > 3) return "loop";
  const allPermanent = chain.every((c) => c.statusCode === 301 || c.statusCode === 308);
  return allPermanent ? "permanent" : "temporary";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

redirectsRouter.get(
  "/:runId/redirects",
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

    let rows: RedirectRow[] = pages
      .filter((p) => p.redirectChain.length > 0)
      .map((p) => {
        // Vendored redirectChain hops carry `to: string | null`; the UI row uses a plain string.
        const chain = p.redirectChain.map((r) => ({ from: r.from, to: r.to ?? "", statusCode: r.statusCode }));
        const firstHost = hostOf(chain[0]?.from ?? p.url);
        const finalHost = hostOf(p.finalUrl ?? p.url);
        return {
          pageId: p.pageId,
          requestedUrl: chain[0]?.from ?? p.url,
          chain,
          hops: chain.length,
          finalUrl: p.finalUrl,
          finalStatus: p.statusCode,
          type: classify(chain, p.statusCode),
          crossHost: Boolean(firstHost && finalHost && firstHost !== finalHost),
          toHttps: chain.some((c) => c.from.startsWith("http://")) && Boolean(p.finalUrl?.startsWith("https://")),
        };
      })
      .sort((a, b) => b.hops - a.hops);

    const typeFilter = req.query.type;
    if (typeFilter === "permanent" || typeFilter === "temporary" || typeFilter === "loop" || typeFilter === "to-error") {
      rows = rows.filter((r) => r.type === typeFilter);
    }

    const { page, pageSize } = parseOffsetPaging(new URLSearchParams(req.query as Record<string, string>));
    res.json(paginate(rows, page, pageSize));
  }),
);

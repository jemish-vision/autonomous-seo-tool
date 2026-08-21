/**
 * Duplicate-content clustering for the /duplicates view. Groups the run's pages (loaded through
 * the vendored dbGetCrawlPages) by content hash / title / meta-description, or by near-duplicate
 * shingle similarity — the same logic lib/data-graph.ts (buildDuplicates) used. No filesystem.
 *
 *   GET /api/crawls/:runId/duplicates?kind=exact|near|title|description
 *
 * `near` is O(n^2) pairwise, so it is capped at 300 pages and returns { meta:{available:false} }
 * above that, exactly like the old route — never a partial/faked result.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlPages, type CrawledPageRow } from "../../db/src/crawl/readStore.js";
import { isSafeId, parseOffsetPaging, paginate } from "../../lib/apiShared.js";

export const duplicatesRouter = Router();

type DuplicateKind = "exact" | "near" | "title" | "description";

interface DuplicateGroup {
  key: string;
  kind: DuplicateKind;
  pages: { pageId: string; url: string }[];
}

const NEAR_DUP_PAGE_CAP = 300;

function groupBy(pages: CrawledPageRow[], kind: DuplicateKind, keyFn: (p: CrawledPageRow) => string | null): DuplicateGroup[] {
  const map = new Map<string, { pageId: string; url: string }[]>();
  for (const p of pages) {
    const key = keyFn(p);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push({ pageId: p.pageId, url: p.url });
    map.set(key, list);
  }
  return [...map.entries()].filter(([, items]) => items.length > 1).map(([key, groupPages]) => ({ key, kind, pages: groupPages }));
}

function shingles(text: string, size = 5): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  if (out.size === 0 && words.length > 0) out.add(words.join(" "));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

duplicatesRouter.get(
  "/:runId/duplicates",
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

    const kindRaw = req.query.kind;
    const kind: DuplicateKind = kindRaw === "near" || kindRaw === "title" || kindRaw === "description" ? kindRaw : "exact";

    const { page, pageSize } = parseOffsetPaging(new URLSearchParams(req.query as Record<string, string>));

    let groups: DuplicateGroup[];
    if (kind === "exact") {
      groups = groupBy(pages, "exact", (p) => p.content.contentHash || null);
    } else if (kind === "title") {
      groups = groupBy(pages, "title", (p) => (p.title ? p.title.trim().toLowerCase() : null));
    } else if (kind === "description") {
      groups = groupBy(pages, "description", (p) => (p.metaDescription ? p.metaDescription.trim().toLowerCase() : null));
    } else {
      // near
      if (pages.length > NEAR_DUP_PAGE_CAP) {
        res.json({
          data: [],
          page: { page: 1, pageSize: 0, total: 0, hasMore: false },
          meta: {
            available: false,
            reason: `Near-duplicate detection is O(n^2) shingle comparison; this run has ${pages.length} pages, above the ${NEAR_DUP_PAGE_CAP}-page cap for a request-thread computation.`,
          },
        });
        return;
      }
      const withText = pages.filter((p) => p.content.text && p.content.text.length > 50);
      const sets = withText.map((p) => ({ p, s: shingles(p.content.text) }));
      const visited = new Set<number>();
      groups = [];
      for (let i = 0; i < sets.length; i++) {
        if (visited.has(i)) continue;
        const cluster = [sets[i]];
        for (let j = i + 1; j < sets.length; j++) {
          if (visited.has(j)) continue;
          if (jaccard(sets[i].s, sets[j].s) >= 0.8) {
            cluster.push(sets[j]);
            visited.add(j);
          }
        }
        if (cluster.length > 1) {
          visited.add(i);
          groups.push({ key: `near-${sets[i].p.pageId}`, kind: "near", pages: cluster.map((c) => ({ pageId: c.p.pageId, url: c.p.url })) });
        }
      }
    }

    res.json({ ...paginate(groups, page, pageSize), meta: { available: true } });
  }),
);

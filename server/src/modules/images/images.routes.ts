/**
 * Image inventory for the /images page. Aggregates the per-page images (PageImage, loaded through
 * the vendored dbGetCrawlPages) into one row per unique image URL — alt state, dimensions, format,
 * usage count, the pages it appears on — the shape lib/data-images.ts (buildImageRows) produced.
 *
 *   GET /api/crawls/:runId/images  -> { data: ImageRow[], page }
 *
 * Parity: this crawler captures url/alt/width/height/format only (no byte size), so sizeBytes /
 * sizeCategory come back null rather than a guessed value.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { dbGetCrawlPages } from "../../db/src/crawl/readStore.js";
import { isSafeId, parseOffsetPaging, paginate } from "../../lib/apiShared.js";

export const imagesRouter = Router();

type AltState = "missing" | "empty" | "described";
type SizeCategory = "normal" | "large" | "oversized";

interface ImageRow {
  key: string;
  url: string;
  altState: AltState;
  alt: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  hasDimensions: boolean;
  sizeBytes: number | null;
  sizeCategory: SizeCategory | null;
  usageCount: number;
  pages: { pageId: string; url: string }[];
}

function altStateOf(alt: string | null): AltState {
  if (alt === null) return "missing";
  if (alt.trim() === "") return "empty";
  return "described";
}

function sizeCategoryOf(bytes: number | null): SizeCategory | null {
  if (bytes === null) return null;
  if (bytes > 500 * 1024) return "oversized";
  if (bytes > 100 * 1024) return "large";
  return "normal";
}

imagesRouter.get(
  "/:runId/images",
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

    const rows = new Map<string, ImageRow>();
    for (const p of pages) {
      for (const img of p.images) {
        if (!img.url) continue;
        const bytes = (img as { sizeBytes?: number | null }).sizeBytes ?? null;
        const existing = rows.get(img.url);
        if (existing) {
          existing.usageCount++;
          if (existing.pages.length < 50) existing.pages.push({ pageId: p.pageId, url: p.url });
          if (existing.sizeBytes === null && bytes !== null) {
            existing.sizeBytes = bytes;
            existing.sizeCategory = sizeCategoryOf(bytes);
          }
          if (existing.altState === "missing" && img.alt !== null) {
            existing.alt = img.alt;
            existing.altState = altStateOf(img.alt);
          }
          continue;
        }
        rows.set(img.url, {
          key: img.url,
          url: img.url,
          altState: altStateOf(img.alt),
          alt: img.alt,
          width: img.width,
          height: img.height,
          format: img.format,
          hasDimensions: img.width !== null && img.height !== null,
          sizeBytes: bytes,
          sizeCategory: sizeCategoryOf(bytes),
          usageCount: 1,
          pages: [{ pageId: p.pageId, url: p.url }],
        });
      }
    }

    let out = [...rows.values()].sort((a, b) => b.usageCount - a.usageCount);
    if (req.query.altState === "missing" || req.query.altState === "empty" || req.query.altState === "described") {
      out = out.filter((r) => r.altState === req.query.altState);
    }

    const { page, pageSize } = parseOffsetPaging(new URLSearchParams(req.query as Record<string, string>));
    res.json(paginate(out, page, pageSize));
  }),
);

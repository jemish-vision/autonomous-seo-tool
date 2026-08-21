/**
 * Blob access — screenshots, raw HTML, and the replay snapshot for a crawled page. The old app
 * streamed these off local disk; here they live in Supabase Storage and we hand the client a
 * short-lived signed URL instead of proxying bytes.
 *
 *   GET /api/crawls/:runId/pages/:pageId/screenshot?size=full|thumb  -> { url }
 *   GET /api/crawls/:runId/pages/:pageId/raw                         -> { url }
 *   GET /api/crawls/:runId/pages/:pageId/replay                      -> { url }
 *
 * Object conventions match the crawler's uploader (src/artifacts/supabaseUpload.ts):
 *   screenshots bucket:     <runId>/<pageId>.<thumb|full>.webp
 *   crawl-artifacts bucket: <runId>/<pageId>.html   (raw markup; replay renders from the same file)
 *
 * Parity: the current sync does not push these blobs yet, so most calls return a clean 404 with
 * { configured } telling the client WHY (storage off vs. blob simply absent) — it never crashes,
 * and it lights up with zero code change once the blobs are synced.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { mintSignedUrl } from "../../supabase/service.js";
import { isSafeId } from "../../lib/apiShared.js";
import type { Response } from "express";

export const blobsRouter = Router();

const SIGNED_URL_TTL_SEC = 300;

/**
 * Mint a signed URL for one object and answer the request. Three outcomes, none of them a 500:
 *   - Storage not configured    -> 404 { configured: false }  (SUPABASE_SERVICE_ROLE_KEY absent)
 *   - object missing / any error -> 404 { configured: true }   (blob not synced yet)
 *   - success                    -> 200 { url }
 */
async function respondWithSignedUrl(res: Response, bucket: string, objectPath: string): Promise<void> {
  try {
    const result = await mintSignedUrl(bucket, objectPath, SIGNED_URL_TTL_SEC);
    if (!result.configured) {
      res.status(404).json({ configured: false, reason: result.reason ?? "storage not configured" });
      return;
    }
    if (!result.url) {
      res.status(404).json({ configured: true, reason: "blob not found" });
      return;
    }
    res.json({ url: result.url });
  } catch (err) {
    // createSignedUrl throws when the object does not exist — a clean 404, not a crash.
    res.status(404).json({ configured: true, reason: err instanceof Error ? err.message : "blob not found" });
  }
}

blobsRouter.get(
  "/:runId/pages/:pageId/screenshot",
  asyncHandler(async (req, res) => {
    const { runId, pageId } = req.params;
    if (!isSafeId(runId) || !isSafeId(pageId)) {
      res.status(422).json({ error: "Invalid run or page id" });
      return;
    }
    const size = req.query.size === "full" ? "full" : "thumb";
    await respondWithSignedUrl(res, "screenshots", `${runId}/${pageId}.${size}.webp`);
  }),
);

blobsRouter.get(
  "/:runId/pages/:pageId/raw",
  asyncHandler(async (req, res) => {
    const { runId, pageId } = req.params;
    if (!isSafeId(runId) || !isSafeId(pageId)) {
      res.status(422).json({ error: "Invalid run or page id" });
      return;
    }
    await respondWithSignedUrl(res, "crawl-artifacts", `${runId}/${pageId}.html`);
  }),
);

blobsRouter.get(
  "/:runId/pages/:pageId/replay",
  asyncHandler(async (req, res) => {
    const { runId, pageId } = req.params;
    if (!isSafeId(runId) || !isSafeId(pageId)) {
      res.status(422).json({ error: "Invalid run or page id" });
      return;
    }
    // The replay view renders from the same captured raw HTML object.
    await respondWithSignedUrl(res, "crawl-artifacts", `${runId}/${pageId}.html`);
  }),
);

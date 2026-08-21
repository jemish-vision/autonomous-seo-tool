/**
 * Cloud artifact storage config status — the tiny endpoint the page-replay UI polls to decide
 * whether to show the "artifact storage not configured" notice.
 *
 *   GET /api/artifacts/status  ->  { configured: boolean, reason?: string }
 *
 * Mirrors the old Next.js app/api/artifacts/status route. "Configured" means the server-role
 * Supabase Storage client can be constructed (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set) —
 * the same `.configured` check every blob endpoint uses (server/src/supabase/service.ts). BUCKETS
 * is a static in-code definition, so once the service client is configured the buckets are too;
 * we deliberately do NOT call ensureBuckets() here (that is a live Storage round-trip and would
 * turn a cheap config probe into a slow, failure-prone network call).
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { getServiceClient } from "../../supabase/service.js";

export const artifactsRouter = Router();

artifactsRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const state = getServiceClient();
    if (state.configured) {
      res.json({ configured: true });
      return;
    }
    res.json({ configured: false, reason: state.reason });
  }),
);

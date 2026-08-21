/**
 * Express app assembly. The order matters and mirrors the old Next.js proxy.ts gate:
 *
 *   1. CORS + JSON body parsing
 *   2. PUBLIC routes (health/ready/version) — no auth
 *   3. requireAuth — default-deny gate for everything below
 *   4. PROTECTED /api modules
 *   5. 404 + error handler (last)
 *
 * Adding a new module = import its router and mount it in the "protected modules" block. It is
 * behind auth automatically — you must opt OUT (move it above requireAuth) to make it public,
 * never the reverse.
 */
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/error.js";

import { healthRouter } from "./modules/health/health.routes.js";
import { crawlsRouter } from "./modules/crawls/crawls.routes.js";
import { pagesRouter } from "./modules/pages/pages.routes.js";
import { issuesRouter } from "./modules/issues/issues.routes.js";
import { crawlMetaRouter } from "./modules/crawlMeta/crawlMeta.routes.js";
import { siteFilesRouter } from "./modules/siteFiles/siteFiles.routes.js";
import { linksRouter } from "./modules/links/links.routes.js";
import { imagesRouter } from "./modules/images/images.routes.js";
import { redirectsRouter } from "./modules/redirects/redirects.routes.js";
import { duplicatesRouter } from "./modules/duplicates/duplicates.routes.js";
import { overviewRouter } from "./modules/overview/overview.routes.js";
import { blobsRouter } from "./modules/blobs/blobs.routes.js";
import { gscRouter, gscPublicRouter } from "./modules/gsc/gsc.routes.js";
import { measurementsRouter } from "./modules/measurements/measurements.routes.js";
import { explorerRouter } from "./modules/explorer/explorer.routes.js";
import { compareRouter } from "./modules/compare/compare.routes.js";
import { queueRouter } from "./modules/queue/queue.routes.js";
import { aiRecommendationsRouter } from "./modules/aiRecommendations/aiRecommendations.routes.js";
import { aiRecommendationsGenerateRouter } from "./modules/aiRecommendations/aiRecommendationsGenerate.routes.js";
import { mutesRouter } from "./modules/mutes/mutes.routes.js";
import { crawlRunRouter, crawlEventsPublicRouter } from "./modules/crawlRun/crawlRun.routes.js";
import { automationRouter } from "./modules/automation/automation.routes.js";
import { fixPlanRouter } from "./modules/fixPlan/fixPlan.routes.js";
import { appliedFixesRouter } from "./modules/appliedFixes/appliedFixes.routes.js";
import { sourcesRouter } from "./modules/sources/sources.routes.js";
import { aiAccessRouter } from "./modules/aiAccess/aiAccess.routes.js";
import { exportsRouter, crawlExportsRouter } from "./modules/exports/exports.routes.js";
import { comparisonsRouter } from "./modules/comparisons/comparisons.routes.js";
import { tunnelPublicRouter, tunnelRouter } from "./modules/tunnel/tunnel.routes.js";
import { graphRouter } from "./modules/graph/graph.routes.js";
import { artifactsRouter } from "./modules/artifacts/artifacts.routes.js";

export function createApp(): express.Express {
  const app = express();

  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: "2mb" }));

  // --- public (no token required) ---
  app.use("/api", healthRouter);
  app.use("/api/gsc", gscPublicRouter); // PUBLIC — Google's OAuth callback (no JWT); must be before requireAuth
  app.use("/api/tunnel", tunnelPublicRouter); // PUBLIC — WP plugin verify/heartbeat/result (token in body, no JWT); must be before requireAuth
  app.use("/api/crawls", crawlEventsPublicRouter); // PUBLIC — SSE crawl events; EventSource can't send a bearer, so it auths via ?access_token= (must be before requireAuth)

  // --- default-deny gate ---
  app.use("/api", requireAuth);

  // --- protected modules ---
  app.use("/api/crawls", crawlsRouter);
  app.use("/api/crawls", crawlRunRouter); // POST / (start) + /:runId/{cancel,rerun,reanalyze,progress,events} — real crawl execution via the vendored worker
  app.use("/api/crawls", pagesRouter); // /:runId/pages, /:runId/pages/:pageId
  app.use("/api/crawls", issuesRouter); // /:runId/issues
  app.use("/api/crawls", crawlMetaRouter); // /:runId/meta (GET/PATCH)
  app.use("/api/crawls", siteFilesRouter); // /:runId/sitemaps, /:runId/site-files
  app.use("/api/crawls", linksRouter); // /:runId/links
  app.use("/api/crawls", imagesRouter); // /:runId/images
  app.use("/api/crawls", redirectsRouter); // /:runId/redirects
  app.use("/api/crawls", duplicatesRouter); // /:runId/duplicates
  app.use("/api/crawls", overviewRouter); // /:runId/overview
  app.use("/api/crawls", blobsRouter); // /:runId/pages/:pageId/{screenshot,raw,replay}
  app.use("/api/gsc", gscRouter); // /status, /connection, /sites, /properties, /metrics/:domain
  app.use("/api/crawls", measurementsRouter); // /:runId/measurements
  app.use("/api/crawls", explorerRouter); // /:runId/explorer
  app.use("/api/crawls", graphRouter); // /:runId/graph (internal-link graph + PageRank)
  app.use("/api/crawls", compareRouter); // /:headRunId/diff?base=:baseRunId
  app.use("/api/crawls", aiRecommendationsRouter); // /:runId/ai-recommendations
  app.use("/api/crawls", aiRecommendationsGenerateRouter); // POST /:runId/ai-recommendations/generate
  app.use("/api/crawls", automationRouter); // /:runId/automation (parity gap: empty)
  app.use("/api/crawls", fixPlanRouter); // /:runId/fix-plan (parity gap: empty)
  app.use("/api/crawls", appliedFixesRouter); // /:runId/applied-fixes (parity gap: empty)
  app.use("/api/crawls", aiAccessRouter); // /:runId/site-files/ai-access
  app.use("/api/mutes", mutesRouter); // POST/DELETE / -> mute/unmute a rule for the run's site
  app.use("/api/queue", queueRouter); // / -> { jobs, ... }
  app.use("/api/sources", sourcesRouter); // / -> CRUD + tunnel connect/seo (Supabase)
  app.use("/api/tunnel", tunnelRouter); // /pair, /sites (session-authed WordPress pairing)
  app.use("/api/crawls", crawlExportsRouter); // POST /:runId/exports
  app.use("/api/exports", exportsRouter); // GET /, /:id, /:id/download
  app.use("/api/comparisons", comparisonsRouter); // POST /, GET /, GET /:id (saved comparisons)
  app.use("/api/artifacts", artifactsRouter); // /status -> { configured, reason? }

  // --- fallthrough ---
  app.use("/api", notFound);
  app.use(errorHandler);

  return app;
}

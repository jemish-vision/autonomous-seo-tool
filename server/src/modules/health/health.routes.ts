/**
 * Liveness / readiness / version. Public (mounted before requireAuth) so a load balancer or the
 * frontend can probe the API without a token — mirrors the old /api/health, /api/ready,
 * /api/version routes.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});

healthRouter.get("/version", (_req, res) => {
  res.json({ name: "seo-platform-server", version: "1.0.0" });
});

// Readiness = can we actually reach Postgres? A green /health but red /ready is the classic
// "process is up but the DB is unreachable" signal.
healthRouter.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ready: true, db: "up" });
    } catch (err) {
      res.status(503).json({ ready: false, db: "down", message: err instanceof Error ? err.message : String(err) });
    }
  }),
);

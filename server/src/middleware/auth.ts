/**
 * Auth gate — the Express equivalent of the old Next.js proxy.ts default-deny middleware.
 *
 * The browser holds a Supabase session (supabase-js) and sends the access token as
 *   Authorization: Bearer <jwt>
 * on every /api call. Here we verify that token server-side with the service-role client and
 * attach the resolved user id to the request. No valid token -> 401.
 *
 * Public routes (health/ready/version, the GSC OAuth callback) skip this — they are mounted
 * before requireAuth in app.ts, exactly as proxy.ts kept a PUBLIC_EXACT_PATHS allowlist.
 */
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { verifyUserJwt } from "../supabase/service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length ? token : null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Escape hatch for local dev against seeded data — never enable in a deployed environment.
  if (!env.authRequired) {
    next();
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized", reason: "missing bearer token" });
    return;
  }

  const result = await verifyUserJwt(token);
  if (!result.configured) {
    // Service role not set: fail closed rather than silently letting everyone in.
    res.status(500).json({ error: "Auth not configured", reason: result.reason });
    return;
  }
  if (!result.valid) {
    res.status(401).json({ error: "Unauthorized", reason: result.reason ?? "invalid token" });
    return;
  }

  req.userId = result.userId;
  next();
}

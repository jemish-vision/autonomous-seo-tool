/**
 * Central error handling. Two pieces:
 *  - asyncHandler: wraps an async route so a thrown/rejected error reaches Express's error chain
 *    instead of hanging the request (Express 4 does not await route handlers).
 *  - errorHandler: the last middleware; turns any error into a clean JSON 500 and logs it.
 *  - notFound: JSON 404 for unmatched /api routes.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api] unhandled error:", message);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error", message });
}

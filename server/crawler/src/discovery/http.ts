/** Shared fetch-with-timeout for discovery. Callers catch — this never throws on timeout vs any other rejection differently. */
export const DISCOVERY_TIMEOUT_MS = 10_000;

/** The one identity this crawler ever sends. Never a browser string: a site must be able to write
 * a robots.txt rule that actually matches us on every request path, side requests included. */
export const DEFAULT_USER_AGENT = "seo-crawler-poc/0.1 (+poc; respectful)";

export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves a possibly-relative URL against origin; null when unparseable (evidence, not a throw). */
export function resolveAbsolute(raw: string, origin: string): string | null {
  try {
    return new URL(raw, origin).toString();
  } catch {
    return null;
  }
}

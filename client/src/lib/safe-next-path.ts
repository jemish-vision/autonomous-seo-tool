/**
 * Resolves a `?next=` redirect target against `baseUrl` and returns a same-origin path, or "/"
 * if it isn't one. Never pattern-match the raw string (a `next.startsWith("/") &&
 * !next.startsWith("//")` check misses backslash-based redirects — the WHATWG URL parser treats
 * `\` as `/` for special schemes, so `/\evil.com` resolves to origin evil.com even though it
 * looks like a path) — always parse and compare real origins instead.
 */
export function safeNextPath(next: string | null | undefined, baseUrl: string): string {
  if (!next) return "/";
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(next, baseUrl);
    if (resolved.origin === base.origin) {
      return resolved.pathname + resolved.search + resolved.hash;
    }
  } catch {
    // Malformed input the URL parser rejects outright — fall through to the safe default.
  }
  return "/";
}

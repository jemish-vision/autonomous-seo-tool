/** Slice B2 implements. Guard rails for authenticated crawls — see CrawlSafety in models. */
import type { CrawlAuth, CrawlSafety, SkippedUrlRecord } from "../models/types";

/** Paths that would end the crawler's own session. */
export const LOGOUT_PATTERNS = ["/logout", "/log-out", "/signout", "/sign-out", "/logoff", "/log-off"];

/** GET endpoints that commonly mutate or destroy state when hit while authenticated. */
export const DESTRUCTIVE_PATTERNS = [
  "/delete",
  "/remove",
  "/destroy",
  "/cancel",
  "/unsubscribe",
  "/revoke",
  "/purge",
  "/reset",
  "/deactivate",
  "/archive/",
];

/** Safety defaults: strict when credentials are present, permissive when crawling anonymously. */
export function defaultSafety(auth: CrawlAuth | null | undefined): CrawlSafety {
  const authenticated = !!auth && (auth.basic !== null || auth.cookie !== null || Object.keys(auth.headers).length > 0);
  return { excludePatterns: [], denyLogout: authenticated, denyDestructive: authenticated };
}

/**
 * C1 fix (live-verified via authenticated E2E crawl): pathname-only matching let a query-string-only
 * bait — "/api/session?action=logout" — evade the /logout pattern entirely while a decoy plain
 * "/logout" link got caught; the crawler followed the real one and actually logged itself out.
 * Including the search string closes that gap for every authenticated crawl, not just form-login.
 */
function pathOf(normalizedUrl: string): string {
  try {
    const u = new URL(normalizedUrl);
    return (u.pathname + u.search).toLowerCase();
  } catch {
    return normalizedUrl.toLowerCase();
  }
}

/**
 * Word-boundary form: collapse every run of non-alphanumeric chars to "-" and wrap in "-".
 * A substring check between two wrapped forms is then a true word-boundary match — "/delete"
 * hits "/members/reports/q1/delete" and "/delete/123" but NOT "/undeleted-items" (the segment
 * "undeleted-items" tokenizes to "undeleted"+"items", neither equal to "delete"). Multi-word
 * patterns like "/log-out" still match compound segments like "/how-to-log-out" the same way.
 */
function wordBoundaryForm(s: string): string {
  return `-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-`;
}

function matchesPattern(path: string, pattern: string): boolean {
  return wordBoundaryForm(path).includes(wordBoundaryForm(pattern));
}

/**
 * Decide whether a URL must not be fetched. Returns the record to store as evidence, or null
 * when the URL is safe to crawl.
 *
 * Matching rule: user excludePatterns use a literal case-insensitive substring check (per the
 * CrawlSafety.excludePatterns doc comment in models/types.ts — a user typed these directly and
 * expects a plain substring). The built-in LOGOUT_PATTERNS/DESTRUCTIVE_PATTERNS instead use the
 * word-boundary check above, so a short pattern like "/delete" doesn't false-positive on
 * unrelated words that merely contain those letters (e.g. "undeleted-items").
 */
export function checkSafety(
  normalizedUrl: string,
  foundOn: string | null,
  safety: CrawlSafety,
): SkippedUrlRecord | null {
  const path = pathOf(normalizedUrl);

  for (const pattern of safety.excludePatterns) {
    if (path.includes(pattern.toLowerCase())) {
      return { url: normalizedUrl, reason: "user-excluded", matchedPattern: pattern, foundOn };
    }
  }
  if (safety.denyLogout) {
    for (const pattern of LOGOUT_PATTERNS) {
      if (matchesPattern(path, pattern)) {
        return { url: normalizedUrl, reason: "logout", matchedPattern: pattern, foundOn };
      }
    }
  }
  if (safety.denyDestructive) {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (matchesPattern(path, pattern)) {
        return { url: normalizedUrl, reason: "destructive", matchedPattern: pattern, foundOn };
      }
    }
  }
  return null;
}

/**
 * Request headers for the configured credentials. Custom headers are applied last so an operator
 * can override Authorization/Cookie via --header when neither Basic nor the raw cookie form fits.
 */
export function authHeaders(auth: CrawlAuth | null | undefined): Record<string, string> {
  if (!auth) return {};
  const out: Record<string, string> = {};
  if (auth.basic) {
    out.Authorization = `Basic ${Buffer.from(`${auth.basic.username}:${auth.basic.password}`).toString("base64")}`;
  }
  if (auth.cookie) {
    out.Cookie = auth.cookie;
  }
  Object.assign(out, auth.headers);
  return out;
}

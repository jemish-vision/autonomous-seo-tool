/** Slice A4 — shared utilities for site rules. */
import type { CrawledPage, IssueSeverity, LinkRecord } from "../../../models/types";
import type { AnalysisConfig } from "../../config";
import { RunStore } from "../../../storage/runStore";

/** Pathname of a URL, trailing slash stripped except root — mirrors scripts/lib/records.ts's
 * pathnameOf so crawler evidence and analyzer findings key the same way (alias/redirect-safe). */
export function pathnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const p = new URL(url).pathname;
    return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  } catch {
    return null;
  }
}

/** First path segment as a section prefix, e.g. "/blog/foo" -> "/blog", "/" -> "/". Sanity guard
 * for near-dup pairing (spec: "same section path prefix"). */
export function sectionPrefix(pathname: string | null): string | null {
  if (!pathname) return null;
  if (pathname === "/") return "/";
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "/";
}

export function pageIdFor(normalizedUrl: string): string {
  return RunStore.pageIdFor(normalizedUrl);
}

/** Crawl identity URL for a page (what the crawler requested), preferred over finalUrl for
 * evidence — a redirected page's identity is the URL that was asked for. */
export function primaryUrl(page: CrawledPage): string {
  return page.normalizedUrl ?? page.url;
}

export function pageByPath(pages: CrawledPage[], pathname: string): CrawledPage | undefined {
  return pages.find(
    (p) => pathnameOf(primaryUrl(p)) === pathname || pathnameOf(p.finalUrl) === pathname,
  );
}

export interface InlinkOccurrence {
  source: CrawledPage;
  linkIndex: number;
  link: LinkRecord;
}

/** target pathname -> every internal INBOUND link occurrence pointing at it, keeping the source
 * page + array index so callers can build evidence pointers that resolve to a real links[N]
 * field. Self-links are excluded here rather than per-consumer: a page linking to itself is not
 * a vote from elsewhere, and filtering it downstream let the same run report three different
 * inlink counts depending on who asked. */
export function buildInlinkOccurrences(pages: CrawledPage[]): Map<string, InlinkOccurrence[]> {
  const map = new Map<string, InlinkOccurrence[]>();
  for (const page of pages) {
    // Both identities, since a redirected page is reachable under either pathname.
    const selfPaths = new Set(
      [pathnameOf(primaryUrl(page)), pathnameOf(page.finalUrl)].filter((p): p is string => p !== null),
    );
    page.links.forEach((link, linkIndex) => {
      if (link.type !== "internal") return;
      const targetPath = pathnameOf(link.targetNormalized ?? link.target);
      if (!targetPath || selfPaths.has(targetPath)) return;
      const list = map.get(targetPath);
      const occurrence = { source: page, linkIndex, link };
      if (list) list.push(occurrence);
      else map.set(targetPath, [occurrence]);
    });
  }
  return map;
}

/** Groups pages by a key, dropping singleton groups (clusters need >= 2 members). */
export function buildClusters<K>(
  pages: CrawledPage[],
  keyOf: (p: CrawledPage) => K | null,
): Map<K, CrawledPage[]> {
  const map = new Map<K, CrawledPage[]>();
  for (const p of pages) {
    const k = keyOf(p);
    if (k === null) continue;
    const arr = map.get(k);
    if (arr) arr.push(p);
    else map.set(k, [p]);
  }
  for (const [k, arr] of map) if (arr.length < 2) map.delete(k);
  return map;
}

export function isRuleEnabled(ruleId: string, config: AnalysisConfig): boolean {
  return config.rules[ruleId]?.enabled !== false;
}

export function resolvedSeverity(
  ruleId: string,
  defaultSeverity: IssueSeverity,
  config: AnalysisConfig,
): IssueSeverity {
  return config.rules[ruleId]?.severity ?? defaultSeverity;
}

/** A page is "failed" (never resolved to usable content) at this pathname per failures.json,
 * classed as an HTTP error (4xx/5xx) — used by canonical/broken-link cross-referencing. */
export function httpFailurePaths(
  failures: { normalizedUrl: string | null; url: string; reason: string }[],
): Set<string> {
  const set = new Set<string>();
  for (const f of failures) {
    if (f.reason !== "http-4xx" && f.reason !== "http-5xx") continue;
    const p = pathnameOf(f.normalizedUrl ?? f.url);
    if (p) set.add(p);
  }
  return set;
}

/** 401/403 means "credentials required", not "broken" — an anonymous crawl is SUPPOSED to get
 * these on a protected area, so they must not be reported as dead links. */
export const AUTH_REQUIRED_STATUSES = new Set([401, 403]);

/** Failed path -> status code, so callers can tell an auth wall from a dead page. */
export function httpFailureStatusByPath(
  failures: { normalizedUrl: string | null; url: string; reason: string; statusCode: number | null }[],
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const f of failures) {
    if (f.reason !== "http-4xx" && f.reason !== "http-5xx") continue;
    const p = pathnameOf(f.normalizedUrl ?? f.url);
    if (p && !map.has(p)) map.set(p, f.statusCode);
  }
  return map;
}

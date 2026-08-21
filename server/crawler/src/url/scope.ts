/** Slice S1 implements. */
import { getDomain } from "tldts";
import type { CrawlScope } from "../models/types";
import { normalizeUrl } from "./normalize";

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** True when host equals alias or is the www/non-www counterpart of it (case-insensitive). */
function matchesAlias(host: string, aliases: string[]): boolean {
  const stripped = stripWww(host);
  return aliases.some((alias) => stripWww(alias) === stripped);
}

/** Derive the crawl scope from a (normalized) start URL. */
export function deriveScope(startUrl: string, hostAliases: string[] = []): CrawlScope {
  const seedUrl = normalizeUrl(startUrl);
  if (!seedUrl) throw new Error(`deriveScope: invalid start URL "${startUrl}"`);

  const parsed = new URL(seedUrl);
  const registrableDomain = getDomain(parsed.hostname) ?? "";
  const fallbackHost = registrableDomain === "" ? parsed.host : null;

  const dedupedAliases = [...new Set(hostAliases.map((h) => h.toLowerCase().trim()).filter(Boolean))];

  return {
    registrableDomain,
    fallbackHost,
    hostAliases: dedupedAliases,
    seedOrigin: parsed.origin,
    seedUrl,
  };
}

/** Same registrable domain (www/non-www/subdomains in scope), aliased hosts too; host[:port] match for localhost/IPs. */
export function isInScope(normalizedUrl: string, scope: CrawlScope): boolean {
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return false;
  }

  if (scope.registrableDomain !== "" && getDomain(parsed.hostname) === scope.registrableDomain) {
    return true;
  }
  if (scope.fallbackHost !== null && parsed.host === scope.fallbackHost) {
    return true;
  }
  return matchesAlias(parsed.hostname, scope.hostAliases);
}

/**
 * If url's host is an alias (or a www/non-www variant of one), rewrite scheme+host onto
 * scope.seedOrigin so queue identity + sitemap cross-ref line up. Non-aliased URLs pass through.
 */
export function remapAliasedUrl(url: string, scope: CrawlScope): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!matchesAlias(parsed.hostname, scope.hostAliases)) return url;

  const seedOrigin = new URL(scope.seedOrigin);
  parsed.protocol = seedOrigin.protocol;
  parsed.hostname = seedOrigin.hostname;
  parsed.port = seedOrigin.port;
  return parsed.toString();
}

/** Stable dedup identity for the crawl frontier — normalizeUrl already IS the canonical key. */
export function uniqueKeyFor(normalizedUrl: string): string {
  return normalizedUrl;
}

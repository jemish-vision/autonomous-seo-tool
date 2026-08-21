/**
 * URL + domain normalisation for the Search Console integration.
 *
 * The join key between Search Console and the crawl is the crawler's own normalizedUrl. Google
 * reports "https://site.com/post/xyz/" while the crawl stores "https://site.com/post/xyz", so
 * matching on the raw URL silently misses — and a miss shows a crawled page as "never crawled",
 * the worst kind of wrong for a diagnostic.
 *
 * Ported from poc/seo-dashboard/lib/gsc/url.ts (+ the domainKey normaliser that lived in that app's
 * storage.ts). Keep in lock-step with the crawler's src/url/normalize.ts.
 */

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAM_EXACT = new Set(["gclid", "fbclid", "msclkid", "ref"]);

/** Normalize a raw URL into its canonical crawl identity (mirrors crawler normalizeUrl). */
export function normalizeUrl(raw: string, base?: string): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }

  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") return null;
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  const seen = new Set<string>();
  const kept: Array<[string, string]> = [];
  for (const [k, value] of url.searchParams) {
    const lowerKey = k.toLowerCase();
    if (TRACKING_PARAM_PREFIXES.some((p) => lowerKey.startsWith(p))) continue;
    if (TRACKING_PARAM_EXACT.has(lowerKey)) continue;
    const dedupeKey = `${k}=${value}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    kept.push([k, value]);
  }
  kept.sort(([ka, va], [kb, vb]) => {
    if (ka !== kb) return ka < kb ? -1 : 1;
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/** The join key between a GSC-reported URL and the crawl's pages.normalizedUrl. */
export function toJoinKey(pageUrl: string): string | null {
  return normalizeUrl(pageUrl, pageUrl);
}

/** Lowercased hostname of a URL, or null when unparseable. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Normalise a bare domain (strip protocol, www, trailing slash, whitespace, port). */
export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      value = value.replace(/^https?:\/\//i, "").split("/")[0] ?? value;
    }
  }
  value = value.split("/")[0] ?? value;
  value = value.split("?")[0] ?? value;
  value = value.replace(/^www\./i, "");
  value = value.replace(/:\d+$/, "");
  return value;
}

/**
 * Normalise a domain for use as a stable storage key. Mirrors the old JSON store's domainKey
 * (which doubled as a path-traversal guard); the same key is what every gsc* store row is keyed by.
 */
export function domainKey(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/^www\./i, "").replace(/:\d+$/, "");
  return normalized.replace(/[^a-z0-9._-]/g, "-") || "unknown";
}

/** Whether a GSC property plausibly covers a crawled domain (for the picker's sort). */
export function propertyMatchesDomain(siteUrl: string, domain: string): boolean {
  const bare = normalizeDomain(domain);
  if (siteUrl.startsWith("sc-domain:")) {
    return normalizeDomain(siteUrl.slice("sc-domain:".length)) === bare;
  }
  try {
    return normalizeDomain(new URL(siteUrl).hostname) === bare;
  } catch {
    return false;
  }
}

/** Infer the property type from the string Search Console reports. */
export function propertyTypeOf(siteUrl: string): "domain" | "url_prefix" {
  return siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix";
}

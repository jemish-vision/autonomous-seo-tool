/** Slice S1 implements. See spec.md S1 for the normalization rules. */

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAM_EXACT = new Set(["gclid", "fbclid", "msclkid", "ref"]);

/**
 * Normalize a raw href into its canonical crawl identity.
 * Returns null for non-crawlable schemes (mailto:, tel:, javascript:, data:, non-http(s)) and
 * for anything the URL parser rejects — this must never throw, callers rely on that.
 * @param raw href as authored (may be relative)
 * @param base absolute URL to resolve relative hrefs against
 */
export function normalizeUrl(raw: string, base?: string): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }

  // WHATWG URL parsing already lowercases scheme/host and drops the default port for
  // http/https on assignment; the explicit lowercasing below is defensive, not load-bearing.
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") return null;
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  // Query params: drop tracking params, collapse exact key=value dupes, sort deterministically.
  const seen = new Set<string>();
  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams) {
    const lowerKey = key.toLowerCase();
    if (TRACKING_PARAM_PREFIXES.some((p) => lowerKey.startsWith(p))) continue;
    if (TRACKING_PARAM_EXACT.has(lowerKey)) continue;
    const dedupeKey = `${key}=${value}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    kept.push([key, value]);
  }
  kept.sort(([ka, va], [kb, vb]) => {
    if (ka !== kb) return ka < kb ? -1 : 1;
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);

  // Trailing slash strip, root path excepted.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/** Font-origin detection — a GDPR finding, not just a perf one: German courts have ruled that
 * loading Google Fonts from Google's own servers transmits the visitor's IP without consent.
 * Static-path only (no browser); usedFamilies stays unset until a browser pass observes them. */
import { getDomain } from "tldts";
import type { CheerioAPI } from "cheerio";
import type { FontFaceRecord, FontReport } from "../models/types";
import { resolveAbsolute, resolveBase } from "./shared";

/** Exact-match hosts known to serve fonts (CSS or files) via a dedicated font domain. */
const KNOWN_FONT_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "use.typekit.net",
  "p.typekit.net",
  "fonts.adobe.com",
  "fonts.bunny.net",
  "fast.fonts.net",
  "use.fontawesome.com",
  "kit.fontawesome.com",
  "use.edgefonts.net",
]);

/** Generic CDNs that serve far more than fonts — only counted when the URL itself hints "font". */
const GENERIC_CDN_HOSTS = new Set(["cdn.jsdelivr.net", "unpkg.com"]);
const FONT_PATH_HINT_RE = /font/i;

function isFontStylesheetHost(hostname: string, href: string): boolean {
  const host = hostname.toLowerCase();
  if (KNOWN_FONT_HOSTS.has(host)) return true;
  if (GENERIC_CDN_HOSTS.has(host)) return FONT_PATH_HINT_RE.test(href);
  return false;
}

/** Same eTLD+1 comparison as url/scope.ts's isInScope — a font on a same-site subdomain isn't
 * the GDPR-relevant "third party", only a genuinely different registrable domain is. */
function classifyOrigin(sourceUrl: string, pageUrl: string): { origin: FontFaceRecord["origin"]; host: string | null } {
  let sourceHost: string;
  try {
    sourceHost = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return { origin: "third-party", host: null };
  }
  let pageHost = "";
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    // unparseable pageUrl — fall through with empty pageHost so registrable comparison below fails safe
  }
  const sourceRegistrable = getDomain(sourceHost) ?? sourceHost;
  const pageRegistrable = getDomain(pageHost) ?? pageHost;
  const origin = sourceRegistrable !== "" && sourceRegistrable === pageRegistrable ? "same-origin" : "third-party";
  return { origin, host: sourceHost };
}

function cleanFamily(raw: string | null): string {
  if (!raw) return "";
  const first = raw.split(",")[0]!.trim();
  return first.replace(/^['"]|['"]$/g, "").trim();
}

function firstDeclValue(body: string, prop: string): string | null {
  const m = new RegExp(`${prop}\\s*:\\s*([^;}]+)`, "i").exec(body);
  return m ? m[1]!.trim() : null;
}

function extractUrls(body: string): string[] {
  const out: string[] = [];
  const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const raw = m[2]!.trim();
    if (raw) out.push(raw);
  }
  return out;
}

/** Bracket-matched (not line-based) so nested braces and unterminated rules never desync the scan. */
function extractFontFaceBodies(css: string): string[] {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const bodies: string[] = [];
  const marker = /@font-face/gi;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(cleaned)) !== null) {
    const braceStart = cleaned.indexOf("{", m.index);
    if (braceStart === -1) break; // no "{" anywhere after — nothing left worth scanning

    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < cleaned.length; i++) {
      if (cleaned[i] === "{") depth++;
      else if (cleaned[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    bodies.push(end === -1 ? cleaned.slice(braceStart + 1) : cleaned.slice(braceStart + 1, end));
    marker.lastIndex = end === -1 ? cleaned.length : end + 1; // unterminated rule: nothing more to find
  }
  return bodies;
}

/**
 * Parses `@font-face` rules out of a CSS string into one record per `url()` source. `base`
 * resolves relative url()s (the stylesheet's own URL for external CSS, the page URL for inline
 * <style>); `pageUrl` is what same-origin/third-party is measured against — the two differ when
 * parsing a fetched external stylesheet. Never throws; malformed/empty input yields [].
 */
export function parseFontFaceCss(css: string, base: string, pageUrl: string): FontFaceRecord[] {
  if (!css || !css.trim()) return [];
  const out: FontFaceRecord[] = [];
  for (const body of extractFontFaceBodies(css)) {
    const family = cleanFamily(firstDeclValue(body, "font-family"));
    const display = firstDeclValue(body, "font-display");
    for (const rawUrl of extractUrls(body)) {
      const source = resolveAbsolute(rawUrl, base);
      if (source === null) continue;
      const { origin, host } = classifyOrigin(source, pageUrl);
      out.push({ family, source, origin, host, display, preloaded: false, preloadMissingCrossorigin: false });
    }
  }
  return out;
}

function extractPreloadFonts($: CheerioAPI, pageUrl: string): FontFaceRecord[] {
  const out: FontFaceRecord[] = [];
  $("link[href]").each((_, el) => {
    const $el = $(el);
    const relTokens = ($el.attr("rel") ?? "").toLowerCase().split(/\s+/);
    if (!relTokens.includes("preload") || ($el.attr("as") ?? "").toLowerCase() !== "font") return;
    const hrefRaw = $el.attr("href");
    const source = hrefRaw ? resolveAbsolute(hrefRaw.trim(), pageUrl) : null;
    if (source === null) return;
    const { origin, host } = classifyOrigin(source, pageUrl);
    out.push({
      family: "", // preload declares no family — this is a resource hint, not a @font-face
      source,
      origin,
      host,
      display: null,
      preloaded: true,
      // fonts always fetch in anonymous CORS mode, so a preload without crossorigin never
      // matches the real request and gets downloaded twice — zero false positives.
      preloadMissingCrossorigin: $el.attr("crossorigin") === undefined,
    });
  });
  return out;
}

/** Best-effort family from a Google-Fonts-style `?family=Name:wght@400;700` query param. */
function familyFromFontStylesheetUrl(absoluteUrl: string): string {
  try {
    const families = new URL(absoluteUrl).searchParams
      .getAll("family")
      .map((f) => f.split(":")[0]!.trim())
      .filter(Boolean);
    return [...new Set(families)].join(", ");
  } catch {
    return "";
  }
}

function extractFontStylesheetLinks($: CheerioAPI, pageUrl: string): FontFaceRecord[] {
  const out: FontFaceRecord[] = [];
  $("link[href]").each((_, el) => {
    const $el = $(el);
    const relTokens = ($el.attr("rel") ?? "").toLowerCase().split(/\s+/);
    if (!relTokens.includes("stylesheet")) return;
    const hrefRaw = $el.attr("href");
    const source = hrefRaw ? resolveAbsolute(hrefRaw.trim(), pageUrl) : null;
    if (source === null) return;

    let hostname: string;
    try {
      hostname = new URL(source).hostname;
    } catch {
      return;
    }
    if (!isFontStylesheetHost(hostname, source)) return;

    const { origin, host } = classifyOrigin(source, pageUrl);
    out.push({
      family: familyFromFontStylesheetUrl(source),
      source,
      origin,
      host,
      display: null, // the @font-face rules live in the stylesheet we haven't fetched
      preloaded: false,
      preloadMissingCrossorigin: false,
    });
  });
  return out;
}

/** Static-path font evidence: inline @font-face, preload hints, and known-font-host stylesheets. */
export function extractFonts($: CheerioAPI, pageUrl: string): FontReport {
  const base = resolveBase($, pageUrl);

  const styleFaces: FontFaceRecord[] = [];
  $("style").each((_, el) => {
    styleFaces.push(...parseFontFaceCss($(el).html() ?? "", base, pageUrl));
  });

  const faces = [...styleFaces, ...extractPreloadFonts($, pageUrl), ...extractFontStylesheetLinks($, pageUrl)];

  const thirdPartyHosts = [
    ...new Set(faces.filter((f) => f.origin === "third-party" && f.host !== null).map((f) => f.host as string)),
  ].sort();

  return { faces, thirdPartyHosts };
}

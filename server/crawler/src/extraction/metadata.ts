import type { CheerioAPI } from "cheerio";
import type { MetaRefresh, RobotsMeta } from "../models/types";
import { collapseWhitespace, resolveAbsolute } from "./shared";

/** meta[name] matching is case-insensitive per HTML convention; cheerio attr selectors aren't. */
function findMetaContent($: CheerioAPI, name: string): string | undefined {
  let found: string | undefined;
  $("meta[name]").each((_, el) => {
    if (($(el).attr("name") ?? "").toLowerCase() === name) {
      found = $(el).attr("content");
      return false;
    }
  });
  return found;
}

/** meta-refresh is authored via http-equiv=, not name= — separate lookup, same case-insensitive matching. */
function findMetaHttpEquivContent($: CheerioAPI, httpEquiv: string): string | undefined {
  let found: string | undefined;
  $("meta[http-equiv]").each((_, el) => {
    if (($(el).attr("http-equiv") ?? "").toLowerCase() === httpEquiv) {
      found = $(el).attr("content");
      return false;
    }
  });
  return found;
}

export function extractTitle($: CheerioAPI): string | null {
  const el = $("title").first();
  return el.length === 0 ? null : collapseWhitespace(el.text());
}

export function extractMetaDescription($: CheerioAPI): string | null {
  const content = findMetaContent($, "description");
  return content == null ? null : collapseWhitespace(content);
}

/** Every <title>, document order — [] when none. Multiple <title> elements are themselves an SEO issue. */
export function extractTitles($: CheerioAPI): string[] {
  return $("title").map((_, el) => collapseWhitespace($(el).text())).get();
}

/** Every meta description, document order — [] when none. */
export function extractMetaDescriptions($: CheerioAPI): string[] {
  const out: string[] = [];
  $("meta[name]").each((_, el) => {
    if (($(el).attr("name") ?? "").toLowerCase() === "description") {
      const content = $(el).attr("content");
      if (content != null) out.push(collapseWhitespace(content));
    }
  });
  return out;
}

export function extractMetaKeywords($: CheerioAPI): string | null {
  const content = findMetaContent($, "keywords");
  return content == null ? null : collapseWhitespace(content);
}

/** "<seconds>[;url=<target>]" per the meta-refresh spec; malformed content keeps raw, delay/url null. */
const META_REFRESH_RE = /^\s*([\d.]+)\s*(?:;\s*url\s*=\s*(.+))?\s*$/i;

export function extractMetaRefresh($: CheerioAPI, base: string): MetaRefresh | null {
  const content = findMetaHttpEquivContent($, "refresh");
  if (content == null) return null;
  const raw = content;

  const match = META_REFRESH_RE.exec(content);
  if (!match) return { delaySeconds: null, url: null, raw };

  const delaySeconds = Number(match[1]);
  let url: string | null = null;
  if (match[2]) {
    const urlRaw = match[2].trim().replace(/^['"]|['"]$/g, ""); // strip optional quotes around the target URL
    url = urlRaw ? resolveAbsolute(urlRaw, base) : null;
  }

  return { delaySeconds: Number.isFinite(delaySeconds) ? delaySeconds : null, url, raw };
}

export function extractCanonical($: CheerioAPI, base: string): string | null {
  let href: string | undefined;
  $("link[rel]").each((_, el) => {
    const relTokens = ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/);
    if (relTokens.includes("canonical")) {
      href = $(el).attr("href");
      return false;
    }
  });
  if (!href || !href.trim()) return null;
  return resolveAbsolute(href.trim(), base);
}

/** "none" is real-world shorthand for noindex+nofollow (Google's robots meta spec) — treated as both tokens. */
export function extractRobotsMeta($: CheerioAPI, headers: Record<string, string>): RobotsMeta {
  const raw: string[] = [];
  $("meta[name]").each((_, el) => {
    const name = ($(el).attr("name") ?? "").toLowerCase();
    if (name === "robots" || name === "googlebot") {
      const content = $(el).attr("content");
      if (content != null) raw.push(content);
    }
  });
  const xRobotsTag = headers["x-robots-tag"];
  if (xRobotsTag) raw.push(xRobotsTag);

  const tokens = raw.flatMap((value) =>
    value.split(",").map((part) => {
      const trimmed = part.trim().toLowerCase();
      const colon = trimmed.indexOf(":"); // strip optional "googlebot:" agent prefix (X-Robots-Tag)
      return colon >= 0 ? trimmed.slice(colon + 1).trim() : trimmed;
    })
  );

  return {
    meta: raw,
    noindex: tokens.includes("noindex") || tokens.includes("none"),
    nofollow: tokens.includes("nofollow") || tokens.includes("none"),
  };
}

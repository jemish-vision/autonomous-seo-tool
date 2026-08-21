/** Helpers shared by the extractor modules. Kept pure — no cheerio mutation of the caller's tree. */
import type { CheerioAPI } from "cheerio";

/** Collapse embedded newlines/runs of whitespace (common in JSX-formatted markup) then trim. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Effective resolution base: <base href> (resolved against finalUrl) if present, else finalUrl. */
export function resolveBase($: CheerioAPI, finalUrl: string): string {
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref && baseHref.trim()) {
    try {
      return new URL(baseHref.trim(), finalUrl).href;
    } catch {
      // malformed <base href> — fall back to finalUrl below
    }
  }
  return finalUrl;
}

/** width/height attributes are unitless per HTML spec — reject "100%", "auto", etc. */
export function parseIntAttr(v: string | undefined): number | null {
  if (v == null) return null;
  const t = v.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Lowercased extension from a resolved absolute URL's path, null if none. */
export function extractFormat(absoluteUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(absoluteUrl).pathname;
  } catch {
    return null;
  }
  const lastSegment = pathname.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot === -1 || dot === lastSegment.length - 1) return null;
  return lastSegment.slice(dot + 1).toLowerCase();
}

/** Resolve href against base; returns null (not throws) on unparseable URLs. */
export function resolveAbsolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

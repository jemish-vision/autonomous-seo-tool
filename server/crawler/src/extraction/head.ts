/** Head-boundary, charset and <base> facts. Per HTML tree construction any element outside the
 * head-permitted set implicitly closes <head>, and Google "stops reading any further elements" —
 * so metadata after that point is present in source but invisible. cheerio's parser is parse5,
 * which already models this, so the boundary falls out of where nodes actually landed. */
import type { CheerioAPI } from "cheerio";
import type { BaseHrefInfo, CharsetInfo, HeadBoundary } from "../models/types";

/** Elements the "in head" insertion mode accepts; anything else terminates the head. */
const HEAD_PERMITTED = new Set([
  "base", "basefont", "bgsound", "link", "meta", "title", "noscript", "noframes", "style", "script", "template",
]);

/** charset must serialize inside the first 1024 bytes or the prescan never sees it. */
const CHARSET_PRESCAN_LIMIT = 1024;

/** honoured reflects Google's PER-SIGNAL rules: it ignores a body canonical but explicitly
 * respects a body meta robots. One blanket "outside head" verdict would be wrong. */
const STRANDED_SIGNALS: { signal: string; selector: string; honoured: boolean }[] = [
  { signal: "canonical", selector: "link[rel=canonical]", honoured: false },
  { signal: "hreflang", selector: "link[rel=alternate][hreflang]", honoured: false },
  { signal: "meta-robots", selector: "meta[name=robots], meta[name=googlebot]", honoured: true },
  { signal: "meta-description", selector: "meta[name=description]", honoured: false },
  { signal: "title", selector: "title", honoured: false },
  { signal: "open-graph", selector: 'meta[property^="og:"]', honoured: false },
  { signal: "twitter-card", selector: 'meta[name^="twitter:"], meta[property^="twitter:"]', honoured: false },
];

function startOffsetOf(node: unknown): number | null {
  const loc = (node as { sourceCodeLocation?: { startOffset?: number } } | null)?.sourceCodeLocation;
  return typeof loc?.startOffset === "number" ? loc.startOffset : null;
}

function tagNameOf(node: unknown): string {
  return String((node as { tagName?: string } | null)?.tagName ?? "").toLowerCase();
}

/**
 * Where <head> effectively ended, and which SEO signals were orphaned past it.
 * `closedBy` is reported only when a signal was actually stranded — a head that closes early
 * with nothing of value after it causes no harm and should not raise an issue.
 */
export function extractHeadBoundary($: CheerioAPI): HeadBoundary {
  const elementCount = $("head").children().length;

  const stranded: HeadBoundary["stranded"] = [];
  for (const { signal, selector, honoured } of STRANDED_SIGNALS) {
    // Inside <template> the content is inert, so it was never a live signal to begin with.
    $("body").find(selector).each((_, el) => {
      if ($(el).parents("template").length > 0) return;
      stranded.push({ signal, tag: tagNameOf(el), honoured });
    });
  }

  let closedBy: string | null = null;
  let closedAtOffset: number | null = null;
  if (stranded.length > 0) {
    const culprit = $("body")
      .children()
      .toArray()
      .find((el) => !HEAD_PERMITTED.has(tagNameOf(el)));
    if (culprit) {
      closedBy = tagNameOf(culprit);
      closedAtOffset = startOffsetOf(culprit);
    }
  }

  return { elementCount, closedBy, closedAtOffset, stranded };
}

function charsetFromContentType(value: string | undefined): string | null {
  if (!value) return null;
  const m = /charset\s*=\s*["']?([^"';,\s]+)/i.exec(value);
  return m ? m[1]!.toLowerCase() : null;
}

/** Precedence per the encoding sniffing algorithm: BOM > HTTP header > meta prescan. */
export function extractCharset(
  $: CheerioAPI,
  html: string,
  headers?: Record<string, string>,
): CharsetInfo {
  const metaEl = $("meta[charset]").get(0) ?? $('meta[http-equiv="content-type" i]').get(0) ?? null;
  const metaOffset = metaEl ? startOffsetOf(metaEl) : null;
  const metaValue = metaEl
    ? ($(metaEl).attr("charset")?.trim().toLowerCase() ?? charsetFromContentType($(metaEl).attr("content")))
    : null;

  if (html.charCodeAt(0) === 0xfeff) {
    return { value: "utf-8", source: "bom", metaOffset, effective: true };
  }

  const headerValue = charsetFromContentType(headers?.["content-type"]);
  if (headerValue) {
    return { value: headerValue, source: "header", metaOffset, effective: true };
  }

  if (metaValue) {
    // A declaration past 1024 bytes is valid HTML that silently does not take effect.
    const effective = metaOffset !== null && metaOffset < CHARSET_PRESCAN_LIMIT;
    return { value: metaValue, source: "meta", metaOffset, effective };
  }

  return { value: null, source: null, metaOffset, effective: false };
}

/** All but the first <base href> are ignored per spec — the count is the finding. */
export function extractBaseHrefInfo($: CheerioAPI): BaseHrefInfo {
  const all = $("base[href]");
  const first = all.first().attr("href")?.trim();
  return { href: first ? first : null, count: all.length };
}

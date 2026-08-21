import type { CheerioAPI } from "cheerio";
import type { CrawlScope, LinkRecord } from "../models/types";
import { normalizeUrl, isInScope } from "../url";
import { collapseWhitespace, resolveAbsolute } from "./shared";

/** Not crawl links — decision: excluded from evidence entirely (see spec.md S2). */
const NON_CRAWL_SCHEME_RE = /^(mailto|tel|javascript|sms|fax):/i;

export function extractLinks(
  $: CheerioAPI,
  base: string,
  finalUrl: string,
  scope: CrawlScope
): LinkRecord[] {
  const out: LinkRecord[] = [];
  $("a[href]").each((_, el) => {
    const hrefRaw = $(el).attr("href");
    if (hrefRaw == null) return;
    const href = hrefRaw.trim();
    if (href === "" || href.startsWith("#") || NON_CRAWL_SCHEME_RE.test(href)) return;

    const target = resolveAbsolute(href, base);
    if (target === null) return; // unparseable href — nothing usable to record

    const targetNormalized = normalizeUrl(href, base);
    const type: "internal" | "external" =
      targetNormalized !== null && isInScope(targetNormalized, scope) ? "internal" : "external";

    const relAttr = $(el).attr("rel") ?? null;
    const relTokens = relAttr ? relAttr.toLowerCase().split(/\s+/) : [];

    out.push({
      source: finalUrl,
      target,
      targetNormalized,
      anchor: collapseWhitespace($(el).text()),
      type,
      rel: relAttr,
      nofollow: relTokens.includes("nofollow"),
      sponsored: relTokens.includes("sponsored"),
      ugc: relTokens.includes("ugc"),
      targetAttr: $(el).attr("target") ?? null,
    });
  });
  return out;
}

import type { CheerioAPI } from "cheerio";
import type { HreflangEntry } from "../models/types";
import { resolveAbsolute } from "./shared";

export function extractHreflang($: CheerioAPI, base: string): HreflangEntry[] {
  const out: HreflangEntry[] = [];
  $("link[rel]").each((_, el) => {
    const relTokens = ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/);
    if (!relTokens.includes("alternate")) return;

    const lang = $(el).attr("hreflang");
    if (!lang || !lang.trim()) return; // alternate without hreflang is a feed/stylesheet link, not a language annotation

    const hrefRaw = $(el).attr("href");
    if (!hrefRaw || !hrefRaw.trim()) return;
    const href = resolveAbsolute(hrefRaw.trim(), base);
    if (href === null) return;

    out.push({ lang: lang.trim(), href });
  });
  return out;
}

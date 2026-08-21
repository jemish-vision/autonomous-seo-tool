import type { CheerioAPI } from "cheerio";
import { collapseWhitespace } from "./shared";

export function extractHeadings($: CheerioAPI): { h1: string[]; h2: string[]; h3: string[] } {
  const collect = (sel: string) => $(sel).map((_, el) => collapseWhitespace($(el).text())).get();
  return { h1: collect("h1"), h2: collect("h2"), h3: collect("h3") };
}

import type { CheerioAPI } from "cheerio";
import type { PageStats } from "../models/types";

/**
 * contentText is the already noise-stripped visible text (content.ts's extractContent output) —
 * reused rather than recomputed so "content text" means the same thing everywhere in the record.
 * domNodes counts element nodes only (cheerio "*"), matching how DOM-inspector tools report node
 * counts; text/comment nodes aren't counted.
 */
export function extractPageStats(
  $: CheerioAPI,
  html: string,
  contentText: string,
  headers: Record<string, string>,
  httpVersion: string | null
): PageStats {
  const htmlBytes = Buffer.byteLength(html ?? "", "utf8");
  const textBytes = Buffer.byteLength(contentText ?? "", "utf8");
  const textRatio = htmlBytes === 0 ? 0 : Math.min(1, textBytes / htmlBytes);

  return {
    htmlBytes,
    textRatio,
    domNodes: $("*").length,
    contentEncoding: headers["content-encoding"] ?? null,
    httpVersion,
  };
}

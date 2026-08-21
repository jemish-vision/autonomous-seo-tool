/** Slice S3 implements. */
import robotsParser from "robots-parser";
import type { LlmsTxtInfo, RobotsInfo } from "../models/types";
import { buildAiCrawlerTable } from "./aiCrawlers";
import { fetchWithTimeout, resolveAbsolute } from "./http";
import { fetchLlmsTxt } from "./llmsTxt";

/**
 * Fetch + parse <origin>/robots.txt. Never throws: 404/unreachable → allow-all with
 * parseStatus "unavailable"/"error" recorded as evidence.
 *
 * Also fetches /llms.txt and builds the 13-agent AI-crawler access table here, even though
 * neither is robots.txt enforcement — this is the one place per crawl that already fetches site
 * files and whose result already flows straight into robots.json via store.saveRobots(), so
 * bundling them in is what gets the evidence stored without a second call site anywhere else.
 */
export async function fetchRobots(origin: string, userAgent: string): Promise<RobotsInfo> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const fetchedAt = new Date().toISOString();

  let res: Response;
  try {
    res = await fetchWithTimeout(robotsUrl, { headers: { "user-agent": userAgent } });
  } catch {
    return allowAll(robotsUrl, null, "error", fetchedAt, await fetchLlmsTxt(origin, userAgent));
  }

  if (res.status !== 200) {
    return allowAll(robotsUrl, res.status, "unavailable", fetchedAt, await fetchLlmsTxt(origin, userAgent));
  }

  const content = await res.text();
  const parser = robotsParser(robotsUrl, content);
  const sitemaps = parser
    .getSitemaps()
    .map((raw) => resolveAbsolute(raw, origin))
    .filter((s): s is string => s !== null);

  // Crawl-delay is non-standard but widely published; robots-parser resolves it per user agent.
  const rawDelay = parser.getCrawlDelay(userAgent);
  const crawlDelay = typeof rawDelay === "number" && Number.isFinite(rawDelay) && rawDelay > 0 ? rawDelay : null;

  // Independent of robots.txt's own outcome — a site can publish llms.txt with no robots.txt at all.
  const llmsTxt = await fetchLlmsTxt(origin, userAgent);

  return {
    url: robotsUrl,
    statusCode: res.status,
    content,
    sitemaps,
    crawlDelay,
    parseStatus: content.trim().length === 0 ? "empty" : "ok",
    fetchedAt,
    aiCrawlers: buildAiCrawlerTable(content),
    llmsTxt,
    isAllowed(target: string, ua: string = userAgent): boolean {
      // robots-parser returns undefined for URLs it can't match (e.g. host mismatch) — treat as
      // allowed rather than block on ambiguity; evidence collection over-blocks otherwise.
      return parser.isAllowed(target, ua) !== false;
    },
  };
}

function allowAll(
  url: string,
  statusCode: number | null,
  parseStatus: "unavailable" | "error",
  fetchedAt: string,
  llmsTxt: LlmsTxtInfo
): RobotsInfo {
  return {
    url,
    statusCode,
    content: null,
    sitemaps: [],
    crawlDelay: null,
    parseStatus,
    fetchedAt,
    aiCrawlers: buildAiCrawlerTable(null),
    llmsTxt,
    isAllowed: () => true,
  };
}

/**
 * Fold a Crawl-delay (seconds between requests) into a requested rps ceiling. Only ever slows the
 * crawl down — an explicit --rps can never be used to outrun the site's own stated limit.
 */
export function applyCrawlDelay(requestedRps: number, crawlDelay: number | null | undefined): number {
  if (typeof crawlDelay !== "number" || !Number.isFinite(crawlDelay) || crawlDelay <= 0) return requestedRps;
  return Math.min(requestedRps, 1 / crawlDelay);
}

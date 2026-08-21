/** HTTP status / response-time rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { captured, issueFor } from "./shared";

function http4xx(): PageRule {
  const meta: RuleMeta = {
    id: "http-error-4xx",
    category: "http",
    defaultSeverity: "error",
    description: "Page returned a 4xx client-error status.",
    howToFix: "Fix the broken URL, or redirect/remove links pointing at it.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.statusCode === null || page.statusCode < 400 || page.statusCode >= 500) return [];
      return [
        issueFor(meta, config, page, {
          message: `Page returned status ${page.statusCode}.`,
          evidence: [{ field: "statusCode", value: page.statusCode }],
        }),
      ];
    },
  };
}

function http5xx(): PageRule {
  const meta: RuleMeta = {
    id: "http-error-5xx",
    category: "http",
    defaultSeverity: "error",
    description: "Page returned a 5xx server-error status.",
    howToFix: "Investigate the server error; this URL is unreachable for crawlers and users alike.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.statusCode === null || page.statusCode < 500 || page.statusCode >= 600) return [];
      return [
        issueFor(meta, config, page, {
          message: `Page returned status ${page.statusCode}.`,
          evidence: [{ field: "statusCode", value: page.statusCode }],
        }),
      ];
    },
  };
}

function slowPage(): PageRule {
  const meta: RuleMeta = {
    id: "slow-page",
    category: "http",
    defaultSeverity: "warning", // heuristic (MF-5): threshold-based, never error
    description:
      "Page response time exceeds the configured slow-page threshold. Scored on HTTP-fetched pages only — " +
      "the Playwright pass records nav-start-to-post-settle wall time (networkidle wait + adaptive settle + " +
      "screenshot), which is not a response time and cannot be compared against this threshold.",
    howToFix: "Investigate server/TTFB latency for this URL.",
    dataRequirements: ["performance.responseTimeMs"],
  };
  return {
    meta,
    evaluate(page, config) {
      // See the description: browser wall time on rendered pages clears 2s even on localhost.
      if (page.renderedWith === "playwright") return null;
      const ms = page.performance.responseTimeMs;
      if (ms === null || ms <= config.thresholds.slowPageMs) return [];
      return [
        issueFor(meta, config, page, {
          message: `Response time was ${ms}ms.`,
          evidence: [{ field: "performance.responseTimeMs", value: ms }],
          threshold: `responseTimeMs ${ms} > max ${config.thresholds.slowPageMs}`,
        }),
      ];
    },
  };
}

function noCompression(): PageRule {
  const meta: RuleMeta = {
    id: "no-compression",
    category: "http",
    defaultSeverity: "notice",
    description: "Response has no Content-Encoding (gzip/brotli) and is large enough for compression to matter.",
    howToFix: "Enable gzip or brotli for text/html at the server or CDN — text compresses by roughly 70%.",
    dataRequirements: ["pageStats"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!captured(page.pageStats, "contentEncoding", "htmlBytes")) return null;
      if (page.pageStats.contentEncoding) return [];
      const minBytes = config.thresholds.noCompressionMinBytes ?? 2000;
      if (page.pageStats.htmlBytes <= minBytes) return [];
      return [
        issueFor(meta, config, page, {
          message: `${Math.round(page.pageStats.htmlBytes / 1024)} KB sent with no Content-Encoding.`,
          evidence: [
            { field: "pageStats.contentEncoding", value: null },
            { field: "pageStats.htmlBytes", value: page.pageStats.htmlBytes },
          ],
          threshold: `htmlBytes ${page.pageStats.htmlBytes} > min ${minBytes}, contentEncoding absent`,
        }),
      ];
    },
  };
}

export function httpRules(): PageRule[] {
  return [http4xx(), http5xx(), slowPage(), noCompression()];
}

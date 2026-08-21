import * as cheerio from "cheerio";
import type { CrawlScope, ExtractionResult, FetchArtifact } from "../models/types";
import {
  extractTitle,
  extractMetaDescription,
  extractCanonical,
  extractRobotsMeta,
  extractTitles,
  extractMetaDescriptions,
  extractMetaKeywords,
  extractMetaRefresh,
} from "./metadata";
import { extractHeadings } from "./headings";
import { extractLinks } from "./links";
import { extractImageInventory, summarizeImages } from "./images";
import { extractVideos } from "./media";
import { extractStructuredData, buildStructuredDataReport } from "./schema";
import { extractContent } from "./content";
import { extractSocialTags } from "./social";
import { extractContacts } from "./contacts";
import { extractHreflang } from "./hreflang";
import { estimateTitlePx, estimateMetaDescriptionPx } from "./pixel-width";
import { extractPageStats } from "./pageStats";
import { extractHeadBoundary, extractCharset, extractBaseHrefInfo } from "./head";
import { extractHeadMeta } from "./headMeta";
import { extractDocumentStructure } from "./structure";
import { extractFonts } from "./fonts";
import { extractFaviconCandidates, assessGoogleSerpEligibility, buildFaviconReport } from "./favicons";
import { extractResourceHints } from "./resourceHints";
import { resolveBase } from "./shared";

export {
  extractTitle,
  extractMetaDescription,
  extractCanonical,
  extractRobotsMeta,
  extractTitles,
  extractMetaDescriptions,
  extractMetaKeywords,
  extractMetaRefresh,
} from "./metadata";
export { extractHeadings } from "./headings";
export { extractLinks } from "./links";
export {
  extractImages,
  extractImageInventory,
  extractBackgroundImages,
  parseSrcset,
  summarizeImages,
  probeImageAsset,
  emptyAssetSize,
  dataUriBytes,
  collectComputedBackgroundsInPage,
  mergeComputedBackgroundImages,
  mergeNetworkObservedImages,
} from "./images";
export type { ImageFetcher, ImageProbeOptions, ImageProbeResponse, ImageInventory } from "./images";
export { extractVideos } from "./media";
export {
  extractStructuredData,
  extractMicrodata,
  extractRdfa,
  collectJsonLdItems,
  validateSchemaNode,
  buildStructuredDataReport,
} from "./schema";
export { extractContent } from "./content";
export { extractSocialTags } from "./social";
export { extractContacts } from "./contacts";
export { extractHreflang } from "./hreflang";
export { estimateTitlePx, estimateMetaDescriptionPx } from "./pixel-width";
export { extractPageStats } from "./pageStats";
export { extractHeadBoundary, extractCharset, extractBaseHrefInfo } from "./head";
export { extractHeadMeta } from "./headMeta";
export { extractDocumentStructure } from "./structure";
export { extractFonts, parseFontFaceCss } from "./fonts";
export {
  extractFaviconCandidates,
  probeFaviconCandidates,
  assessGoogleSerpEligibility,
  buildFaviconReport,
  decodeImageDimensions,
} from "./favicons";
export { extractResourceHints } from "./resourceHints";
export { computeReadability, computeKeywordDensity } from "./readability";

/** Runs `fn`, swallowing any error so one broken field can never take down the whole page record. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Pure extraction over fetched HTML. Never throws on malformed markup —
 * broken evidence (e.g. invalid JSON-LD) is preserved in the result, not raised.
 */
export function extractPage(artifact: FetchArtifact, scope: CrawlScope): ExtractionResult {
  const html = artifact.html ?? "";
  // Location info is needed for head-boundary/charset byte offsets; one annotated parse beats two.
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true } as Parameters<typeof cheerio.load>[1]);
  const base = safe(() => resolveBase($, artifact.finalUrl), artifact.finalUrl);
  const headers = artifact.headers ?? {};

  const title = safe(() => extractTitle($), null);
  const metaDescription = safe(() => extractMetaDescription($), null);
  const content = safe(() => extractContent($), { text: "", wordCount: 0, contentHash: "" });
  const structuredData = safe(() => extractStructuredData($), []);
  const imageInventory = safe(() => extractImageInventory($, base), {
    images: [],
    backgroundImages: [],
    summary: summarizeImages([], []),
  });

  return {
    title,
    metaDescription,
    canonical: safe(() => extractCanonical($, base), null),
    robots: safe(() => extractRobotsMeta($, headers), { meta: [], noindex: false, nofollow: false }),
    headings: safe(() => extractHeadings($), { h1: [], h2: [], h3: [] }),
    links: safe(() => extractLinks($, base, artifact.finalUrl, scope), []),
    images: imageInventory.images,
    backgroundImages: imageInventory.backgroundImages,
    imageSummary: imageInventory.summary,
    videos: safe(() => extractVideos($, base), []),
    structuredData,
    structuredDataReport: safe(() => buildStructuredDataReport($, base, structuredData), undefined),
    content,
    titles: safe(() => extractTitles($), []),
    metaDescriptions: safe(() => extractMetaDescriptions($), []),
    social: safe(() => extractSocialTags($), { og: {}, twitter: {} }),
    contacts: safe(() => extractContacts($), []),
    hreflang: safe(() => extractHreflang($, base), []),
    metaRefresh: safe(() => extractMetaRefresh($, base), null),
    metaKeywords: safe(() => extractMetaKeywords($), null),
    pixelWidths: {
      titlePx: safe(() => estimateTitlePx(title), null),
      metaDescriptionPx: safe(() => estimateMetaDescriptionPx(metaDescription), null),
    },
    headBoundary: safe(() => extractHeadBoundary($), { elementCount: 0, closedBy: null, closedAtOffset: null, stranded: [] }),
    charset: safe(() => extractCharset($, html, headers), { value: null, source: null, metaOffset: null, effective: false }),
    baseHref: safe(() => extractBaseHrefInfo($), { href: null, count: 0 }),
    headMeta: safe(() => extractHeadMeta($), undefined),
    structure: safe(() => extractDocumentStructure($), undefined),
    fonts: safe(() => extractFonts($, artifact.finalUrl), undefined),
    // Pure path only: probing costs network, so `effective` stays unresolved until a caller probes.
    favicons: safe(() => {
      const candidates = extractFaviconCandidates($, base, null);
      return buildFaviconReport(candidates, null, assessGoogleSerpEligibility(candidates, { pageUrl: artifact.finalUrl }));
    }, undefined),
    pageStats: safe(
      () => extractPageStats($, html, content.text, headers, artifact.httpVersion ?? null),
      {
        htmlBytes: Buffer.byteLength(html, "utf8"),
        textRatio: 0,
        domNodes: 0,
        contentEncoding: headers["content-encoding"] ?? null,
        httpVersion: artifact.httpVersion ?? null,
      }
    ),
    resourceHints: safe(
      () => extractResourceHints($, base),
      { scripts: [], stylesheets: [], preloads: [], inlineScriptBytesTotal: 0, renderBlockingScriptCount: 0, renderBlockingStylesheetCount: 0 }
    ),
  };
}

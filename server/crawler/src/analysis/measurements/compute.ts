/**
 * Computes the 31-figure "All Measurements" grid over one stored run directory. Reads raw
 * evidence directly (pages/*.json, report.json, failures.json, external-links.json) rather than
 * depending on issues.json, so this works right after a crawl with no separate analyze step, and
 * never silently disagrees with an un-analyzed run.
 *
 * Honesty contract (brief): a measurement we cannot compute from what's stored comes back
 * `available: false` with a reason — never a fabricated 0. See individual builders below for the
 * two documented traps: TTFB/response must read the transport-timing field, never browser
 * wall-clock (performance.browserWallMs / performance.navigation.ttfbMs are never read here);
 * orphan-pages states its "only within what was crawled" bound in the explainer.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { CrawledPage, CrawlSummary, ExternalCheckResult, FailureRecord } from "../../models/types";
import { loadConfig } from "../config";
import { findNearDuplicates } from "../similarity";
import { average, formatBytes, formatCount, formatMs, formatNodes, formatScore, formatWords, round1 } from "./format";
import { fleschReadingEase } from "./textStats";
import type { Measurement, MeasurementLinkTarget, MeasurementUnit, MeasurementsResult } from "./types";

/* ---------- thresholds not owned by analysis.config.json (no rule reads them yet) ---------- */

/** Matches Jemish's depth bar (audit datarules.md §4, "Page buried too deep") — the closest
 * documented comparator, since our rulebook has no deep-page rule (yet) to inherit a value from. */
const DEEP_PAGE_DEPTH = 3;
/** Matches Jemish's/Kishan's oversized-image bar (datarules.md §5 backlog item). */
const HEAVY_IMAGE_BYTES = 200 * 1024;
/** Falls back only if analysis.config.json fails to load — keeps this module usable standalone. */
const FALLBACK_TITLE_MAX_PX = 561;
const FALLBACK_THIN_CONTENT_WORDS = 80;

/* ---------- raw evidence readers ---------- */

function isEnoent(err: unknown): boolean {
  return err !== null && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

async function readPages(runDir: string): Promise<CrawledPage[]> {
  const dir = path.join(runDir, "pages");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const pages: CrawledPage[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    pages.push(JSON.parse(await readFile(path.join(dir, file), "utf-8")) as CrawledPage);
  }
  return pages;
}

function primaryUrl(page: CrawledPage): string {
  return page.normalizedUrl ?? page.url;
}

function pathnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const p = new URL(url).pathname;
    return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  } catch {
    return null;
  }
}

const isBlank = (s: string | null | undefined): boolean => s === null || s === undefined || s.trim() === "";

/* ---------- measurement builder ---------- */

interface Ctx {
  pages: CrawledPage[];
  summary: CrawlSummary | null;
  failures: FailureRecord[];
  /** null = --check-external was not run this crawl (file never written) — distinct from "[]". */
  externalLinks: ExternalCheckResult[] | null;
  totalPages: number;
  titleMaxPx: number;
  thinContentWords: number;
  runId: string;
}

type Base = { id: string; label: string; category: string; unit: MeasurementUnit; explainer: string };
type Outcome =
  | { available: true; value: number; display: string; linkTarget?: MeasurementLinkTarget | null; sampleSize?: number | null }
  | { available: false; reason: string };

function mk(ctx: Ctx, base: Base, outcome: Outcome): Measurement {
  if (!outcome.available) {
    return { ...base, value: null, display: null, available: false, unavailableReason: outcome.reason, linkTarget: null, sampleSize: null, totalPages: ctx.totalPages };
  }
  return {
    ...base,
    value: outcome.value,
    display: outcome.display,
    available: true,
    unavailableReason: null,
    linkTarget: outcome.linkTarget ?? null,
    sampleSize: outcome.sampleSize ?? null,
    totalPages: ctx.totalPages,
  };
}

/* ---------- coverage ---------- */

function pagesCrawled(ctx: Ctx): Measurement {
  return mk(ctx, {
    id: "pages-crawled",
    label: "Pages Crawled",
    category: "Coverage",
    unit: "pages",
    explainer: "How many pages the crawler successfully fetched and extracted this run — the denominator every other figure here is measured against.",
  }, {
    available: true,
    value: ctx.pages.length,
    display: formatCount(ctx.pages.length, "page"),
    linkTarget: { field: "*", op: "non-empty", note: "every stored page in this run" },
  });
}

function pagesDiscovered(ctx: Ctx): Measurement {
  const explainer = "How many distinct URLs the crawler found via links, robots.txt and sitemaps — including ones it never fetched (out of scope, over the page cap, or blocked).";
  if (ctx.summary === null) return mk(ctx, { id: "pages-discovered", label: "Pages Discovered", category: "Coverage", unit: "pages", explainer }, { available: false, reason: "report.json is missing for this run — discovery count was never persisted." });
  return mk(ctx, { id: "pages-discovered", label: "Pages Discovered", category: "Coverage", unit: "pages", explainer }, {
    available: true,
    value: ctx.summary.discovered,
    display: formatCount(ctx.summary.discovered, "page"),
  });
}

/** Union of (a) stored pages whose own statusCode is 4xx/5xx and (b) failures.json 4xx/5xx
 * entries — the crawler writes BOTH for most error responses (crawl.ts saves the page record
 * even on a non-2xx status, then separately logs the failure), so a naive sum double-counts. */
function brokenPages(ctx: Ctx): Measurement {
  const set = new Set<string>();
  for (const p of ctx.pages) if (p.statusCode !== null && p.statusCode >= 400) set.add(primaryUrl(p));
  for (const f of ctx.failures) if (f.reason === "http-4xx" || f.reason === "http-5xx") set.add(f.normalizedUrl ?? f.url);
  return mk(ctx, {
    id: "broken-pages",
    label: "Broken Pages",
    category: "Coverage",
    unit: "pages",
    explainer: "Pages that returned a 4xx or 5xx status — dead links and server errors a visitor or Googlebot would hit.",
  }, {
    available: true,
    value: set.size,
    display: formatCount(set.size, "page"),
    linkTarget: { field: "statusCode", op: "gt", value: 399 },
  });
}

function redirects(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => p.redirectChain.length > 0).length;
  return mk(ctx, {
    id: "redirects",
    label: "Redirects",
    category: "Coverage",
    unit: "pages",
    explainer: "Pages that only resolved after one or more redirect hops — each hop costs crawl budget and a little link equity.",
  }, {
    available: true,
    value: count,
    display: formatCount(count, "page"),
    linkTarget: { field: "redirectChain", op: "non-empty" },
  });
}

/* ---------- on-page ---------- */

function missingTitle(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => isBlank(p.title)).length;
  return mk(ctx, { id: "missing-title", label: "Missing Title", category: "On-Page", unit: "pages", explainer: "Pages with no <title> tag (or an empty one) — the text search engines usually show as the clickable headline." }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "title", op: "blank" },
  });
}

function missingMetaDescription(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => isBlank(p.metaDescription)).length;
  return mk(ctx, { id: "missing-meta-description", label: "Missing Meta Description", category: "On-Page", unit: "pages", explainer: "Pages with no meta description — search engines fall back to auto-generating a snippet, which you don't control." }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "metaDescription", op: "blank" },
  });
}

function missingH1(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => p.headings.h1.length === 0).length;
  return mk(ctx, { id: "missing-h1", label: "Missing H1", category: "On-Page", unit: "pages", explainer: "Pages with no H1 heading — the main on-page signal for what the page is about, separate from the title tag." }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "headings.h1", op: "empty" },
  });
}

function multipleH1(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => p.headings.h1.length > 1).length;
  return mk(ctx, { id: "multiple-h1", label: "Multiple H1", category: "On-Page", unit: "pages", explainer: "Pages with more than one H1 — usually a template or CMS issue that dilutes which heading is the real one." }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "headings.h1", op: "count-gt", value: 1 },
  });
}

function titleTooWide(ctx: Ctx): Measurement {
  const withPx = ctx.pages.filter((p) => p.pixelWidths?.titlePx != null);
  const base = { id: "title-too-wide", label: "Title Too Wide", category: "On-Page", unit: "pages" as MeasurementUnit, explainer: `Titles estimated wider than ${ctx.titleMaxPx}px in a desktop Google SERP — Google truncates past this, usually mid-word.` };
  if (withPx.length === 0) return mk(ctx, base, { available: false, reason: "No page in this run has an estimated title pixel width (pixelWidths is a v2+ field — this run predates it, or extraction never ran)." });
  const count = withPx.filter((p) => p.pixelWidths!.titlePx! > ctx.titleMaxPx).length;
  return mk(ctx, base, {
    available: true, value: count, display: formatCount(count, "page"),
    linkTarget: { field: "pixelWidths.titlePx", op: "gt", value: ctx.titleMaxPx },
    sampleSize: withPx.length,
  });
}

/* ---------- content ---------- */

function thinContent(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => p.content.wordCount < ctx.thinContentWords).length;
  return mk(ctx, { id: "thin-content", label: "Thin Content", category: "Content", unit: "pages", explainer: `Pages with fewer than ${ctx.thinContentWords} words of extracted text — often too little for a search engine to judge what the page is about.` }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "content.wordCount", op: "lt", value: ctx.thinContentWords },
  });
}

/** Union of exact-duplicate (same contentHash) and near-duplicate (MinHash/LSH, same engine the
 * rulebook uses — src/analysis/similarity.ts) page sets. A page counts once even if it's in both. */
function duplicateContent(ctx: Ctx): Measurement {
  const dupUrls = new Set<string>();
  const byHash = new Map<string, CrawledPage[]>();
  for (const p of ctx.pages) {
    if (p.content.wordCount === 0) continue;
    const list = byHash.get(p.content.contentHash);
    if (list) list.push(p);
    else byHash.set(p.content.contentHash, [p]);
  }
  for (const members of byHash.values()) if (members.length > 1) for (const m of members) dupUrls.add(primaryUrl(m));

  let nearDupUnavailable: string | null = null;
  try {
    const report = findNearDuplicates(ctx.pages, ctx.runId);
    for (const cluster of report.clusters) for (const member of cluster.members) dupUrls.add(member.url);
  } catch (err) {
    // Near-dup detection failing must not hide the exact-duplicate count we already have.
    nearDupUnavailable = err instanceof Error ? err.message : String(err);
  }

  return mk(ctx, {
    id: "duplicate-content",
    label: "Duplicate Content",
    category: "Content",
    unit: "pages",
    explainer: nearDupUnavailable
      ? "Pages that are byte-identical to another crawled page (near-duplicate detection failed this run, so this count is exact-duplicates only — see server logs)."
      : "Pages that are byte-identical OR near-identical (MinHash/LSH estimated similarity) to another crawled page — split, thin content spread across near-copies competing with itself in search.",
  }, {
    available: true,
    value: dupUrls.size,
    display: formatCount(dupUrls.size, "page"),
    linkTarget: { field: "__computed__.duplicateCluster", op: "custom", note: "same content.contentHash as another page, or a near-duplicate cluster member per src/analysis/similarity.ts" },
  });
}

function averageWordCount(ctx: Ctx): Measurement {
  const avg = average(ctx.pages.map((p) => p.content.wordCount));
  const base = { id: "average-word-count", label: "Average Word Count", category: "Content", unit: "words" as MeasurementUnit, explainer: "Mean extracted word count across every crawled page — a rough gauge of how much substantive copy the site carries." };
  if (avg === null) return mk(ctx, base, { available: false, reason: "No pages in this run." });
  return mk(ctx, base, { available: true, value: round1(avg), display: formatWords(avg) });
}

function readingEase(ctx: Ctx): Measurement {
  const scores: number[] = [];
  for (const p of ctx.pages) {
    if (p.content.wordCount === 0) continue;
    const result = fleschReadingEase(p.content.text);
    if (result) scores.push(result.score);
  }
  const base = { id: "reading-ease", label: "Reading Ease", category: "Content", unit: "score" as MeasurementUnit, explainer: "Mean Flesch Reading Ease (0 hard → 100 easy), computed here with a heuristic syllable counter over each page's extracted text — a directional read, not a precise linguistic score." };
  if (scores.length === 0) return mk(ctx, base, { available: false, reason: "No page in this run has extractable body text (all pages have wordCount 0)." });
  const avg = average(scores)!;
  return mk(ctx, base, { available: true, value: round1(avg), display: formatScore(avg), sampleSize: scores.length });
}

/* ---------- indexability ---------- */

function noindex(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => p.robots.noindex).length;
  return mk(ctx, { id: "noindex", label: "Noindex", category: "Indexability", unit: "pages", explainer: "Pages marked noindex via meta robots or the X-Robots-Tag header — deliberately excluded from search results." }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "robots.noindex", op: "eq", value: true },
  });
}

/** Bounded per the brief: only true within what THIS crawl reached — a page could have real
 * inlinks from pages outside the crawl's scope or page cap. Stated in the explainer, not hidden. */
function orphanPages(ctx: Ctx): Measurement {
  const explainer = "Crawled pages with zero internal links from any other page THIS crawl reached. Bounded, not absolute: a page outside the crawl's scope or page cap could still link to it.";
  if (ctx.summary === null) return mk(ctx, { id: "orphan-pages", label: "Orphan Pages", category: "Coverage", unit: "pages", explainer }, { available: false, reason: "report.json is missing for this run — orphan detection runs once at crawl-end and was never persisted." });
  const count = ctx.summary.orphanCandidates.length;
  return mk(ctx, { id: "orphan-pages", label: "Orphan Pages", category: "Coverage", unit: "pages", explainer }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "__computed__.orphan", op: "custom", note: "url is a member of report.orphanCandidates" },
  });
}

function deepPages(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => p.crawl.depth > DEEP_PAGE_DEPTH).length;
  return mk(ctx, { id: "deep-pages", label: "Deep Pages", category: "Coverage", unit: "pages", explainer: `Pages more than ${DEEP_PAGE_DEPTH} link-hops from the start URL — the deeper a page sits, the less crawl budget and internal link equity it tends to get.` }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "crawl.depth", op: "gt", value: DEEP_PAGE_DEPTH },
  });
}

function needsJavaScript(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => p.renderedWith === "playwright").length;
  return mk(ctx, { id: "needs-javascript", label: "Needs JavaScript", category: "Coverage", unit: "pages", explainer: "Pages the crawler had to render in a real browser because the static HTML looked insufficient (JS-detection heuristic) — a proxy for what a non-JS crawler would see as empty or broken." }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "renderedWith", op: "eq", value: "playwright" },
  });
}

/* ---------- social & schema ---------- */

function missingOpenGraph(ctx: Ctx): Measurement {
  const withSocial = ctx.pages.filter((p) => p.social !== undefined);
  const base = { id: "missing-open-graph", label: "Missing Open Graph", category: "Social & Schema", unit: "pages" as MeasurementUnit, explainer: "Pages with no og:* tags at all — social platforms fall back to guessing a title/image/description for link previews." };
  if (withSocial.length === 0) return mk(ctx, base, { available: false, reason: "No page in this run has captured social tags (social is a v2+ field — this run predates it)." });
  const count = withSocial.filter((p) => Object.keys(p.social!.og).length === 0).length;
  return mk(ctx, base, { available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "social.og", op: "empty" }, sampleSize: withSocial.length });
}

function incompleteSchema(ctx: Ctx): Measurement {
  const withReport = ctx.pages.filter((p) => p.structuredDataReport !== undefined);
  const base = { id: "incomplete-schema", label: "Incomplete Schema", category: "Social & Schema", unit: "pages" as MeasurementUnit, explainer: "Pages with structured data that's missing a property Google requires for the rich result it's trying for — present but not eligible." };
  if (withReport.length === 0) return mk(ctx, base, { available: false, reason: "No page in this run has structured-data validation (structuredDataReport is a v3+ field — this run predates it)." });
  const count = withReport.filter((p) => p.structuredDataReport!.counts.itemsMissingRequired > 0).length;
  return mk(ctx, base, { available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "structuredDataReport.counts.itemsMissingRequired", op: "gt", value: 0 }, sampleSize: withReport.length });
}

/* ---------- links ---------- */

/** Mirrors the broken-internal-link rule's cross-reference (rules/site/links.ts) but computed
 * independently here — see module header for why this layer doesn't import the rules engine. */
function brokenInternalLinks(ctx: Ctx): Measurement {
  const failedPaths = new Set<string>();
  const failedStatus = new Map<string, number | null>();
  for (const f of ctx.failures) {
    if (f.reason !== "http-4xx" && f.reason !== "http-5xx") continue;
    const p = pathnameOf(f.normalizedUrl ?? f.url);
    if (!p) continue;
    failedPaths.add(p);
    if (!failedStatus.has(p)) failedStatus.set(p, f.statusCode);
  }
  const pageByPath = new Map<string, CrawledPage>();
  for (const page of ctx.pages) {
    for (const u of [pathnameOf(primaryUrl(page)), pathnameOf(page.finalUrl)]) {
      if (u && !pageByPath.has(u)) pageByPath.set(u, page);
    }
  }

  let occurrences = 0;
  const affectedSourcePages = new Set<string>();
  for (const page of ctx.pages) {
    for (const link of page.links) {
      if (link.type !== "internal") continue;
      const targetPath = pathnameOf(link.targetNormalized ?? link.target);
      if (!targetPath) continue;
      const targetPage = pageByPath.get(targetPath);
      const isBroken = failedPaths.has(targetPath) || (targetPage?.statusCode != null && targetPage.statusCode >= 400);
      if (!isBroken) continue;
      const status = targetPage?.statusCode ?? failedStatus.get(targetPath) ?? null;
      if (status === 401 || status === 403) continue; // auth wall, not broken
      occurrences++;
      affectedSourcePages.add(primaryUrl(page));
    }
  }
  return mk(ctx, {
    id: "broken-internal-links",
    label: "Broken Internal Links",
    category: "Links",
    unit: "links",
    explainer: "Internal links pointing at a page that 4xx/5xx'd or failed to crawl — 401/403 targets are excluded (a protected area, not a dead link).",
  }, {
    available: true,
    value: occurrences,
    display: formatCount(occurrences, "link"),
    linkTarget: { field: "__computed__.brokenInternalLinkSource", op: "custom", note: "page has >=1 internal link whose target is 4xx/5xx or a recorded crawl failure, excluding 401/403" },
    sampleSize: affectedSourcePages.size,
  });
}

function outboundLinkChecks(externalLinks: ExternalCheckResult[]): { broken: ExternalCheckResult[]; refused: ExternalCheckResult[] } {
  const broken: ExternalCheckResult[] = [];
  const refused: ExternalCheckResult[] = [];
  for (const c of externalLinks) {
    if (c.statusCode === 401 || c.statusCode === 403) refused.push(c);
    else if ((c.statusCode !== null && c.statusCode >= 400) || (c.statusCode === null && c.error !== null)) broken.push(c);
  }
  return { broken, refused };
}

function brokenOutboundLinks(ctx: Ctx): Measurement {
  const base = { id: "broken-outbound-links", label: "Broken Outbound Links", category: "Links", unit: "links" as MeasurementUnit, explainer: "External link targets that returned an error (or couldn't be reached at all) when checked. A count of 0 means every checked target was healthy — check sampleSize/total before trusting it, since external checking is capped and optional." };
  if (ctx.externalLinks === null) return mk(ctx, base, { available: false, reason: "External link checking was not run this crawl (requires the --check-external flag, off by default)." });
  const { broken } = outboundLinkChecks(ctx.externalLinks);
  return mk(ctx, base, { available: true, value: broken.length, display: formatCount(broken.length, "link"), linkTarget: { field: "__computed__.brokenOutbound", op: "custom", note: "external-links.json entry with statusCode >=400 (excl. 401/403) or a fetch error" }, sampleSize: ctx.externalLinks.length });
}

function outboundLinksRefused(ctx: Ctx): Measurement {
  const base = { id: "outbound-links-refused", label: "Outbound Links Refused", category: "Links", unit: "links" as MeasurementUnit, explainer: "External link targets that returned 401/403 when checked — access was refused. This is a raw status count, not a bot-block classification: we don't distinguish a genuine auth wall from anti-bot blocking." };
  if (ctx.externalLinks === null) return mk(ctx, base, { available: false, reason: "External link checking was not run this crawl (requires the --check-external flag, off by default)." });
  const { refused } = outboundLinkChecks(ctx.externalLinks);
  return mk(ctx, base, { available: true, value: refused.length, display: formatCount(refused.length, "link"), linkTarget: { field: "external-links[].statusCode", op: "in", value: [401, 403] }, sampleSize: ctx.externalLinks.length });
}

/* ---------- media ---------- */

function imagesWithoutAlt(ctx: Ctx): Measurement {
  let count = 0;
  for (const p of ctx.pages) for (const img of p.images) if (img.alt === null) count++;
  return mk(ctx, { id: "images-without-alt", label: "Images Without Alt", category: "Media", unit: "images", explainer: "Images with no alt attribute at all (distinct from an intentional alt=\"\") — missed opportunities for both accessibility and image search." }, {
    available: true, value: count, display: formatCount(count, "image"), linkTarget: { field: "images[].alt", op: "is-null" },
  });
}

function heavyImages(ctx: Ctx): Measurement {
  let withBytes = 0;
  let heavy = 0;
  for (const p of ctx.pages) {
    for (const img of p.images) {
      if (img.asset?.bytes == null) continue;
      withBytes++;
      if (img.asset.bytes > HEAVY_IMAGE_BYTES) heavy++;
    }
  }
  const base = { id: "heavy-images", label: "Heavy Images", category: "Media", unit: "images" as MeasurementUnit, explainer: `Images over ${formatBytes(HEAVY_IMAGE_BYTES)} — the biggest lever on page weight and load time on most sites.` };
  if (withBytes === 0) return mk(ctx, base, { available: false, reason: "No image in this run has a measured byte size (requires the image-size prober, on by default since the v4 wave — this run predates it or the prober found nothing to measure)." });
  return mk(ctx, base, { available: true, value: heavy, display: formatCount(heavy, "image"), linkTarget: { field: "images[].asset.bytes", op: "gt", value: HEAVY_IMAGE_BYTES }, sampleSize: withBytes });
}

/* ---------- security ---------- */

/** Re-implements transportRules().mixedContent's subresource sweep locally rather than importing
 * rules/ (out of scope for this slice) — same fields, same http:// check. */
function pageHasHttpSubresource(page: CrawledPage): boolean {
  const isHttp = (u: string | null | undefined) => typeof u === "string" && u.toLowerCase().startsWith("http://");
  if (page.images.some((img) => isHttp(img.url))) return true;
  if (Array.isArray(page.videos) && page.videos.some((v) => isHttp(v.url) || isHttp(v.poster))) return true;
  if (Array.isArray(page.fonts?.faces) && page.fonts.faces.some((f) => isHttp(f.source))) return true;
  if (Array.isArray(page.favicons?.candidates) && page.favicons.candidates.some((c) => c.source !== "implicit" && isHttp(c.href))) return true;
  return false;
}

function mixedContent(ctx: Ctx): Measurement {
  const count = ctx.pages.filter((p) => {
    const target = p.finalUrl ?? p.url;
    return target.toLowerCase().startsWith("https://") && pageHasHttpSubresource(p);
  }).length;
  return mk(ctx, { id: "mixed-content", label: "Mixed Content", category: "Security", unit: "pages", explainer: "HTTPS pages that reference at least one subresource (image/video/font/favicon) over plain http — browsers upgrade or block it, so the asset can silently fail to load." }, {
    available: true, value: count, display: formatCount(count, "page"), linkTarget: { field: "__computed__.mixedContent", op: "custom", note: "page is https AND references >=1 http:// image/video/font/favicon URL" },
  });
}

function certificate(ctx: Ctx): Measurement {
  return mk(ctx, {
    id: "certificate",
    label: "Certificate",
    category: "Security",
    unit: "status",
    explainer: "TLS certificate validity and expiry for the crawled host.",
  }, {
    available: false,
    reason: "The crawler never inspects the TLS certificate chain — this needs a new extraction field (a raw TLS handshake check), not just a rule over existing data. Never report this as \"valid\" without actually checking.",
  });
}

/* ---------- performance ---------- */

function renderBlocking(ctx: Ctx): Measurement {
  return mk(ctx, {
    id: "render-blocking",
    label: "Render-Blocking Resources",
    category: "Performance",
    unit: "count",
    explainer: "Scripts/stylesheets that block first paint because they load synchronously in <head>.",
  }, {
    available: false,
    reason: "The crawler counts resources by type (performance.resources.byType) but does not record per-resource defer/async/media attributes, so a synchronous vs. non-blocking script can't be told apart yet — needs a script/stylesheet inventory extraction field.",
  });
}

/** Reads performance.http.ttfbMs — the transport-timing field, populated on both the static (got)
 * and Playwright passes via real request timing. NEVER performance.navigation.ttfbMs (browser
 * wall-clock nav-timing API) or performance.browserWallMs — conflating those with real TTFB is
 * exactly the trap called out in this slice's brief (1,051 false "slow page" findings elsewhere). */
function averageTtfb(ctx: Ctx): Measurement {
  const values = ctx.pages.map((p) => p.performance.http?.ttfbMs).filter((v): v is number => typeof v === "number");
  const base = { id: "average-ttfb", label: "Average TTFB", category: "Performance", unit: "ms" as MeasurementUnit, explainer: "Mean time-to-first-byte across crawled pages, measured at the transport layer (not browser wall-clock) — how long the server took to start responding, before any download or rendering." };
  if (values.length === 0) return mk(ctx, base, { available: false, reason: "No page in this run has transport-level HTTP timing (performance.http is a v4 field — this run predates it)." });
  const avg = average(values)!;
  return mk(ctx, base, { available: true, value: round1(avg), display: formatMs(avg), sampleSize: values.length });
}

/** Reads performance.responseTimeMs — "HTTP-transport total for the document. Never browser
 * wall-clock" per its own doc comment in models/types.ts. Distinct from TTFB: this is the full
 * request-to-last-byte time, not just time-to-first-byte. */
function averageResponse(ctx: Ctx): Measurement {
  const values = ctx.pages.map((p) => p.performance.responseTimeMs).filter((v): v is number => typeof v === "number");
  const base = { id: "average-response", label: "Average Response Time", category: "Performance", unit: "ms" as MeasurementUnit, explainer: "Mean total HTTP transport time (request start to last response byte) across crawled pages — never browser wall-clock, so it's comparable across static and JS-rendered pages." };
  if (values.length === 0) return mk(ctx, base, { available: false, reason: "No page in this run has a recorded response time." });
  const avg = average(values)!;
  return mk(ctx, base, { available: true, value: round1(avg), display: formatMs(avg), sampleSize: values.length });
}

function averageDomNodes(ctx: Ctx): Measurement {
  const values = ctx.pages.map((p) => p.pageStats?.domNodes).filter((v): v is number => typeof v === "number");
  const base = { id: "average-dom-nodes", label: "Average DOM Nodes", category: "Performance", unit: "nodes" as MeasurementUnit, explainer: "Mean DOM element count across crawled pages — very high counts correlate with slow style/layout work in the browser." };
  if (values.length === 0) return mk(ctx, base, { available: false, reason: "No page in this run has a DOM node count (pageStats is a v2+ field — this run predates it)." });
  const avg = average(values)!;
  return mk(ctx, base, { available: true, value: round1(avg), display: formatNodes(avg), sampleSize: values.length });
}

/** Prefers browser-observed full transfer bytes (performance.resources.totalTransferBytes, only
 * populated on a rendered pass) over the HTML-only proxy (pageStats.htmlBytes) so the two bases
 * are never averaged together — see module header on the TTFB/wall-clock conflation trap this
 * mirrors: mixing bases here would misreport page weight the same way. */
function averagePageWeight(ctx: Ctx): Measurement {
  const withResources = ctx.pages.filter((p) => typeof p.performance.resources?.totalTransferBytes === "number");
  const base = { id: "average-page-weight", label: "Average Page Weight", category: "Performance", unit: "bytes" as MeasurementUnit, explainer: "" };
  if (withResources.length > 0) {
    const avg = average(withResources.map((p) => p.performance.resources!.totalTransferBytes!))!;
    return mk(
      ctx,
      { ...base, explainer: "Mean full page weight (all subresources, browser-observed transfer bytes) across pages that got a rendered pass — heavier pages take longer to load and cost more on mobile data." },
      { available: true, value: round1(avg), display: formatBytes(avg), sampleSize: withResources.length },
    );
  }
  const withHtmlBytes = ctx.pages.filter((p) => typeof p.pageStats?.htmlBytes === "number");
  if (withHtmlBytes.length === 0) return mk(ctx, { ...base, explainer: "Mean page weight across crawled pages." }, { available: false, reason: "No page in this run has either browser-observed transfer bytes or an HTML byte count (pageStats is a v2+ field — this run predates it, or no page was ever rendered)." });
  const avg = average(withHtmlBytes.map((p) => p.pageStats!.htmlBytes))!;
  return mk(
    ctx,
    { ...base, explainer: "Mean HTML document weight only (no page in this run got a browser resource capture, so CSS/JS/image bytes aren't counted) — a floor on real page weight, not the full figure." },
    { available: true, value: round1(avg), display: formatBytes(avg), sampleSize: withHtmlBytes.length },
  );
}

/* ---------- entry point ---------- */

export async function computeMeasurements(runDir: string): Promise<MeasurementsResult> {
  const pages = await readPages(runDir);
  const summary = await readJsonIfExists<CrawlSummary>(path.join(runDir, "report.json"));
  const failures = (await readJsonIfExists<FailureRecord[]>(path.join(runDir, "failures.json"))) ?? [];
  const externalLinks = await readJsonIfExists<ExternalCheckResult[]>(path.join(runDir, "external-links.json"));

  let titleMaxPx = FALLBACK_TITLE_MAX_PX;
  let thinContentWords = FALLBACK_THIN_CONTENT_WORDS;
  try {
    const config = await loadConfig();
    titleMaxPx = config.thresholds.titleMaxPx;
    thinContentWords = config.thresholds.thinContentWords;
  } catch {
    // analysis.config.json failed to load — fall back rather than let the whole grid error out.
  }

  const ctx: Ctx = {
    pages,
    summary,
    failures,
    externalLinks,
    totalPages: pages.length,
    titleMaxPx,
    thinContentWords,
    runId: path.basename(runDir),
  };

  const measurements: Measurement[] = [
    pagesCrawled(ctx),
    pagesDiscovered(ctx),
    brokenPages(ctx),
    redirects(ctx),
    missingTitle(ctx),
    missingMetaDescription(ctx),
    missingH1(ctx),
    duplicateContent(ctx),
    thinContent(ctx),
    noindex(ctx),
    imagesWithoutAlt(ctx),
    brokenInternalLinks(ctx),
    orphanPages(ctx),
    deepPages(ctx),
    needsJavaScript(ctx),
    multipleH1(ctx),
    titleTooWide(ctx),
    missingOpenGraph(ctx),
    incompleteSchema(ctx),
    brokenOutboundLinks(ctx),
    outboundLinksRefused(ctx),
    mixedContent(ctx),
    certificate(ctx),
    heavyImages(ctx),
    renderBlocking(ctx),
    averageWordCount(ctx),
    readingEase(ctx),
    averageTtfb(ctx),
    averageDomNodes(ctx),
    averagePageWeight(ctx),
    averageResponse(ctx),
  ];

  return {
    runId: ctx.runId,
    generatedAt: new Date().toISOString(),
    pagesInRun: pages.length,
    measurements,
  };
}

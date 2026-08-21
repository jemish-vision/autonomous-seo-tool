/**
 * Client+server-safe adapter for GET /api/crawls/:id/measurements.
 *
 * The route currently still returns lib/data-measurements.ts's pre-computeMeasurements shape
 * (overview/histograms/percentiles) — the real 31-card grid
 * (../seo-crawler-poc/src/analysis/measurements/compute.ts, `MeasurementsResult`) exists and is
 * complete but isn't wired into the route yet (owned by the API-expansion slice, out of scope
 * here). This adapter renders the rich v2 shape the instant the route starts returning it
 * (`Array.isArray(json.measurements)`), and meanwhile renders every real number the endpoint
 * already returns today under an honest "legacy" banner — never a fabricated card, never a
 * silently-dropped field. See MeasurementsGrid for the banner.
 */

export type MeasurementUnit = "pages" | "images" | "links" | "ms" | "bytes" | "words" | "score" | "nodes" | "count" | "status" | "percent";

export interface MeasurementCardVM {
  id: string;
  label: string;
  category: string;
  unit: MeasurementUnit;
  value: number | null;
  display: string | null;
  explainer: string;
  available: boolean;
  unavailableReason: string | null;
  sampleSize: number | null;
  totalPages: number | null;
}

export interface MeasurementsViewModel {
  runId: string;
  generatedAt: string;
  pagesInRun: number;
  cards: MeasurementCardVM[];
  shape: "v2" | "legacy";
}

const CATEGORY_ORDER = ["Coverage", "On-Page", "Content", "Indexability", "Links", "Media", "Social & Schema", "Security", "Performance"];

export function categorySort(a: string, b: string): number {
  const ia = CATEGORY_ORDER.indexOf(a);
  const ib = CATEGORY_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

function fmtPages(n: number): string {
  return `${n.toLocaleString()} page${n === 1 ? "" : "s"}`;
}
function fmtMs(n: number): string {
  return `${Math.round(n).toLocaleString()} ms`;
}

/** Narrow, unknown-in / typed-out — avoids `any` leaking past this one adapter boundary. */
function isV2Shape(json: Record<string, unknown>): boolean {
  return Array.isArray(json.measurements);
}

function histogramCard(id: string, label: string, category: string, h: unknown, explainer: string): MeasurementCardVM {
  const buckets = (h as { buckets?: { key: string; count: number }[]; available?: boolean } | null)?.buckets;
  if (!buckets) return { id, label, category, unit: "count", value: null, display: null, explainer, available: false, unavailableReason: "Not present in this run's measurements response.", sampleSize: null, totalPages: null };
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const display = buckets.length > 0 ? buckets.map((b) => `${b.key}: ${b.count}`).join(" · ") : "none";
  return { id, label, category, unit: "count", value: total, display, explainer, available: true, unavailableReason: null, sampleSize: null, totalPages: null };
}

function num(o: Record<string, unknown> | undefined, key: string): number | null {
  const v = o?.[key];
  return typeof v === "number" ? v : null;
}

/** Every card here is a straight pass-through of a field the endpoint already returned — no new
 *  arithmetic, per the "don't recompute" mandate. Cards mirroring an existing `available:false`
 *  field (pageWeight, bytesDownloaded) keep that exact honesty, not a fabricated zero. */
function adaptLegacy(raw: Record<string, unknown>, runId: string): MeasurementsViewModel {
  const overview = (raw.overview ?? {}) as Record<string, unknown>;
  const wordCount = (raw.wordCount ?? {}) as Record<string, unknown>;
  const indexability = (raw.indexability ?? {}) as Record<string, unknown>;
  const renderStats = (raw.renderStats ?? {}) as Record<string, unknown>;
  const linksAndOrphans = (raw.linksAndOrphans ?? {}) as Record<string, unknown>;
  const sitemapCoverage = (raw.sitemapCoverage ?? {}) as Record<string, unknown>;
  const responseTimeMs = (raw.responseTimeMs ?? {}) as Record<string, unknown>;
  const pageWeight = (raw.pageWeight ?? {}) as Record<string, unknown>;
  const bytesDownloaded = (raw.bytesDownloaded ?? {}) as Record<string, unknown>;

  const cards: MeasurementCardVM[] = [];
  const push = (c: MeasurementCardVM) => cards.push(c);
  const avail = (id: string, label: string, category: string, unit: MeasurementUnit, value: number | null, display: string | null, explainer: string) =>
    push({ id, label, category, unit, value, display, explainer, available: value !== null, unavailableReason: value === null ? "Not present in this run's measurements response." : null, sampleSize: null, totalPages: typeof overview.discovered === "number" ? overview.discovered : null });

  avail("pages-crawled", "Pages Crawled", "Coverage", "pages", num(overview, "successful"), num(overview, "successful") !== null ? fmtPages(num(overview, "successful")!) : null, "Pages the crawler successfully fetched and extracted this run.");
  avail("pages-discovered", "Pages Discovered", "Coverage", "pages", num(overview, "discovered"), num(overview, "discovered") !== null ? fmtPages(num(overview, "discovered")!) : null, "Distinct URLs found via links, robots.txt and sitemaps, including ones never fetched.");
  avail("coverage-percent", "Coverage", "Coverage", "percent", num(overview, "coveragePercent"), num(overview, "coveragePercent") !== null ? `${num(overview, "coveragePercent")}%` : null, "Share of allowed, in-scope URLs that were actually attempted this run.");
  avail("blocked-by-robots", "Blocked by robots.txt", "Coverage", "pages", num(overview, "blockedByRobots"), num(overview, "blockedByRobots") !== null ? fmtPages(num(overview, "blockedByRobots")!) : null, "URLs the crawler declined to fetch because robots.txt disallows them.");
  avail("failed", "Failed", "Coverage", "pages", num(overview, "failed"), num(overview, "failed") !== null ? fmtPages(num(overview, "failed")!) : null, "Attempted URLs that never produced a usable page record.");
  avail("max-depth-seen", "Max Depth Seen", "Coverage", "count", num(overview, "maxDepthSeen"), num(overview, "maxDepthSeen") !== null ? String(num(overview, "maxDepthSeen")) : null, "Deepest link-hop distance from the start URL reached this run.");

  avail("duration", "Crawl Duration", "Performance", "ms", num(overview, "durationMs"), num(overview, "durationMs") !== null ? fmtMs(num(overview, "durationMs")!) : null, "Wall-clock time the crawl took, start to finish.");
  avail("pages-per-minute", "Pages / Minute", "Performance", "count", num(overview, "pagesPerMinute"), num(overview, "pagesPerMinute") !== null ? `${num(overview, "pagesPerMinute")}/min` : null, "Successful pages divided by crawl duration in minutes.");
  push({ id: "response-p50", label: "Response Time (p50)", category: "Performance", unit: "ms", value: num(responseTimeMs, "p50"), display: num(responseTimeMs, "p50") !== null ? fmtMs(num(responseTimeMs, "p50")!) : null, explainer: typeof responseTimeMs.caveat === "string" ? responseTimeMs.caveat : "Median response time across crawled pages.", available: num(responseTimeMs, "p50") !== null, unavailableReason: num(responseTimeMs, "p50") === null ? "No response-time samples in this run." : null, sampleSize: null, totalPages: null });
  push({ id: "response-p95", label: "Response Time (p95)", category: "Performance", unit: "ms", value: num(responseTimeMs, "p95"), display: num(responseTimeMs, "p95") !== null ? fmtMs(num(responseTimeMs, "p95")!) : null, explainer: "95th-percentile response time — worst-case for all but the slowest 1-in-20 pages.", available: num(responseTimeMs, "p95") !== null, unavailableReason: num(responseTimeMs, "p95") === null ? "No response-time samples in this run." : null, sampleSize: null, totalPages: null });
  push({ id: "response-max", label: "Response Time (max)", category: "Performance", unit: "ms", value: num(responseTimeMs, "max"), display: num(responseTimeMs, "max") !== null ? fmtMs(num(responseTimeMs, "max")!) : null, explainer: "Slowest single response this run.", available: num(responseTimeMs, "max") !== null, unavailableReason: num(responseTimeMs, "max") === null ? "No response-time samples in this run." : null, sampleSize: null, totalPages: null });

  push({ id: "page-weight", label: "Average Page Weight", category: "Performance", unit: "bytes", value: null, display: null, explainer: "Mean total page weight across crawled pages.", available: false, unavailableReason: typeof pageWeight.reason === "string" ? pageWeight.reason : "Not available.", sampleSize: null, totalPages: null });
  push({ id: "bytes-downloaded", label: "Bytes Downloaded", category: "Performance", unit: "bytes", value: null, display: null, explainer: "Total bytes transferred this run.", available: false, unavailableReason: typeof bytesDownloaded.reason === "string" ? bytesDownloaded.reason : "Not available.", sampleSize: null, totalPages: null });

  avail("word-count-avg", "Average Word Count", "Content", "words", num(wordCount, "avg"), num(wordCount, "avg") !== null ? `${num(wordCount, "avg")} words` : null, "Mean extracted word count across crawled pages.");
  avail("word-count-median", "Median Word Count", "Content", "words", num(wordCount, "median"), num(wordCount, "median") !== null ? `${num(wordCount, "median")} words` : null, "Median extracted word count across crawled pages.");
  avail("thin-content", "Thin Content (<300 words)", "Content", "pages", num(wordCount, "thinContentUnder300"), num(wordCount, "thinContentUnder300") !== null ? fmtPages(num(wordCount, "thinContentUnder300")!) : null, "Pages with fewer than 300 extracted words.");

  avail("indexable", "Indexable", "Indexability", "pages", num(indexability, "indexable"), num(indexability, "indexable") !== null ? fmtPages(num(indexability, "indexable")!) : null, "Pages that served 2xx, aren't noindex, and aren't robots-blocked.");
  avail("noindex", "Noindex", "Indexability", "pages", num(indexability, "noindex"), num(indexability, "noindex") !== null ? fmtPages(num(indexability, "noindex")!) : null, "Pages marked noindex via meta robots or the X-Robots-Tag header.");
  avail("non-ok-status", "Non-2xx Status", "Indexability", "pages", num(indexability, "nonOkStatus"), num(indexability, "nonOkStatus") !== null ? fmtPages(num(indexability, "nonOkStatus")!) : null, "Pages that responded with a status other than 2xx.");

  avail("rendered-http", "Rendered via HTTP", "Performance", "pages", num(renderStats, "http"), num(renderStats, "http") !== null ? fmtPages(num(renderStats, "http")!) : null, "Pages fetched without needing a browser.");
  avail("rendered-playwright", "Rendered in a Browser", "Performance", "pages", num(renderStats, "playwright"), num(renderStats, "playwright") !== null ? fmtPages(num(renderStats, "playwright")!) : null, "Pages the crawler rendered in a real browser because static HTML looked insufficient.");
  avail("render-rate", "Render Rate", "Performance", "percent", num(renderStats, "renderRatePercent"), num(renderStats, "renderRatePercent") !== null ? `${num(renderStats, "renderRatePercent")}%` : null, "Share of pages that needed browser rendering.");

  avail("internal-links", "Internal Links", "Links", "links", num(linksAndOrphans, "internalLinks"), num(linksAndOrphans, "internalLinks") !== null ? `${num(linksAndOrphans, "internalLinks")} links` : null, "Total internal links found across crawled pages.");
  avail("external-links", "External Links", "Links", "links", num(linksAndOrphans, "externalLinks"), num(linksAndOrphans, "externalLinks") !== null ? `${num(linksAndOrphans, "externalLinks")} links` : null, "Total external links found across crawled pages.");
  avail("orphan-candidates", "Orphan Candidates", "Links", "pages", num(linksAndOrphans, "orphanCandidates"), num(linksAndOrphans, "orphanCandidates") !== null ? fmtPages(num(linksAndOrphans, "orphanCandidates")!) : null, "Crawled pages with zero internal links from any other page this crawl reached.");

  avail("sitemap-urls", "URLs in Sitemap", "Coverage", "pages", num(sitemapCoverage, "urlsInSitemap"), num(sitemapCoverage, "urlsInSitemap") !== null ? fmtPages(num(sitemapCoverage, "urlsInSitemap")!) : null, "URLs declared in the site's sitemap(s).");
  avail("sitemap-not-crawled", "In Sitemap, Not Crawled", "Coverage", "pages", num(sitemapCoverage, "inSitemapNotCrawled"), num(sitemapCoverage, "inSitemapNotCrawled") !== null ? fmtPages(num(sitemapCoverage, "inSitemapNotCrawled")!) : null, "Sitemap URLs the crawl never reached.");
  avail("crawled-not-sitemap", "Crawled, Not in Sitemap", "Coverage", "pages", num(sitemapCoverage, "crawledNotInSitemap"), num(sitemapCoverage, "crawledNotInSitemap") !== null ? fmtPages(num(sitemapCoverage, "crawledNotInSitemap")!) : null, "Crawled pages absent from the sitemap.");

  cards.push(histogramCard("status-histogram", "Status Code Breakdown", "Coverage", raw.statusHistogram, "Count of crawled pages per HTTP status code."));
  cards.push(histogramCard("failures-by-class", "Failures by Class", "Coverage", raw.failuresByClass, "Failed requests grouped by why they failed."));

  return {
    runId: typeof raw.runId === "string" ? raw.runId : runId,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date().toISOString(),
    pagesInRun: num(overview, "discovered") ?? 0,
    shape: "legacy",
    cards,
  };
}

export function adaptMeasurements(json: unknown, runId: string): MeasurementsViewModel {
  const raw = (json ?? {}) as Record<string, unknown>;
  if (isV2Shape(raw)) {
    const measurements = raw.measurements as Record<string, unknown>[];
    return {
      runId: typeof raw.runId === "string" ? raw.runId : runId,
      generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date().toISOString(),
      pagesInRun: typeof raw.pagesInRun === "number" ? raw.pagesInRun : 0,
      shape: "v2",
      cards: measurements.map((m) => ({
        id: String(m.id),
        label: String(m.label),
        category: String(m.category),
        unit: (m.unit as MeasurementUnit) ?? "count",
        value: typeof m.value === "number" ? m.value : null,
        display: typeof m.display === "string" ? m.display : null,
        explainer: typeof m.explainer === "string" ? m.explainer : "",
        available: Boolean(m.available),
        unavailableReason: typeof m.unavailableReason === "string" ? m.unavailableReason : null,
        sampleSize: typeof m.sampleSize === "number" ? m.sampleSize : null,
        totalPages: typeof m.totalPages === "number" ? m.totalPages : null,
      })),
    };
  }
  return adaptLegacy(raw, runId);
}

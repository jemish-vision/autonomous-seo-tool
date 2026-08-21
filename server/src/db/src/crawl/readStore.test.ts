import { describe, it, expect } from "vitest";
import { mapCrawlToRunItem, mapCrawlToReport, mapFailureRow, mapPageRow } from "./readStore.js";

describe("mapCrawlToRunItem", () => {
  const base = {
    slug: "site-20260801-120000",
    startUrl: "https://example.com/",
    startedAt: new Date("2026-08-01T10:00:00Z"),
    finishedAt: new Date("2026-08-01T10:05:00Z"),
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: new Date("2026-08-01T10:05:00Z"),
    requestsMade: 120,
    pagesCrawled: 100,
    pagesFailed: 4,
    pagesBlocked: 16,
    coveragePercent: 83.3,
    maxDepthSeen: 4,
    status: "COMPLETED",
    healthScore: 71.5,
  };

  it("maps totals and marks a run analyzed when healthScore was stored", () => {
    const item = mapCrawlToRunItem(base);
    expect(item.runId).toBe("site-20260801-120000");
    expect(item.attempted).toBe(120);
    expect(item.successful).toBe(100);
    expect(item.failed).toBe(4);
    expect(item.blockedByRobots).toBe(16);
    expect(item.coveragePercent).toBe(83.3);
    expect(item.maxDepthSeen).toBe(4);
    expect(item.state).toBe("completed");
    expect(item.analyzed).toBe(true);
    expect(item.healthScore).toBe(71.5);
  });

  it("is analyzed=false when healthScore was never written (no issues imported)", () => {
    const item = mapCrawlToRunItem({ ...base, healthScore: null });
    expect(item.analyzed).toBe(false);
    expect(item.healthScore).toBeNull();
  });

  it("flags cancelled runs", () => {
    expect(mapCrawlToRunItem({ ...base, status: "CANCELLED" }).state).toBe("cancelled");
  });

  it("falls back to created/updated timestamps when start/finish are missing", () => {
    const item = mapCrawlToRunItem({ ...base, startedAt: null, finishedAt: null });
    expect(item.startedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(item.finishedAt).toBe("2026-08-01T10:05:00.000Z");
  });
});

describe("mapCrawlToReport", () => {
  it("reconstructs the dashboard CrawlSummary from a crawl row + link aggregates", () => {
    const report = mapCrawlToReport(
      {
        slug: "site-20260801-120000",
        startUrl: "https://example.com/",
        startedAt: new Date("2026-08-01T10:00:00Z"),
        finishedAt: new Date("2026-08-01T10:05:00Z"),
        durationMs: 300_000,
        pagesDiscovered: 200,
        pagesCrawled: 180,
        pagesFailed: 3,
        pagesBlocked: 17,
        pagesRendered: 12,
        requestsMade: 220,
        maxDepthSeen: 6,
        coveragePercent: 90,
        statusHistogram: { "2xx": 175, "3xx": 3, "4xx": 2 },
        failuresByClass: { timeout: 2 },
        notes: { orphanCandidates: ["https://example.com/orphan"], sitemap: { urlsInSitemap: 50, inSitemapNotCrawled: [], crawledNotInSitemap: [], sitemapEntriesFailed: [] } },
      },
      { internalLinks: 400, externalLinks: 30, redirects: 5 },
    );
    expect(report.runId).toBe("site-20260801-120000");
    expect(report.successful).toBe(180);
    expect(report.internalLinks).toBe(400);
    expect(report.externalLinks).toBe(30);
    expect(report.redirects).toBe(5);
    expect(report.jsRendered).toBe(12);
    expect(report.orphanCandidates).toEqual(["https://example.com/orphan"]);
    expect(report.sitemap.urlsInSitemap).toBe(50);
    expect(report.failuresByClass).toEqual({ timeout: 2 });
  });

  it("tolerates missing notes and histogram", () => {
    const report = mapCrawlToReport(
      { slug: "x", startUrl: "https://x/", startedAt: null, finishedAt: null, durationMs: null, pagesDiscovered: 0, pagesCrawled: 0, pagesFailed: 0, pagesBlocked: 0, pagesRendered: 0, requestsMade: 0, maxDepthSeen: 0, coveragePercent: null, statusHistogram: null, failuresByClass: null, notes: null },
      { internalLinks: 0, externalLinks: 0, redirects: 0 },
    );
    expect(report.orphanCandidates).toEqual([]);
    expect(report.sitemap.urlsInSitemap).toBe(0);
    expect(report.failuresByClass).toEqual({});
    expect(report.statusHistogram).toEqual({});
  });
});

describe("mapFailureRow", () => {
  it("maps DB failure classes back to the dashboard's lowercase reasons", () => {
    expect(mapFailureRow({ url: "https://x/a", normalizedUrl: null, failureClass: "HTTP_4XX", statusCode: 404, attempts: 3, errorMessage: "Not Found", depth: 2, parentUrl: "https://x/" }).reason).toBe("http-4xx");
    expect(mapFailureRow({ url: "https://x/b", normalizedUrl: null, failureClass: "REDIRECT_LOOP", statusCode: null, attempts: 1, errorMessage: null, depth: null, parentUrl: null }).reason).toBe("redirect-loop");
    expect(mapFailureRow({ url: "https://x/c", normalizedUrl: null, failureClass: "TLS", statusCode: null, attempts: 1, errorMessage: null, depth: null, parentUrl: null }).reason).toBe("other");
  });
});

describe("mapPageRow", () => {
  const pageRow = {
    pageKey: "a1b2c3d4e5f6",
    url: "https://example.com/about",
    normalizedUrl: "https://example.com/about",
    finalUrl: null,
    statusCode: 200,
    depth: 1,
    fetchedAt: new Date("2026-08-01T10:02:00Z"),
    responseTimeMs: 120,
    parentUrl: "https://example.com/",
    discoverySources: ["sitemap"],
    canonical: "https://example.com/about",
    noindex: false,
    nofollow: false,
    robotsDirectives: [],
    title: "About Us",
    metaDescription: "Who we are",
    wordCount: 800,
    contentHash: "abc123",
    httpDetail: { headers: { "content-type": "text/html" }, performance: { responseTimeMs: 120 } },
    renderedWith: "HTTP",
    renderSignals: [],
  };

  it("reconstructs the dashboard CrawledPage shape from a page row + child tables", () => {
    const page = mapPageRow("site-1", pageRow, {
      text: "All about us.",
      links: [
        { targetUrl: "https://example.com/", targetNormalized: "https://example.com/", anchor: "Home", scope: "INTERNAL", rel: null, nofollow: false, sponsored: false, ugc: false, targetAttr: null },
        { targetUrl: "https://other.example/x", targetNormalized: null, anchor: "External", scope: "EXTERNAL", rel: "nofollow", nofollow: true, sponsored: false, ugc: false, targetAttr: "_blank" },
      ],
      images: [{ url: "https://example.com/img.png", alt: "logo", declaredWidth: 100, declaredHeight: 50, format: "png" }],
      videos: [{ url: "https://example.com/v.mp4", kind: "FILE", poster: null, mimeType: "video/mp4", providerId: null }],
      headings: [{ level: 1, text: "About Us" }, { level: 2, text: "History" }],
      structuredData: [{ raw: "{}", parsed: { "@type": "Organization" }, parseError: null }],
      redirectChain: [{ fromUrl: "https://example.com/old", toUrl: "https://example.com/about", statusCode: 301 }],
    });

    expect(page.pageId).toBe("a1b2c3d4e5f6");
    expect(page.runId).toBe("site-1");
    expect(page.title).toBe("About Us");
    expect(page.headings).toEqual({ h1: ["About Us"], h2: ["History"], h3: [] });
    expect(page.links).toHaveLength(2);
    expect(page.links[0]!.type).toBe("internal");
    expect(page.links[1]!.type).toBe("external");
    expect(page.links[1]!.nofollow).toBe(true);
    expect(page.images[0]!.width).toBe(100);
    expect(page.videos[0]!.kind).toBe("file");
    expect(page.structuredData[0]!.parsed).toEqual({ "@type": "Organization" });
    expect(page.content).toEqual({ text: "All about us.", wordCount: 800, contentHash: "abc123" });
    expect(page.redirectChain[0]).toEqual({ from: "https://example.com/old", to: "https://example.com/about", statusCode: 301 });
    expect(page.renderedWith).toBe("http");
    expect(page.headers["content-type"]).toBe("text/html");
    expect(page.crawl).toEqual({ depth: 1, parentUrl: "https://example.com/", discoverySources: ["sitemap"] });
  });

  it("degrades cleanly when child rows are absent", () => {
    const page = mapPageRow("site-1", { ...pageRow, wordCount: null, contentHash: null }, {});
    expect(page.headings).toEqual({ h1: [], h2: [], h3: [] });
    expect(page.links).toEqual([]);
    expect(page.images).toEqual([]);
    expect(page.content).toEqual({ text: "", wordCount: 0, contentHash: "" });
    expect(page.redirectChain).toEqual([]);
  });

  it("maps BROWSER rendering to playwright", () => {
    expect(mapPageRow("site-1", { ...pageRow, renderedWith: "BROWSER" }, {}).renderedWith).toBe("playwright");
  });
});

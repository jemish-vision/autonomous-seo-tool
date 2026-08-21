/** Slice S4 implements. */
import { Configuration, CheerioCrawler, PlaywrightCrawler, RequestQueue } from "crawlee";
import { chromium } from "playwright";
import type { BrowserContext, Page, Request as PlaywrightRequest } from "playwright";
import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import { EventLog } from "../events/eventLog";
import type {
  ComputedBackgroundHit,
  CrawlAuth,
  CrawlOptions,
  CrawlSummary,
  CrawlScope,
  CrawlSafety,
  CrawledPage,
  ExternalCheckResult,
  ExtractionResult,
  FailureClass,
  FailureRecord,
  HttpTimings,
  ImageAssetSize,
  ImageRecord,
  LabWebVitals,
  NavigationTimings,
  NetworkObservedAsset,
  PagePerformance,
  Redirect,
  RenderDivergence,
  ResourceSummary,
  RobotsInfo,
  SkippedUrlRecord,
} from "../models/types";
import { normalizeUrl } from "../url/normalize";
import { deriveScope, isInScope, remapAliasedUrl } from "../url/scope";
import { extractPage } from "../extraction/index";
import {
  collectComputedBackgroundsInPage,
  emptyAssetSize,
  mergeComputedBackgroundImages,
  mergeNetworkObservedImages,
  probeImageAsset,
  summarizeImages,
  type ImageFetcher,
} from "../extraction/images";
import { assessGoogleSerpEligibility, buildFaviconReport, probeFaviconCandidates } from "../extraction/favicons";
import { fetchRobots } from "../discovery/robots";
import { discoverSitemaps } from "../discovery/sitemap";
import { needsJsRendering } from "../detection/needsJsRendering";
import { evaluateRenderGain } from "../detection/renderGain";
import { EscalationCalibration } from "../detection/calibration";
import { ScreenshotBudget, DEFAULT_SCREENSHOT_BUDGET } from "../artifacts/screenshotPolicy";
import { maybeUploadScreenshot } from "../artifacts/supabaseUpload";
import { RunStore } from "../storage/runStore";
import { buildSummary } from "../report/summary";
import { authHeaders, checkSafety, defaultSafety } from "./safety";
import { performFormLogin, cookiesToHeader } from "./formLogin";

const KEPT_HEADERS = [
  "content-type",
  "x-robots-tag",
  "content-length",
  "last-modified",
  "content-encoding",
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
] as const;
const MAX_URL_LENGTH = 2000;
const MAX_QUERY_PARAMS = 10;
const MAX_REDIRECT_HOPS = 8;
const REQUEST_HANDLER_TIMEOUT_SECS = 30;
const MAX_REQUEST_RETRIES = 2;
/** Adaptive settle budget before the rendered snapshot — portfolio-style SPAs can take 6-10s
 * (intro loaders) to mount, verified live on sagardalwala.me; SSR pages stabilize in ~2s. */
const RENDER_SETTLE_MAX_MS = 15000;
const RENDER_SETTLE_TICK_MS = 1000;
const EXTERNAL_CHECK_CAP = 50;
const EXTERNAL_CHECK_RPS = 2;
const EXTERNAL_CHECK_TIMEOUT_MS = 10_000;
/** Thumbnail viewport (CSS px) + device scale factor 0.25 → ~342x192 raster output, no
 * post-resize step needed. Set at browser-context creation (see captureScreenshot). */
const THUMB_VIEWPORT = { width: 1368, height: 768 };
const THUMB_DEVICE_SCALE_FACTOR = 0.25;
const THUMB_QUALITY = 75;
const FULL_SCREENSHOT_QUALITY = 80;
const SCREENSHOT_TIMEOUT_MS = 10_000;
/** The thumb re-loads the page from scratch, so it needs the same patience the main pass gets. */
const THUMB_LOAD_TIMEOUT_MS = 30_000;
const THUMB_SETTLE_MAX_MS = 12_000;
/** Image sizing runs against the host we just crawled, so it rides the same rps cap; the cap
 * bounds total cost the way EXTERNAL_CHECK_CAP does for third-party link checks. */
const IMAGE_PROBE_CAP_DEFAULT = 100;
const IMAGE_PROBE_TIMEOUT_MS = 10_000;
/** Enough for every header format decodeImageDimensions handles, including a fat SVG root tag. */
const IMAGE_HEADER_BYTES = 4096;
const FAVICON_PROBE_CAP = 50;
const FAVICON_PROBE_TIMEOUT_MS = 5000;
const FAVICON_READ_BYTES = 8192;
/** One TLS handshake to the seed host, not per-page — the certificate belongs to the host. */
const CERT_CHECK_TIMEOUT_MS = 5000;
/** Computed-style background sweep cap (Kishan's convention) — a getComputedStyle call per element
 * per pseudo-state is not free; bounded so one pathological DOM can't blow the render budget. */
const CSS_SCAN_LIMIT = 4000;

/**
 * Cancellation + the run's activity stream, both optional so direct callers (tests, one-off
 * scripts) don't have to wire either up. `eventLog` is caller-owned so it can be subscribed to
 * (live tail) BEFORE the crawl starts — a fresh one is created internally when omitted.
 */
export interface CrawlRuntime {
  /**
   * Checked between passes and probes, and wired straight into Crawlee's own crawler.stop() —
   * cancelling a crawl must actually stop it from making requests, not just stop reporting them.
   * (The defect this fixes: a reference Stop that set `closed = true` and suppressed only the
   * client-visible stream while the crawl ran to completion and still wrote its report — 22
   * pages fetched after Stop, verified live during the audit.)
   */
  signal?: AbortSignal;
  eventLog?: EventLog;
  /**
   * Pre-fetched robots.txt result — set by the CLI's Crawl-delay pre-probe (index.ts) so the crawl
   * doesn't fetch robots.txt a second time for the same origin. Falls back to fetching internally
   * when omitted (e.g. queue-driven runs that never pre-probed) or when its origin doesn't match
   * this crawl's scope (aliased-host edge case — never trust a mismatched cache over a real fetch).
   */
  preFetchedRobots?: RobotsInfo;
  /** Max non-error pages captured by screenshot importance rank when options.screenshots is on;
   * every error page is captured regardless. Defaults to DEFAULT_SCREENSHOT_BUDGET. */
  screenshotBudget?: number;
  /**
   * Explicit URLs to crawl in addition to the start URL, each at depth 0 exactly like the
   * operator's own start URL (robots gate does NOT apply to them — they were directly asked
   * for). Used by the dashboard's GSC "Crawl N URLs" targeted crawl: the URLs Google excluded
   * under one inspection reason become the seeds, with maxDepth 0 so only they are fetched.
   */
  extraSeeds?: string[];
}

/** Thrown when a crawl is cancelled mid-run, so the caller (the queue) can classify the job as
 * "cancelled" rather than "failed" — see queue/queue.ts's `run()`. */
export class CrawlCancelledError extends Error {
  constructor(message = "crawl cancelled") {
    super(message);
    this.name = "CrawlCancelledError";
  }
}

/** Wires the cancellation signal into Crawlee itself: crawler.stop() halts new requests from
 * being dispatched at all. Requests already in flight when stop() is called may still finish —
 * there is no way to abort a socket mid-response through Crawlee's public API — but nothing NEW
 * starts, which is what "outbound requests actually cease" means once the grace period passes. */
async function runCrawlerWithAbort(
  crawler: CheerioCrawler | PlaywrightCrawler,
  seed: SeedRequest[],
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) return;
  const onAbort = (): void => void crawler.stop("cancelled");
  signal?.addEventListener("abort", onAbort);
  try {
    await crawler.run(seed);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Host-level TLS check: connects once, never throws. Verification stays at Node's secure default
 * (rejectUnauthorized: true, unchanged) — an invalid/self-signed/expired cert makes the handshake
 * itself fail, and Node's own verifier error (err.code, e.g. CERT_HAS_EXPIRED) is the "note" for
 * that case, which is exactly the diagnostic a certificate check exists to surface. Nothing here
 * ever trusts a certificate it shouldn't; it only reports what the standard verifier decided. */
export function checkCertificate(
  hostname: string,
  timeoutMs: number,
  port = 443,
): Promise<{ valid: boolean; note: string; validFrom: string | null; validTo: string | null }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { valid: boolean; note: string; validFrom: string | null; validTo: string | null }): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    // SNI (servername) is only valid for a DNS name, never an IP literal — RFC 6066. Omitting it
    // for an IP target avoids Node's deprecation warning and lets the handshake proceed the same
    // way a browser's would.
    const servername = net.isIP(hostname) ? undefined : hostname;
    const socket = tls.connect({ host: hostname, port, servername, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      finish({
        valid: true,
        note: "certificate is valid and trusted",
        validFrom: cert && "valid_from" in cert ? cert.valid_from : null,
        validTo: cert && "valid_to" in cert ? cert.valid_to : null,
      });
      socket.end();
    });
    socket.on("timeout", () => {
      finish({ valid: false, note: "TLS handshake timed out", validFrom: null, validTo: null });
      socket.destroy();
    });
    // A verification failure (expired/self-signed/hostname mismatch/etc.) surfaces here, before
    // the connect callback ever fires — Node destroys the socket rather than completing the
    // handshake. err.message/err.code (e.g. CERT_HAS_EXPIRED) IS the finding in that case.
    socket.on("error", (err: Error) => {
      finish({ valid: false, note: err.message, validFrom: null, validTo: null });
    });
  });
}

/**
 * Auth step 2 (C1): runs the browser-driven login ONCE, before the crawl loop, and folds the
 * resulting session cookie into a CrawlAuth so it rides B2's existing authHeaders()/defaultSafety()
 * path unchanged — that single Cookie header then reaches BOTH the CheerioCrawler pass (request
 * headers) and the Playwright escalation pass (setExtraHTTPHeaders), so neither fetch layer is
 * left anonymous. Throws on failure — a half-anonymous authenticated crawl is worse than none, so
 * the caller must abort rather than fall through with effectiveAuth unchanged.
 */
async function resolveEffectiveAuth(auth: CrawlAuth | null): Promise<CrawlAuth | null> {
  if (!auth?.formLogin) return auth;

  const loginBrowser = await chromium.launch();
  try {
    const loginContext = await loginBrowser.newContext();
    const result = await performFormLogin(auth.formLogin, loginContext);
    if (!result.ok) {
      throw new Error(`Form login failed at ${auth.formLogin.loginUrl}, aborting crawl (no anonymous fallback): ${result.error ?? "unknown reason"}`);
    }
    const sessionCookie = cookiesToHeader(result.cookies);
    console.log(`[auth] form login OK at ${auth.formLogin.loginUrl} — session cookie captured for both fetch passes`);
    return { ...auth, cookie: auth.cookie ? `${auth.cookie}; ${sessionCookie}` : sessionCookie };
  } finally {
    await loginBrowser.close();
  }
}

interface DiscoveryEntry {
  depth: number;
  parentUrl: string | null;
  sources: Set<string>;
}

/** got's timing object, typed locally — crawlee re-exports it only as `unknown`-ish plumbing. */
interface GotTimings {
  start?: number;
  socket?: number;
  lookup?: number;
  connect?: number;
  secureConnect?: number;
  response?: number;
  end?: number;
  phases?: { dns?: number; tcp?: number; tls?: number; firstByte?: number; download?: number; total?: number };
}

function round1(v: number | null): number | null {
  return v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
}

/** Transport-level phases for the document request. This is what responseTimeMs must come from —
 * never the browser's wall-clock, which includes JS execution and the crawler's own settle waits. */
function httpTimingsFromGot(t: GotTimings | undefined): HttpTimings | null {
  if (!t) return null;
  const p = t.phases ?? {};
  const ttfb = t.response !== undefined && t.start !== undefined ? t.response - t.start : (p.firstByte ?? null);
  return {
    dnsMs: round1(p.dns ?? null),
    connectMs: round1(p.tcp ?? null),
    tlsMs: round1(p.tls ?? null),
    ttfbMs: round1(ttfb ?? null),
    downloadMs: round1(p.download ?? null),
    totalMs: round1(p.total ?? null),
    source: "http-transport",
  };
}

/** Playwright reports -1 for phases that did not apply (no TLS on http://, cached DNS). */
function httpTimingsFromPlaywright(t: {
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  connectEnd: number;
  secureConnectionStart: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
}): HttpTimings {
  const span = (from: number, to: number): number | null => (from >= 0 && to >= from ? to - from : null);
  return {
    dnsMs: round1(span(t.domainLookupStart, t.domainLookupEnd)),
    connectMs: round1(span(t.connectStart, t.connectEnd)),
    tlsMs: round1(span(t.secureConnectionStart, t.connectEnd)),
    ttfbMs: round1(span(t.requestStart, t.responseStart)),
    downloadMs: round1(span(t.responseStart, t.responseEnd)),
    totalMs: round1(t.responseEnd >= 0 ? t.responseEnd : null),
    source: "browser-request-timing",
  };
}

/** Registered via addInitScript so the observers exist before any page script runs; `buffered`
 * then also replays entries emitted before registration. */
const VITALS_INIT_SCRIPT = `(() => {
  const v = { lcpMs: null, lcpElement: null, lcpUrl: null, cls: 0, longTasks: 0, tbtMs: 0,
              lcpSupported: false, clsSupported: false, longTaskSupported: false };
  window.__seoVitals = v;
  try {
    new PerformanceObserver((list) => {
      const e = list.getEntries()[list.getEntries().length - 1];
      if (!e) return;
      v.lcpMs = e.startTime;
      v.lcpUrl = e.url || null;
      const el = e.element;
      v.lcpElement = el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : null;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    v.lcpSupported = true;
  } catch (_) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) v.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    v.clsSupported = true;
  } catch (_) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { v.longTasks++; v.tbtMs += Math.max(0, e.duration - 50); }
    }).observe({ type: 'longtask', buffered: true });
    v.longTaskSupported = true;
  } catch (_) {}
})();`;

const VITALS_NOT_MEASURED = [
  "INP (needs real user interaction)",
  "FID (needs real user interaction)",
  "field/CrUX data (this is a single synthetic load, not real users)",
  "Speed Index",
  "Lighthouse performance score",
];

/**
 * Reads the lab vitals accumulated so far. MUST be called before the crawler scrolls: scrolling
 * counts as interaction and freezes LCP, so a post-scroll read would silently under-report it.
 */
async function readLabWebVitals(page: Page, blockedTypes: string[]): Promise<LabWebVitals | null> {
  const raw: Record<string, unknown> | null = await page
    .evaluate((): Record<string, unknown> | null => {
      const w = window as unknown as { __seoVitals?: Record<string, unknown> };
      const v = w.__seoVitals;
      if (!v) return null;
      const paint = performance.getEntriesByName("first-contentful-paint")[0];
      return { ...v, fcpMs: paint ? paint.startTime : null, now: performance.now() };
    })
    .catch(() => null);
  if (!raw) return null;

  const num = (k: string): number | null => {
    const v = raw[k];
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  };
  const blocked = blockedTypes.length > 0 ? ` The crawler blocked ${blockedTypes.join("/")} requests, so LCP cannot be an image and page weight is understated.` : "";
  return {
    lcpMs: raw.lcpSupported ? num("lcpMs") : null,
    lcpElement: typeof raw.lcpElement === "string" ? raw.lcpElement : null,
    lcpUrl: typeof raw.lcpUrl === "string" && raw.lcpUrl ? raw.lcpUrl : null,
    cls: raw.clsSupported ? num("cls") : null,
    fcpMs: num("fcpMs"),
    longTasks: raw.longTaskSupported ? num("longTasks") : null,
    totalBlockingTimeMs: raw.longTaskSupported ? num("tbtMs") : null,
    observationEndedAtMs: num("now"),
    note:
      "LAB data: one cold load in the crawler's own headless Chromium on this machine — not Google field/CrUX data and not comparable to a Search Console score. " +
      "Measurement stopped at observationEndedAtMs (before the crawler scrolled), so LCP and CLS are lower bounds." +
      blocked,
    notMeasured: VITALS_NOT_MEASURED,
  };
}

/** Never declare a named inner function inside a page.evaluate body: tsx/esbuild wraps those in
 * `__name(...)`, which does not exist in the page and throws ReferenceError. Normalize on this side. */
async function readNavigationTimings(page: Page): Promise<NavigationTimings | null> {
  const raw = await page
    .evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!n) return null;
      return {
        ttfbMs: n.responseStart,
        domInteractiveMs: n.domInteractive,
        domContentLoadedMs: n.domContentLoadedEventEnd,
        loadEventMs: n.loadEventEnd,
        responseEndMs: n.responseEnd,
        transferSizeBytes: n.transferSize,
        encodedBodySizeBytes: n.encodedBodySize,
        decodedBodySizeBytes: n.decodedBodySize,
      };
    })
    .catch(() => null);
  if (!raw) return null;

  const ms = (v: number): number | null => (Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null);
  const bytes = (v: number): number | null => (Number.isFinite(v) && v >= 0 ? v : null);
  return {
    ttfbMs: ms(raw.ttfbMs),
    domInteractiveMs: ms(raw.domInteractiveMs),
    domContentLoadedMs: ms(raw.domContentLoadedMs),
    loadEventMs: ms(raw.loadEventMs),
    responseEndMs: ms(raw.responseEndMs),
    transferSizeBytes: bytes(raw.transferSizeBytes),
    encodedBodySizeBytes: bytes(raw.encodedBodySizeBytes),
    decodedBodySizeBytes: bytes(raw.decodedBodySizeBytes),
  };
}

async function readResourceSummary(page: Page, pageUrl: string, blockedTypes: string[]): Promise<ResourceSummary | null> {
  const raw = await page
    .evaluate((origin: string) => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const byType: Record<string, number> = {};
      const transferBytesByType: Record<string, number> = {};
      let totalTransfer = 0;
      let totalDecoded = 0;
      let zeroTransfer = 0;
      let thirdPartyRequests = 0;
      let thirdPartyTransfer = 0;
      for (const e of entries) {
        const type = e.initiatorType || "other";
        byType[type] = (byType[type] ?? 0) + 1;
        const transfer = Number.isFinite(e.transferSize) ? e.transferSize : 0;
        if (transfer === 0) zeroTransfer++;
        transferBytesByType[type] = (transferBytesByType[type] ?? 0) + transfer;
        totalTransfer += transfer;
        totalDecoded += Number.isFinite(e.decodedBodySize) ? e.decodedBodySize : 0;
        let sameOrigin = true;
        try {
          sameOrigin = new URL(e.name).origin === origin;
        } catch {
          sameOrigin = true;
        }
        if (!sameOrigin) {
          thirdPartyRequests++;
          thirdPartyTransfer += transfer;
        }
      }
      return {
        total: entries.length,
        byType,
        transferBytesByType,
        totalTransferBytes: totalTransfer,
        totalDecodedBytes: totalDecoded,
        zeroTransferCount: zeroTransfer,
        thirdPartyRequests,
        thirdPartyTransferBytes: thirdPartyTransfer,
      };
    }, safeOrigin(pageUrl))
    .catch(() => null);
  return raw ? { ...raw, blockedTypes } : null;
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

interface ObservedImage {
  /** The element's own src/data-src attribute, resolved — the identity the extractor keyed on. */
  src: string;
  /** The candidate the browser actually loaded. Differs from `src` whenever srcset/<picture> won. */
  currentSrc: string;
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
}

/** Sizes the browser already paid for — always cheaper than a probe request. naturalWidth is 0
 * on an image that never loaded (aborted or 404), which must stay null rather than become a 0. */
async function readObservedImages(page: Page): Promise<{ images: ObservedImage[]; transfer: Record<string, number> }> {
  const empty = { images: [] as ObservedImage[], transfer: {} as Record<string, number> };
  return (
    (await page
      .evaluate(() => {
        const transfer: Record<string, number> = {};
        for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
          if (e.initiatorType === "img" || e.initiatorType === "css" || e.initiatorType === "image") {
            const bytes = Number.isFinite(e.encodedBodySize) && e.encodedBodySize > 0 ? e.encodedBodySize : e.transferSize;
            if (Number.isFinite(bytes) && bytes > 0) transfer[e.name] = bytes;
          }
        }
        const images = [];
        for (const el of Array.from(document.querySelectorAll("img"))) {
          const box = el.getBoundingClientRect();
          const attr = el.getAttribute("src") || el.getAttribute("data-src") || "";
          let src = "";
          try {
            // document.baseURI honours <base href> exactly as the extractor's resolveBase does.
            src = attr ? new URL(attr, document.baseURI).href : "";
          } catch {
            src = "";
          }
          images.push({
            src,
            currentSrc: el.currentSrc || "",
            naturalWidth: el.naturalWidth,
            naturalHeight: el.naturalHeight,
            renderedWidth: Math.round(box.width),
            renderedHeight: Math.round(box.height),
          });
        }
        return { images, transfer };
      })
      .catch(() => null)) ?? empty
  );
}

/**
 * Folds browser-observed sizes onto the extracted records so the post-crawl probe can skip them.
 * Matched on the element's own src attribute and consumed in document order — matching on any
 * URL the record mentions would let a srcset candidate pull in a DIFFERENT element's measurements.
 * naturalWidth/bytes describe whatever `currentSrc` loaded, so they are only adopted when the
 * browser actually chose the record's own URL; otherwise the probe still has to answer for it.
 */
function applyObservedImageSizes(extraction: ExtractionResult, observed: { images: ObservedImage[]; transfer: Record<string, number> }): void {
  const queued = new Map<string, ObservedImage[]>();
  for (const o of observed.images) {
    if (!o.src) continue;
    const list = queued.get(o.src);
    if (list) list.push(o);
    else queued.set(o.src, [o]);
  }

  for (const record of extraction.images) {
    const hit = queued.get(record.url)?.shift();
    if (!hit) continue;
    record.renderedWidth = hit.renderedWidth > 0 ? hit.renderedWidth : null;
    record.renderedHeight = hit.renderedHeight > 0 ? hit.renderedHeight : null;
    record.currentSrc = hit.currentSrc || null;

    if (hit.currentSrc !== record.url) continue; // srcset/<picture> loaded something else
    // naturalWidth 0 means the browser never decoded an image here, so its transfer size is an
    // error body — a 404 page would otherwise be recorded as a 9-byte image. Leave it to the probe.
    if (hit.naturalWidth <= 0 || hit.naturalHeight <= 0) continue;
    const bytes = observed.transfer[record.url] ?? null;
    record.asset = {
      bytes,
      byteSource: bytes === null ? null : "browser-transfer",
      naturalWidth: hit.naturalWidth,
      naturalHeight: hit.naturalHeight,
      naturalSource: "browser",
      status: null,
      sizeError: bytes === null ? "browser-did-not-report-transfer-size" : null,
    };
  }

  for (const record of extraction.backgroundImages ?? []) {
    const bytes = observed.transfer[record.url];
    if (typeof bytes !== "number" || bytes <= 0) continue;
    record.asset = {
      bytes,
      byteSource: "browser-transfer",
      naturalWidth: null,
      naturalHeight: null,
      naturalSource: null,
      status: null,
      sizeError: null,
    };
  }
}

/**
 * Nayan's decode settle: forces the browser to finish decoding pixel data for every <img> before
 * readObservedImages reads naturalWidth/naturalHeight, so those numbers reflect genuinely decoded
 * pixels rather than "the network response arrived but decode hasn't happened yet" (naturalWidth
 * can read 0 in that window). Run twice — a single pass can race a late srcset swap on some sites.
 * Inline anonymous callback (no named inner function) — the __name() trap this file's own doc
 * comments warn about only bites named function/const-arrow declarations, and this file already
 * uses this exact inline-arrow shape for every other page.evaluate() call.
 */
async function settleImageDecode(page: Page): Promise<void> {
  const decodeAll = () =>
    page
      .evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll("img"));
        await Promise.all(
          imgs.map((img) =>
            img.decode
              ? Promise.race([
                  img.decode(),
                  new Promise((resolve) => setTimeout(resolve, 1500)),
                ]).catch(() => {})
              : Promise.resolve()
          )
        );
      })
      .catch(() => {});
  await decodeAll();
  await decodeAll();
}

type SeedRequest = { url: string; uniqueKey: string; headers?: Record<string, string> };

/**
 * A URL flagged for Playwright re-fetch. `staticHtml`/`staticExtraction` carry the static pass's
 * own capture so the Playwright handler can diff raw-vs-rendered without re-reading from disk —
 * present for real JS-detection escalations and 403/429 retry-in-browser (both have a real static
 * body); null for pure network-failure retries (timeout/DNS never got a response to diff against).
 */
interface EscalationCandidate {
  signals: string[];
  staticHtml: string | null;
  staticExtraction: ExtractionResult | null;
  /** Decided once, up front, by the bounded screenshot policy — never re-decided in the Playwright
   * pass, so admitting a page never double-consumes the importance budget. */
  wantsScreenshot: boolean;
  /** True only when needsJsRendering() itself fired (not a 403/429 retry, not screenshots-forced,
   * not an error-page force) — the only escalations the calibration budget tracks. */
  heuristicEscalation: boolean;
}

/**
 * The whole crawl: robots → sitemap discovery → seed queue → static-first Crawlee crawl with
 * JS-detection escalation to Playwright → storage → summary. Returns the built summary
 * (already persisted via RunStore.saveReport).
 *
 * `checkExternal` (A2, `--check-external`) is a second param rather than a CrawlOptions field —
 * models/types.ts is do_not_touch for this slice, and threading it through the CLI only touches
 * files this slice owns. `runtime` (cancellation + the activity event stream) follows the same
 * pattern for the same reason.
 */
export async function runCrawl(
  options: CrawlOptions,
  checkExternal = false,
  runtime: CrawlRuntime = {},
): Promise<CrawlSummary> {
  const startedAt = new Date();

  const normalizedStart = normalizeUrl(options.startUrl);
  if (!normalizedStart) {
    throw new Error(`Invalid start URL: ${options.startUrl}`);
  }
  const scope = deriveScope(normalizedStart, options.hostAliases);

  const signal = runtime.signal;
  const isCancelled = (): boolean => signal?.aborted === true;
  const eventLog = runtime.eventLog ?? new EventLog(options.outDir, options.runId);
  await eventLog.init();
  eventLog.emit({ kind: "crawl-started", url: normalizedStart, statusCode: null, message: `Crawl started: ${normalizedStart}` });

  if (!isCancelled()) {
    const certOrigin = new URL(scope.seedOrigin);
    if (certOrigin.protocol === "https:") {
      const cert = await checkCertificate(certOrigin.hostname, CERT_CHECK_TIMEOUT_MS);
      eventLog.emit({
        kind: "certificate-check",
        url: scope.seedOrigin,
        statusCode: null,
        message: `Checking the certificate… ${cert.note}`,
        detail: { valid: cert.valid, validFrom: cert.validFrom, validTo: cert.validTo },
      });
    } else {
      eventLog.emit({
        kind: "certificate-check",
        url: scope.seedOrigin,
        statusCode: null,
        message: "Served over plain HTTP — no certificate to check.",
        detail: { valid: null },
      });
    }
  }

  // C1: resolve the form-login session (if configured) BEFORE creating any run evidence — a
  // failed login must leave no partial run directory behind.
  const effectiveAuth = await resolveEffectiveAuth(options.auth ?? null);

  const store = new RunStore(options.outDir, options.runId);
  await store.init();

  // Auth + safety (B2). authHdrs is the single source of truth for "is auth configured" —
  // it's {} whenever CrawlAuth carries nothing, so hasAuth needs no separate presence check.
  // effectiveAuth carries the form-login session cookie merged in (C1) alongside any static
  // basic/cookie/header auth, so both B2 helpers see the full picture unchanged.
  const authHdrs = authHeaders(effectiveAuth);
  const hasAuth = Object.keys(authHdrs).length > 0;
  const safety: CrawlSafety = options.safety ?? defaultSafety(effectiveAuth);
  // Mirrors the route() aborts in the Playwright pass. Recorded on every page so a reader knows
  // the captured page weight excludes these and is a floor, not the real visitor download.
  const blockedResourceTypes: string[] = [];
  if (!options.screenshots) blockedResourceTypes.push("image", "media");
  if (!options.loadFonts && !options.screenshots) blockedResourceTypes.push("font");
  /** Dedup by URL — a guarded path (e.g. /logout) is typically linked from every member page. */
  const skippedByUrl = new Map<string, SkippedUrlRecord>();
  function makeSeedRequest(url: string): SeedRequest {
    return hasAuth ? { url, uniqueKey: url, headers: authHdrs } : { url, uniqueKey: url };
  }

  // Session-loss detection (basic — full detection is a later step): warn once if an
  // authenticated crawl gets a 401/403 after at least one page already succeeded.
  let sawAuthSuccess = false;
  let sessionLossWarned = false;
  function noteAuthResponse(url: string, statusCode: number | null): void {
    if (!hasAuth || statusCode === null) return;
    if ((statusCode === 401 || statusCode === 403) && sawAuthSuccess && !sessionLossWarned) {
      sessionLossWarned = true;
      console.warn(`[auth] session may have expired at ${url} — later pages may be anonymous`);
    } else if (statusCode >= 200 && statusCode < 400) {
      sawAuthSuccess = true;
    }
  }

  const discovery = new Map<string, DiscoveryEntry>();
  const blocked = new Set<string>();
  const processedUrls = new Set<string>();
  const failures: FailureRecord[] = [];
  let discoveredCount = 0;

  // Chromium fallback for failed fetches (403/429/timeout/network): the failure is parked, the
  // URL rides the escalation pass, and the parked record is written only if Chromium never got
  // to it — Chromium's own outcome (page or failure) wins otherwise.
  const heldFailures = new Map<string, FailureRecord>();
  const pwOutcomes = new Set<string>();
  async function flushHeldFailures(): Promise<void> {
    for (const [url, failure] of heldFailures) {
      if (!pwOutcomes.has(url)) await recordFailure(failure);
    }
    heldFailures.clear();
  }

  // Always needed for evidence + sitemap declarations; --no-robots only turns off enforcement.
  // Reuses the CLI's own Crawl-delay pre-probe (index.ts) when it already fetched this exact
  // origin, instead of fetching robots.txt a second time per crawl — the origin check guards the
  // aliased-host edge case where a mismatched cached fetch would otherwise silently stand in.
  const preFetched = runtime.preFetchedRobots;
  const robots: RobotsInfo =
    preFetched && preFetched.url === new URL("/robots.txt", scope.seedOrigin).toString()
      ? preFetched
      : await fetchRobots(scope.seedOrigin, options.userAgent);
  const { isAllowed: _isAllowed, ...robotsEvidence } = robots;
  await store.saveRobots(robotsEvidence);

  // Plan-review round 2: robots.txt declares sitemap URLs on the aliased host (e.g.
  // summittrailgear.example) which never resolves while crawling localhost — remap before fetch.
  const remappedRobotsForSitemap: RobotsInfo = {
    ...robots,
    sitemaps: robots.sitemaps.map((s) => remapAliasedUrl(s, scope)),
  };
  const sitemap = await discoverSitemaps(remappedRobotsForSitemap, scope.seedOrigin, {
    userAgent: options.userAgent,
    // Aliased hosts are this site, so their URLs must not count as cross-host.
    originHosts: [new URL(scope.seedOrigin).hostname, ...scope.hostAliases],
  });
  await store.saveSitemaps(sitemap);

  // Bounded screenshot policy (owner-approved): top-N pages by importance + every error page, not
  // every page. Only meaningful when --screenshots is on; the budget is otherwise never consulted.
  const screenshotBudget = new ScreenshotBudget({ topN: runtime.screenshotBudget ?? DEFAULT_SCREENSHOT_BUDGET });

  // Escalation-heuristic calibration: gain-tests the first CALIBRATION_SAMPLE_SIZE heuristic-driven
  // escalations (never retry/screenshot-forced ones) and kills further heuristic escalation for the
  // rest of THIS crawl if the no-gain rate clears the threshold — the budget catches what the
  // signals miss, since no heuristic is right on every framework. Logic lives in a standalone,
  // independently unit-tested class (src/detection/calibration.ts); this is just the console note.
  const calibration = new EscalationCalibration();
  function recordCalibrationSample(gained: boolean): void {
    const justKilled = calibration.record(gained);
    if (justKilled) {
      const { samplesRecorded, gainedCount } = calibration.stats;
      console.warn(
        `[calibration] first ${samplesRecorded} JS-render escalations gained something on only ` +
          `${gainedCount}/${samplesRecorded} — killing further heuristic-driven render escalation ` +
          "for the rest of this crawl.",
      );
    }
  }

  function exceedsUrlCaps(url: string): boolean {
    if (url.length > MAX_URL_LENGTH) return true;
    try {
      return Array.from(new URL(url).searchParams.keys()).length > MAX_QUERY_PARAMS;
    } catch {
      return false;
    }
  }

  /**
   * Single gate for every discovery path (seed/sitemap/html-link/rendered-DOM link): enforces the
   * URL caps, scope, and robots, then merges into the shared discovery map. Returns true only the
   * first time a URL clears every gate — callers use that to decide whether to actually enqueue.
   */
  function considerUrl(
    normalizedUrl: string,
    depth: number,
    parentUrl: string | null,
    source: string,
    applyRobots: boolean,
  ): boolean {
    if (exceedsUrlCaps(normalizedUrl)) {
      discoveredCount++;
      console.warn(`[skip] URL exceeds length/query-param cap: ${normalizedUrl.slice(0, 100)}`);
      return false;
    }
    if (!isInScope(normalizedUrl, scope)) return false;
    discoveredCount++;

    // Discovered but beyond the operator's link-hop budget — never enters the frontier.
    if (options.maxDepth !== null && depth > options.maxDepth) return false;

    if (applyRobots && options.respectRobots && !robots.isAllowed(normalizedUrl, options.userAgent)) {
      blocked.add(normalizedUrl);
      return false;
    }

    // Guard rails (B2): a skipped URL is recorded as evidence, never enqueued, and never
    // counted as a failure — its own bucket, mirroring the robots-blocked handling above.
    const skip = checkSafety(normalizedUrl, parentUrl, safety);
    if (skip) {
      if (!skippedByUrl.has(normalizedUrl)) skippedByUrl.set(normalizedUrl, skip);
      return false;
    }

    const existing = discovery.get(normalizedUrl);
    if (existing) {
      existing.sources.add(source);
      return false;
    }
    discovery.set(normalizedUrl, { depth, parentUrl, sources: new Set([source]) });
    return true;
  }

  // Seed: the operator's explicit start URL always crawls — robots gate applies to discovered
  // links, not the URL the operator directly asked for.
  discovery.set(normalizedStart, { depth: 0, parentUrl: null, sources: new Set(["seed"]) });
  discoveredCount++;
  const initialSeed: SeedRequest[] = [makeSeedRequest(normalizedStart)];

  // Extra explicit seeds (GSC targeted crawl): same treatment as the start URL — depth 0, robots
  // gate skipped (directly asked for), scope still enforced so an off-host URL can't slip in.
  for (const raw of runtime.extraSeeds ?? []) {
    const normalized = normalizeUrl(raw);
    if (!normalized) continue;
    if (!isInScope(normalized, scope)) continue;
    const existing = discovery.get(normalized);
    if (existing) {
      existing.sources.add("seed");
      continue;
    }
    discovery.set(normalized, { depth: 0, parentUrl: null, sources: new Set(["seed"]) });
    discoveredCount++;
    initialSeed.push(makeSeedRequest(normalized));
  }

  for (const entry of sitemap.entries) {
    const remapped = remapAliasedUrl(entry.url, scope);
    const normalized = normalizeUrl(remapped);
    if (!normalized) continue;
    if (considerUrl(normalized, 1, null, "sitemap", true)) {
      initialSeed.push(makeSeedRequest(normalized));
    }
  }

  function pickHeaders(raw: Record<string, string | string[] | undefined> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw) return out;
    for (const key of KEPT_HEADERS) {
      const v = raw[key];
      if (typeof v === "string") out[key] = v;
      else if (Array.isArray(v) && v.length > 0) out[key] = v.join(", ");
    }
    return out;
  }

  /** Crawlee raises anti-bot blocks as thrown errors ("Request blocked - received 429 status
   * code") — pull the real status back out so 429/403 don't vanish into "other". */
  function blockedStatusFrom(error: Error): number | null {
    const m = /received (\d{3}) status code/i.exec(error.message ?? "");
    return m && m[1] ? Number(m[1]) : null;
  }

  function classifyError(error: Error): FailureClass {
    const name = error.name ?? "";
    const code = (error as NodeJS.ErrnoException).code ?? "";
    const msg = error.message ?? "";
    const blockedStatus = blockedStatusFrom(error);
    if (blockedStatus !== null) return blockedStatus >= 500 ? "http-5xx" : "http-4xx";
    if (name === "TimeoutError" || /timeout/i.test(msg)) return "timeout";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /getaddrinfo/i.test(msg)) return "dns";
    if (name === "MaxRedirectsError" || code === "ERR_TOO_MANY_REDIRECTS" || /too many redirects/i.test(msg)) {
      return "redirect-loop";
    }
    if (/parse|cheerio|invalid html/i.test(msg)) return "parse-error";
    return "other";
  }

  /** Exponential per-request backoff before Crawlee retries a rate-limited (429) fetch —
   * hammering a host that just told us to slow down converts retries into guaranteed failures. */
  async function backoffOnRateLimit(request: { userData: Record<string, unknown> }, error: Error): Promise<void> {
    if (blockedStatusFrom(error) !== 429) return;
    const attempt = typeof request.userData.__rateLimited === "number" ? request.userData.__rateLimited + 1 : 1;
    request.userData.__rateLimited = attempt;
    await new Promise((r) => setTimeout(r, Math.min(3000 * 2 ** (attempt - 1), 15000)));
  }

  function buildCrawledPage(params: {
    normalizedUrl: string;
    finalUrl: string | null;
    statusCode: number | null;
    headers: Record<string, string>;
    performance: PagePerformance;
    extraction: ExtractionResult;
    redirectChain: Redirect[];
    renderedWith: "http" | "playwright";
    renderSignals: string[];
    renderDivergence?: RenderDivergence | null;
    screenshot?: { thumb: string; full: string; capturedAt: string } | null;
  }): CrawledPage {
    const meta = discovery.get(params.normalizedUrl);
    return {
      ...params.extraction,
      // null = never escalated or no static baseline to diff; set by the PW pass otherwise.
      renderDivergence: params.renderDivergence ?? null,
      // undefined = --screenshots wasn't requested for this page (kept out of buildCrawledPage's
      // params entirely below); never coerced to null so the "not attempted" case stays honest.
      screenshot: params.screenshot,
      runId: options.runId,
      url: params.normalizedUrl,
      normalizedUrl: params.normalizedUrl,
      finalUrl: params.finalUrl,
      statusCode: params.statusCode,
      redirectChain: params.redirectChain,
      headers: params.headers,
      performance: params.performance,
      renderedWith: params.renderedWith,
      renderSignals: params.renderSignals,
      fetchedAt: new Date().toISOString(),
      crawl: {
        depth: meta?.depth ?? 0,
        parentUrl: meta?.parentUrl ?? null,
        discoverySources: meta ? Array.from(meta.sources) : [],
      },
    };
  }

  async function recordFailure(failure: FailureRecord): Promise<void> {
    failures.push(failure);
    await store.saveFailure(failure);
  }

  /**
   * got/Cheerio only exposes the URLs a redirect traversed (response.redirectUrls), not per-hop
   * status. Real per-hop codes require a manual redirect:'manual' walk; on any hop failure the
   * sentinel 0 marks "not observed" rather than fabricating a plausible-looking 3xx.
   */
  async function traceCheerioRedirects(originalUrl: string, redirectUrls: string[]): Promise<Redirect[]> {
    if (redirectUrls.length === 0) return [];
    const hops = [originalUrl, ...redirectUrls];
    const chain: Redirect[] = [];
    for (let i = 0; i < hops.length - 1 && i < MAX_REDIRECT_HOPS; i++) {
      const from = hops[i]!;
      const to = hops[i + 1]!;
      let statusCode = 0;
      try {
        const res = await fetch(from, {
          method: "GET",
          redirect: "manual",
          headers: { "user-agent": options.userAgent },
          signal: AbortSignal.timeout(5000),
        });
        statusCode = res.status;
      } catch {
        statusCode = 0;
      }
      chain.push({ from, to, statusCode });
    }
    return chain;
  }

  /** Raw-vs-rendered diff for an escalated page. Called only once the static snapshot has been
   * saved via saveStaticRaw, so staticRawSaved is always true here. */
  function computeRenderDivergence(staticExtraction: ExtractionResult, renderedExtraction: ExtractionResult): RenderDivergence {
    return {
      titleChanged: staticExtraction.title !== renderedExtraction.title,
      metaDescriptionChanged: staticExtraction.metaDescription !== renderedExtraction.metaDescription,
      canonicalChanged: staticExtraction.canonical !== renderedExtraction.canonical,
      noindexChanged: staticExtraction.robots.noindex !== renderedExtraction.robots.noindex,
      linkCountDelta: renderedExtraction.links.length - staticExtraction.links.length,
      wordCountDelta: renderedExtraction.content.wordCount - staticExtraction.content.wordCount,
      staticRawSaved: true,
      staticCanonical: staticExtraction.canonical,
      renderedCanonical: renderedExtraction.canonical,
      staticNoindex: staticExtraction.robots.noindex,
      renderedNoindex: renderedExtraction.robots.noindex,
    };
  }

  /**
   * --screenshots: full-page + thumbnail WebP. MUST run after any scroll — scrolling to trigger
   * lazy content freezes LCP, so if a future pass ever reads Core Web Vitals on this same page
   * visit the order must stay vitals -> scroll -> screenshot. Never throws — a failed capture
   * must not fail the page's crawl record.
   *
   * deviceScaleFactor is fixed at browser-context creation and Playwright's own screenshot sizing
   * ignores a live CDP Emulation override (verified: it captures at the context's real DSF
   * regardless) — so the only way to get a genuinely downscaled thumb is a second, disposable
   * low-DSF context. That means one extra page load per screenshotted page, outside Crawlee's own
   * rps throttle — an accepted cost for a POC evidence feature, not a production crawl path.
   */
  /** Nudge reveal-on-scroll animations, then wait for the visible text to stop growing. */
  async function settleForThumb(p: Page): Promise<void> {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    const started = Date.now();
    let last = -1;
    let stable = 0;
    while (Date.now() - started < THUMB_SETTLE_MAX_MS) {
      await p.waitForTimeout(RENDER_SETTLE_TICK_MS);
      const size = await p.evaluate(() => document.body.innerText.length).catch(() => -1);
      if (size === last && size > 0 && ++stable >= 2) break;
      if (size !== last) stable = 0;
      last = size;
    }
    // Back to the top: the thumbnail should show the hero, not wherever the scroll ended up.
    await p.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await p.waitForTimeout(RENDER_SETTLE_TICK_MS);
  }

  async function captureScreenshot(
    page: Page,
    normalizedUrl: string,
    finalUrl: string,
  ): Promise<{ thumb: string; full: string; capturedAt: string } | null> {
    let thumbContext: BrowserContext | null = null;
    try {
      const full = await page.screenshot({
        type: "webp",
        quality: FULL_SCREENSHOT_QUALITY,
        fullPage: true,
        timeout: SCREENSHOT_TIMEOUT_MS,
      });

      const browser = page.context().browser();
      if (!browser) throw new Error("no Browser handle on this page's context");
      thumbContext = await browser.newContext({ viewport: THUMB_VIEWPORT, deviceScaleFactor: THUMB_DEVICE_SCALE_FACTOR });
      if (hasAuth) await thumbContext.setExtraHTTPHeaders(authHdrs);
      const thumbPage = await thumbContext.newPage();
      await thumbPage.goto(finalUrl, { waitUntil: "load", timeout: THUMB_LOAD_TIMEOUT_MS });
      // This is a FRESH load, so it has none of the settling the main pass already did. Screenshot
      // at "load" and a reveal-on-scroll site (GSAP/AOS) is still at opacity:0 — captured black.
      await settleForThumb(thumbPage);
      const thumb = await thumbPage.screenshot({ type: "webp", quality: THUMB_QUALITY, timeout: SCREENSHOT_TIMEOUT_MS });

      const paths = await store.saveScreenshots(normalizedUrl, thumb, full);
      return { ...paths, capturedAt: new Date().toISOString() };
    } catch (err) {
      console.warn(`[screenshot] capture failed for ${normalizedUrl}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      await thumbContext?.close().catch(() => {});
    }
  }

  /** Playwright natively tracks each redirect hop's real response — no extra fetch needed. */
  async function tracePlaywrightRedirects(finalRequest: PlaywrightRequest): Promise<Redirect[]> {
    const hops: { url: string; status: number | null }[] = [];
    let req: PlaywrightRequest | null = finalRequest;
    while (req) {
      const res = await req.response().catch(() => null);
      hops.unshift({ url: req.url(), status: res ? res.status() : null });
      req = req.redirectedFrom();
    }
    const chain: Redirect[] = [];
    for (let i = 0; i < hops.length - 1; i++) {
      chain.push({ from: hops[i]!.url, to: hops[i + 1]!.url, statusCode: hops[i]!.status ?? 0 });
    }
    return chain;
  }

  const crawleeConfig = new Configuration({ persistStorage: false });

  // Each pass needs its OWN queue: the default RequestQueue is shared across crawler instances
  // in-process, so an escalation URL already "handled" by the Cheerio pass would be silently
  // dropped by the Playwright pass (live bug: quotes-js jsRendered=0 with 1 candidate).
  let queueSeq = 0;
  async function freshQueue(): Promise<RequestQueue> {
    return RequestQueue.open(`${options.runId}-pass-${queueSeq++}`, { config: crawleeConfig });
  }

  /** Static-first pass. When toRenderCollector is given (render:"auto"), escalation candidates are
   * queued into it instead of fetched inline — the Playwright pass runs after this one finishes. */
  async function runCheerioPass(
    seed: SeedRequest[],
    budget: number,
    toRenderCollector: Map<string, EscalationCandidate> | null,
  ): Promise<void> {
    if (seed.length === 0 || budget <= 0) return;

    const crawler = new CheerioCrawler(
      {
        requestQueue: await freshQueue(),
        maxRequestsPerCrawl: budget,
        maxConcurrency: options.concurrency,
        maxRequestsPerMinute: Math.max(1, Math.round(options.maxRequestsPerSecond * 60)),
        requestHandlerTimeoutSecs: REQUEST_HANDLER_TIMEOUT_SECS,
        maxRequestRetries: MAX_REQUEST_RETRIES,
        errorHandler: async ({ request }, error) => backoffOnRateLimit(request, error as Error),
        // got-scraping spoofs a rotating Chrome UA by default, which would make page fetches lie
        // while robots/sitemap/asset requests told the truth — a robots rule naming us would then
        // only bind the honest half. One identity everywhere, or the rule is unenforceable.
        preNavigationHooks: [
          async (_ctx, gotOptions) => {
            gotOptions.useHeaderGenerator = false;
            gotOptions.headers = { ...gotOptions.headers, "user-agent": options.userAgent };
          },
        ],

        async requestHandler({ request, response, body }) {
          const normalizedUrl = request.uniqueKey;
          // got typing allows statusCode to be undefined mid-stream; 0 = "not observed" sentinel.
          const statusCode = response.statusCode ?? 0;
          const headers = pickHeaders(response.headers);
          const contentType = headers["content-type"] ?? "";
          noteAuthResponse(normalizedUrl, statusCode);

          if (contentType && !contentType.includes("html")) {
            await recordFailure({
              url: normalizedUrl,
              normalizedUrl,
              reason: "other",
              statusCode,
              attempts: request.retryCount + 1,
              error: `non-HTML content-type: ${contentType}`,
              depth: discovery.get(normalizedUrl)?.depth ?? null,
              parentUrl: discovery.get(normalizedUrl)?.parentUrl ?? null,
            });
            processedUrls.add(normalizedUrl);
            eventLog.emit({ kind: "request", url: normalizedUrl, statusCode, message: `${statusCode} ${normalizedUrl} (non-HTML: ${contentType})` });
            return;
          }

          const html = typeof body === "string" ? body : String(body);
          const httpVersion = response.httpVersion || null;
          const http = httpTimingsFromGot((response as { timings?: GotTimings }).timings);
          const extraction = extractPage(
            { html, url: normalizedUrl, finalUrl: request.loadedUrl ?? normalizedUrl, statusCode, headers, responseTimeMs: null, httpVersion },
            scope,
          );

          const pageDepth = discovery.get(normalizedUrl)?.depth ?? 0;

          // Hard 4xx/5xx pages don't get JS-detection escalation (re-rendering an error page can't
          // enrich content evidence), but the bounded screenshot policy still wants EVERY error
          // page captured — handled just below via a dedicated force, independent of statusCode<400.
          if (toRenderCollector && statusCode < 400) {
            const decision =
              options.render === "auto" && !calibration.isKilled ? needsJsRendering(html, extraction, scope) : null;
            // --screenshots needs a browser on every admitted page, not just JS-flagged ones — force
            // escalation for whatever the JS heuristic (if any) would have left on the static pass,
            // gated by the bounded screenshot budget (top-N by importance; never every page).
            const shot = options.screenshots
              ? screenshotBudget.decide({ normalizedUrl, depth: pageDepth, isError: false })
              : null;
            if (decision?.needed || shot?.capture) {
              const signals = decision?.needed ? decision.signals : [`screenshots:forced-${shot?.reason}`];
              toRenderCollector.set(normalizedUrl, {
                signals,
                staticHtml: html,
                staticExtraction: extraction,
                wantsScreenshot: shot?.capture ?? false,
                heuristicEscalation: decision?.needed === true,
              });
            }
          } else if (toRenderCollector && statusCode >= 400 && options.screenshots) {
            // Bounded policy: every error page gets a screenshot regardless of the JS-render
            // budget — isError always admits, so this never actually consults the topN counter.
            const shot = screenshotBudget.decide({ normalizedUrl, depth: pageDepth, isError: true });
            toRenderCollector.set(normalizedUrl, {
              signals: [`screenshots:forced-${shot.reason}`],
              staticHtml: html,
              staticExtraction: extraction,
              wantsScreenshot: shot.capture,
              heuristicEscalation: false,
            });
          }

          const redirectChain = await traceCheerioRedirects(normalizedUrl, response.redirectUrls ?? []);
          const page = buildCrawledPage({
            normalizedUrl,
            finalUrl: request.loadedUrl ?? null,
            statusCode,
            headers,
            performance: {
              responseTimeMs: http?.totalMs ?? response.timings?.phases?.total ?? null,
              http,
              navigation: null,
              labWebVitals: null,
              resources: null,
              browserWallMs: null,
            },
            extraction,
            redirectChain,
            renderedWith: "http",
            renderSignals: [],
          });

          await store.saveRaw(normalizedUrl, html);
          await store.savePage(page);
          processedUrls.add(normalizedUrl);
          eventLog.emit({ kind: "request", url: normalizedUrl, statusCode, message: `${statusCode} ${normalizedUrl}` });

          if (statusCode >= 400) {
            const failure: FailureRecord = {
              url: normalizedUrl,
              normalizedUrl,
              reason: statusCode >= 500 ? "http-5xx" : "http-4xx",
              statusCode,
              attempts: request.retryCount + 1,
              error: null,
              depth: discovery.get(normalizedUrl)?.depth ?? null,
              parentUrl: discovery.get(normalizedUrl)?.parentUrl ?? null,
            };
            // 403/429 are usually anti-bot answers, not content — retry in Chromium first. The
            // static body was still captured, so it's a real baseline for renderDivergence too.
            // Overwrites the error-screenshot candidate set above for this same URL, if any — that
            // decision (isError always admits) is trivially still true here, so it's just restated
            // rather than re-consulting the budget a second time (which would double-count stats).
            if (toRenderCollector && options.render === "auto" && (statusCode === 403 || statusCode === 429)) {
              heldFailures.set(normalizedUrl, failure);
              toRenderCollector.set(normalizedUrl, {
                signals: [`fetch-retry:http-${statusCode}`],
                staticHtml: html,
                staticExtraction: extraction,
                wantsScreenshot: options.screenshots === true,
                heuristicEscalation: false,
              });
            } else {
              await recordFailure(failure);
            }
          }

          const toEnqueue: SeedRequest[] = [];
          for (const link of extraction.links) {
            if (!link.targetNormalized) continue;
            const remapped = remapAliasedUrl(link.targetNormalized, scope);
            if (considerUrl(remapped, pageDepth + 1, request.loadedUrl ?? normalizedUrl, "html-link", true)) {
              toEnqueue.push(makeSeedRequest(remapped));
            }
          }
          if (toEnqueue.length > 0 && processedUrls.size < options.maxPages) {
            await crawler.addRequests(toEnqueue);
          }
        },

        failedRequestHandler({ request }, error) {
          const normalizedUrl = request.uniqueKey;
          const meta = discovery.get(normalizedUrl);
          const blockedStatus = blockedStatusFrom(error as Error);
          noteAuthResponse(normalizedUrl, blockedStatus);
          const failure: FailureRecord = {
            url: normalizedUrl,
            normalizedUrl,
            reason: classifyError(error as Error),
            statusCode: blockedStatus,
            attempts: request.retryCount + 1,
            error: error instanceof Error ? error.message : String(error),
            depth: meta?.depth ?? null,
            parentUrl: meta?.parentUrl ?? null,
          };
          // Timeouts/opaque network errors and 403/429 blocks may be transport-level anti-bot —
          // Chromium retry. DNS and redirect-loops won't improve in a browser; record those now.
          const retryable =
            failure.reason === "timeout" || failure.reason === "other" || blockedStatus === 403 || blockedStatus === 429;
          if (toRenderCollector && options.render === "auto" && retryable) {
            heldFailures.set(normalizedUrl, failure);
            // No response ever arrived (timeout/DNS/opaque network error) — nothing to diff against.
            // Still worth a screenshot if Chromium succeeds where the static fetch failed — this is
            // as much an "error page" for bounded-policy purposes as an observed 4xx/5xx status.
            toRenderCollector.set(normalizedUrl, {
              signals: [`fetch-retry:${blockedStatus !== null ? `http-${blockedStatus}` : failure.reason}`],
              staticHtml: null,
              staticExtraction: null,
              wantsScreenshot: options.screenshots === true,
              heuristicEscalation: false,
            });
          } else {
            void recordFailure(failure);
          }
          processedUrls.add(normalizedUrl);
          eventLog.emit({ kind: "request", url: normalizedUrl, statusCode: blockedStatus, message: `failed: ${normalizedUrl} (${failure.reason})` });
        },
      },
      crawleeConfig,
    );

    await runCrawlerWithAbort(crawler, seed, signal);
  }

  /** render:"auto" escalation pass — re-fetches only the URLs the Cheerio pass flagged, replaces
   * their stored record, and hands newly-found rendered-DOM links to the caller (not self-enqueued —
   * they re-enter the static crawler on the next loop iteration per the plan). */
  async function runPlaywrightEscalationPass(
    toRender: Map<string, EscalationCandidate>,
    budget: number,
    nextBatchCollector: SeedRequest[],
  ): Promise<void> {
    if (toRender.size === 0 || budget <= 0) return;
    const seed: SeedRequest[] = Array.from(toRender.keys()).map((url) => ({ url, uniqueKey: url }));
    await runPlaywrightPass(seed, budget, { selfEnqueue: false, nextBatchCollector, signalsForUrl: toRender });
  }

  /** render:"always" — every page is fetched via Playwright directly and self-enqueues its own
   * newly-found links (no alternating cheerio/playwright passes, there is no static pass at all). */
  async function runPlaywrightOnlyPass(seed: SeedRequest[], budget: number): Promise<void> {
    await runPlaywrightPass(seed, budget, { selfEnqueue: true });
  }

  async function runPlaywrightPass(
    seed: SeedRequest[],
    budget: number,
    opts: { selfEnqueue: boolean; nextBatchCollector?: SeedRequest[]; signalsForUrl?: Map<string, EscalationCandidate> },
  ): Promise<void> {
    if (seed.length === 0 || budget <= 0) return;

    const crawler = new PlaywrightCrawler(
      {
        requestQueue: await freshQueue(),
        maxRequestsPerCrawl: budget,
        maxConcurrency: options.concurrency,
        maxRequestsPerMinute: Math.max(1, Math.round(options.maxRequestsPerSecond * 60)),
        requestHandlerTimeoutSecs: 60,
        maxRequestRetries: MAX_REQUEST_RETRIES,
        errorHandler: async ({ request }, error) => backoffOnRateLimit(request, error as Error),
        // Same honesty rule as the Cheerio pass — Chromium's own UA would otherwise be sent.
        launchContext: { userAgent: options.userAgent },
        preNavigationHooks: [
          async ({ page, request }) => {
            request.userData.__navStart = Date.now();
            // Browser navigation ignores Request.headers entirely (confirmed against crawlee's
            // browser-crawler internals) — setExtraHTTPHeaders is the only way in for a real
            // page load. Used for Basic/Cookie/custom alike: a single header applies the same
            // regardless of which aliased host (scope.hostAliases) is being fetched, unlike
            // context.addCookies which is domain-scoped and would need per-alias duplication.
            if (hasAuth) await page.setExtraHTTPHeaders(authHdrs);
            await page.addInitScript(VITALS_INIT_SCRIPT);

            // Network-observed images: catches canvas/CSS/JS-injected assets that never touch a
            // DOM node an extractor could find. Crawlee gives each request its own fresh `page`
            // (verified: no explicit page.off cleanup exists anywhere else in this file either),
            // so one listener per request is correct, not a leak. Stashed on request.userData —
            // same pattern __navStart already uses — so the handler can read it after navigation.
            const networkImages: NetworkObservedAsset[] = [];
            request.userData.__networkImages = networkImages;
            page.on("response", (res) => {
              const ct = res.headers()["content-type"] ?? null;
              const isImage = res.request().resourceType() === "image" || (ct !== null && ct.toLowerCase().startsWith("image/"));
              if (!isImage) return;
              const cl = Number(res.headers()["content-length"]);
              // Never trust a non-2xx body as a byte size (the 404-9-byte trap) — pass the raw
              // content-length through regardless; mergeNetworkObservedImages nulls it out itself
              // for any non-2xx status, same guard probeImageAsset uses for the static-probe path.
              networkImages.push({
                url: res.url(),
                contentType: ct,
                status: res.status(),
                bytes: Number.isFinite(cl) && cl >= 0 ? cl : null,
              });
            });

            await page.route("**/*", (route) => {
              const type = route.request().resourceType();
              // A screenshot with no images/real fonts isn't a "real visual preview" — the whole
              // point of this flag — so --screenshots pays for both, same opt-in shape as loadFonts.
              if (type === "font") return options.loadFonts || options.screenshots ? route.continue() : route.abort();
              if (type === "image" || type === "media") return options.screenshots ? route.continue() : route.abort();
              return route.continue();
            });
          },
        ],

        async requestHandler({ request, page, response }) {
          const normalizedUrl = request.uniqueKey;
          // Adaptive settle (found via sagardalwala.me: intro-loader SPAs mount 6-10s AFTER
          // `load`; a fixed wait either burns time on SSR pages or misses slow mounts). Poll a
          // cheap DOM-size metric until it's stable for 2 ticks (4 when still empty — genuinely
          // blank pages exit early), capped by budget. Bottom-scroll first so
          // IntersectionObserver lazy-loaders fire; back to top before capture.
          await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
          // Vitals FIRST, before the settle scroll below — see the ordering constraint further down.
          const labWebVitals = await readLabWebVitals(page, blockedResourceTypes);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
          {
            const settleStart = Date.now();
            let last = -1;
            let stableTicks = 0;
            while (Date.now() - settleStart < RENDER_SETTLE_MAX_MS) {
              await page.waitForTimeout(RENDER_SETTLE_TICK_MS);
              const size = await page
                .evaluate(() => document.body.innerText.length + document.querySelectorAll("a,img").length * 10)
                .catch(() => -1);
              if (size === last) {
                stableTicks++;
                if (size > 0 && stableTicks >= 2) break;
                if (size === 0 && stableTicks >= 4) break;
              } else {
                stableTicks = 0;
                // Fresh content appeared — re-trigger lazy-loaders below the new fold.
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
              }
              last = size;
            }
          }
          await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
          // Ordering constraint honoured above: vitals -> scroll -> screenshot. Scrolling freezes
          // LCP, so vitals are read before the settle scroll and never after it.
          const navigation = await readNavigationTimings(page);
          const resources = await readResourceSummary(page, page.url(), blockedResourceTypes);

          // Computed-style background sweep: catches ::before/::after and external-stylesheet /
          // cascade-computed backgrounds the static regex parse (extractBackgroundImages) can't
          // see. Capped at CSS_SCAN_LIMIT nodes; truncation is surfaced (renderSignals below), not
          // hidden. A second, tiny evaluate gets the real node count — collectComputedBackgroundsInPage
          // itself only returns hits, not how much of the DOM it actually covered.
          const cssScanTotal = await page
            .evaluate(() => (document.body ? document.body.getElementsByTagName("*").length : 0))
            .catch(() => 0);
          const computedBgHits: ComputedBackgroundHit[] = await page
            .evaluate(collectComputedBackgroundsInPage, CSS_SCAN_LIMIT)
            .catch(() => []);

          // Decode settle BEFORE reading observed image sizes — see settleImageDecode's doc comment.
          await settleImageDecode(page);
          const observedImages = await readObservedImages(page);
          const networkImages = (request.userData.__networkImages as NetworkObservedAsset[] | undefined) ?? [];

          const candidate = opts.signalsForUrl?.get(normalizedUrl);
          const pageDepth = discovery.get(normalizedUrl)?.depth ?? 0;
          const preStatusCode = response ? response.status() : null;
          // render:"auto"/"never"+screenshots: the decision was already made once, up front, by the
          // Cheerio pass (candidate.wantsScreenshot) — never re-consult the budget here, or a page
          // could double-consume an importance slot. render:"always" has no candidate at all (no
          // escalation mechanism in that mode), so it's the one path that decides fresh, right here.
          const wantsScreenshot =
            candidate !== undefined
              ? candidate.wantsScreenshot
              : options.screenshots
                ? screenshotBudget.decide({ normalizedUrl, depth: pageDepth, isError: (preStatusCode ?? 0) >= 400 }).capture
                : false;
          const screenshot = wantsScreenshot ? await captureScreenshot(page, normalizedUrl, page.url()) : undefined;
          const html = await page.content();
          const finalUrl = page.url();
          const statusCode = preStatusCode;
          noteAuthResponse(normalizedUrl, statusCode);
          const headers = pickHeaders(response ? response.headers() : undefined);
          const browserWallMs = Date.now() - (typeof request.userData.__navStart === "number" ? request.userData.__navStart : Date.now());
          // The document request's REAL transport timing. Wall-clock (browserWallMs) includes JS
          // and the crawler's own settle waits — storing it as responseTimeMs is what produced a
          // sibling team's 20 false "slow page" findings, so the two never share a field.
          const timing = response ? await response.request().timing() : null;
          const http = timing ? httpTimingsFromPlaywright(timing) : null;
          // Best-effort: Playwright doesn't always expose this (e.g. cached/service-worker responses).
          const httpVersion = response ? await response.httpVersion().catch(() => null) : null;

          const extraction = extractPage(
            { html, url: normalizedUrl, finalUrl, statusCode: statusCode ?? 0, headers, responseTimeMs: http?.totalMs ?? null, httpVersion },
            scope,
          );
          applyObservedImageSizes(extraction, observedImages);

          // Fold in the computed-background sweep + network-observed images (both "not
          // alt-applicable", same bucket extractBackgroundImages already uses) and recompute the
          // summary so backgroundCount etc. reflect the merged set, not just the static regex pass.
          const newComputedBg = mergeComputedBackgroundImages(extraction.backgroundImages ?? [], computedBgHits);
          const newNetworkImages = mergeNetworkObservedImages(extraction.images, extraction.backgroundImages ?? [], networkImages);
          if (newComputedBg.length > 0 || newNetworkImages.length > 0) {
            extraction.backgroundImages = [...(extraction.backgroundImages ?? []), ...newComputedBg, ...newNetworkImages];
            extraction.imageSummary = summarizeImages(
              extraction.images,
              extraction.backgroundImages,
              extraction.imageSummary?.dataUriCount,
              extraction.imageSummary?.dataUriBytes,
            );
          }

          const redirectChain = response ? await tracePlaywrightRedirects(response.request()) : [];
          const signals = [...(candidate?.signals ?? ["forced:always"])];
          if (cssScanTotal > CSS_SCAN_LIMIT) {
            signals.push(`computed-bg-scan-truncated:${CSS_SCAN_LIMIT}/${cssScanTotal}`);
            console.warn(`[computed-bg] ${normalizedUrl}: scanned ${CSS_SCAN_LIMIT} of ${cssScanTotal} DOM nodes (truncated)`);
          }

          // Render keep/discard gain test (fixes the prior unconditional overwrite — a render that
          // adds nothing used to silently replace a good static capture). `extraction` above stays
          // the REAL rendered capture throughout — used for the image merges above and the new-link
          // discovery below — but `storedExtraction`/`storedHtml` (what actually gets persisted as
          // this page's canonical record) fall back to the static capture when the render didn't
          // clear evaluateRenderGain's bar. renderedWith stays "playwright" either way — it records
          // the PROCESS fact "a browser visited this page this pass", not which content won.
          let renderDivergence: RenderDivergence | null = null;
          let storedExtraction: ExtractionResult = extraction;
          let storedHtml: string = html;
          if (candidate?.staticHtml !== undefined && candidate.staticHtml !== null && candidate.staticExtraction) {
            await store.saveStaticRaw(normalizedUrl, candidate.staticHtml);
            renderDivergence = computeRenderDivergence(candidate.staticExtraction, extraction);
            const gain = evaluateRenderGain(candidate.staticExtraction, extraction);
            signals.push(...gain.reasons);
            if (gain.keep === "static") {
              storedExtraction = candidate.staticExtraction;
              storedHtml = candidate.staticHtml;
            }
            if (candidate.heuristicEscalation) recordCalibrationSample(gain.gained);
          }

          const page_ = buildCrawledPage({
            normalizedUrl,
            finalUrl,
            statusCode,
            headers,
            performance: { responseTimeMs: http?.totalMs ?? null, http, navigation, labWebVitals, resources, browserWallMs },
            extraction: storedExtraction,
            redirectChain,
            renderedWith: "playwright",
            renderSignals: signals,
            renderDivergence,
            screenshot,
          });

          await store.saveRaw(normalizedUrl, storedHtml);
          await store.savePage(page_);
          if (screenshot) {
            // Awaited (not fire-and-forget): maybeUploadScreenshot never throws/rejects internally,
            // so this can't fail the page — but awaiting means a crawl that ends right after this
            // page never silently drops an in-flight upload.
            const pageId = RunStore.pageIdFor(normalizedUrl);
            const runDir = store.runDir;
            await Promise.all([
              maybeUploadScreenshot(options.runId, pageId, "full", path.join(runDir, screenshot.full)),
              maybeUploadScreenshot(options.runId, pageId, "thumb", path.join(runDir, screenshot.thumb)),
            ]);
          }
          processedUrls.add(normalizedUrl);
          pwOutcomes.add(normalizedUrl);
          eventLog.emit({ kind: "browser-render", url: normalizedUrl, statusCode, message: `Rendered in a browser: ${finalUrl}` });
          eventLog.emit({ kind: "request", url: normalizedUrl, statusCode, message: `${statusCode ?? "?"} ${normalizedUrl}` });

          if (statusCode !== null && statusCode >= 400) {
            await recordFailure({
              url: normalizedUrl,
              normalizedUrl,
              reason: statusCode >= 500 ? "http-5xx" : "http-4xx",
              statusCode,
              attempts: request.retryCount + 1,
              error: null,
              depth: discovery.get(normalizedUrl)?.depth ?? null,
              parentUrl: discovery.get(normalizedUrl)?.parentUrl ?? null,
            });
          }

          const parentDepth = discovery.get(normalizedUrl)?.depth ?? 0;
          const found: SeedRequest[] = [];
          for (const link of extraction.links) {
            if (!link.targetNormalized) continue;
            const remapped = remapAliasedUrl(link.targetNormalized, scope);
            if (considerUrl(remapped, parentDepth + 1, finalUrl, "html-link", true)) {
              found.push({ url: remapped, uniqueKey: remapped });
            }
          }
          if (found.length > 0 && processedUrls.size < options.maxPages) {
            if (opts.selfEnqueue) {
              await crawler.addRequests(found);
            } else {
              opts.nextBatchCollector?.push(...found);
            }
          }
        },

        failedRequestHandler({ request }, error) {
          const normalizedUrl = request.uniqueKey;
          const meta = discovery.get(normalizedUrl);
          pwOutcomes.add(normalizedUrl);
          const blockedStatus = blockedStatusFrom(error as Error);
          noteAuthResponse(normalizedUrl, blockedStatus);
          void recordFailure({
            url: normalizedUrl,
            normalizedUrl,
            reason: classifyError(error as Error),
            statusCode: blockedStatus,
            attempts: request.retryCount + 1,
            error: error instanceof Error ? error.message : String(error),
            depth: meta?.depth ?? null,
            parentUrl: meta?.parentUrl ?? null,
          });
          processedUrls.add(normalizedUrl);
          eventLog.emit({ kind: "request", url: normalizedUrl, statusCode: blockedStatus, message: `failed: ${normalizedUrl}` });
        },
      },
      crawleeConfig,
    );

    await runCrawlerWithAbort(crawler, seed, signal);
  }

  if (options.render === "never" && !options.screenshots) {
    await runCheerioPass(initialSeed, options.maxPages, null);
  } else if (options.render === "always") {
    await runPlaywrightOnlyPass(initialSeed, options.maxPages);
  } else {
    // auto (default), or --render never + --screenshots forcing every page through escalation:
    // alternate static pass ↔ escalation pass until the frontier is empty or budget runs out.
    let pendingSeed = initialSeed;
    while (pendingSeed.length > 0 && processedUrls.size < options.maxPages && !isCancelled()) {
      const toRenderThisPass = new Map<string, EscalationCandidate>();
      await runCheerioPass(pendingSeed, options.maxPages - processedUrls.size, toRenderThisPass);
      pendingSeed = [];

      if (toRenderThisPass.size > 0 && !isCancelled()) {
        const nextBatch: SeedRequest[] = [];
        // Re-renders replace already-counted records, so they are budget-neutral — a static pass
        // that exhausts maxPages must not starve escalation (live bug: quotes-js jsRendered=0).
        // Only NEW links from the rendered DOM stay budget-gated via the loop condition.
        await runPlaywrightEscalationPass(toRenderThisPass, toRenderThisPass.size, nextBatch);
        pendingSeed = processedUrls.size < options.maxPages ? nextBatch : [];
      }
      await flushHeldFailures();
    }
    await flushHeldFailures();
  }

  await store.saveBlocked(Array.from(blocked));
  await store.saveSkipped(Array.from(skippedByUrl.values()));

  const pages = await store.loadAllPages();

  // Cancellation reaching this point means Crawlee has already stopped taking new requests (see
  // runCrawlerWithAbort); what remains is exactly the OUTBOUND-request-generating tail — asset
  // probes and the external-link pool — plus the aggregate report. Evidence for pages already
  // fetched is preserved (savePage happened per-request above); nothing further is fetched, and
  // no report is written, so a cancelled run never claims to be a finished one.
  if (isCancelled()) {
    eventLog.emit({
      kind: "crawl-cancelled",
      url: null,
      statusCode: null,
      message: `Crawl cancelled after ${pages.length} page(s) — skipping favicon/image probes, external-link checks, and the final report.`,
    });
    await eventLog.flush();
    throw new CrawlCancelledError(`crawl cancelled after ${pages.length} page(s)`);
  }

  const netFetch = makeAssetFetcher(options.userAgent, authHdrs);
  const touched = new Set<CrawledPage>();
  if (options.faviconProbe !== false) {
    const resolved = await resolveStoredFavicons(pages, netFetch, robots, touched, signal);
    console.log(`[favicons] probed ${resolved.probed} unique icon URL(s); effective resolved on ${resolved.resolvedPages}/${pages.length} page(s)`);
  }
  if (!isCancelled() && options.imageSizes !== false) {
    const cap = options.imageProbeCap ?? IMAGE_PROBE_CAP_DEFAULT;
    const stats = await probeStoredImageSizes(pages, netFetch, cap, options.maxRequestsPerSecond, touched, signal, eventLog);
    console.log(
      `[images] probed ${stats.probed}/${stats.unique} unique image URL(s) (cap ${cap}); ` +
        `${stats.sized} sized, ${stats.decoded} dimension-decoded, ${stats.failed} failed, ${stats.reusedFromBrowser} reused from the browser`,
    );
  }
  for (const page of touched) await store.savePage(page);

  // Same reasoning as the guard above: a cancellation that arrived DURING the favicon/image
  // probes must still stop before the external-link pool and before the report is written.
  if (isCancelled()) {
    eventLog.emit({
      kind: "crawl-cancelled",
      url: null,
      statusCode: null,
      message: `Crawl cancelled after ${pages.length} page(s) — skipping external-link checks and the final report.`,
    });
    await eventLog.flush();
    throw new CrawlCancelledError(`crawl cancelled after ${pages.length} page(s)`);
  }

  const finishedAt = new Date();
  const summary = buildSummary({
    pages,
    failures,
    blocked: Array.from(blocked),
    sitemap,
    discoveredCount,
    startedAt,
    finishedAt,
    options,
  });
  await store.saveReport(summary);

  if (checkExternal && !isCancelled()) {
    await runExternalLinkChecks(pages, store, options.userAgent, signal, eventLog);
  }

  eventLog.emit({
    kind: "crawl-finished",
    url: null,
    statusCode: null,
    message: `Crawl finished: ${summary.successful} page(s) successful, ${summary.failed} failed`,
  });
  await eventLog.flush();

  return summary;
}

/**
 * Ranged-GET fetcher for asset probing. Reads at most `rangeBytes` even when the server ignores
 * the Range header — otherwise one multi-MB image would be downloaded in full just to read its
 * 24-byte header.
 */
function makeAssetFetcher(userAgent: string, extraHeaders: Record<string, string>): ImageFetcher {
  return async (url, init) => {
    const headers: Record<string, string> = { "user-agent": userAgent, ...extraHeaders };
    const limit = init.rangeBytes ?? 0;
    if (init.method === "GET" && limit > 0) headers["range"] = `bytes=0-${limit - 1}`;

    const res = await fetch(url, {
      method: init.method,
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(IMAGE_PROBE_TIMEOUT_MS),
    });
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k.toLowerCase()] = v;
    });

    let bytes: Uint8Array | null = null;
    if (init.method === "GET" && res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < Math.max(limit, 1)) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
      }
      await reader.cancel().catch(() => {});
      bytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
    } else if (init.method === "GET") {
      bytes = new Uint8Array();
    }
    return { status: res.status, headers: outHeaders, bytes };
  };
}

/** Every image reference on a page that can carry a probed asset size. */
function sizeableImages(page: CrawledPage): ImageRecord[] {
  return [...(page.images ?? []), ...(page.backgroundImages ?? [])];
}

interface ImageProbeStats {
  unique: number;
  probed: number;
  sized: number;
  decoded: number;
  failed: number;
  reusedFromBrowser: number;
}

/**
 * Post-crawl sizing pass, mirroring runExternalLinkChecks: unique URLs only, hard-capped, and
 * rate-limited to the crawl's own rps. Images the browser already measured are never re-fetched,
 * and an image past the cap records why it has no size rather than getting a made-up one.
 */
async function probeStoredImageSizes(
  pages: CrawledPage[],
  fetchImpl: ImageFetcher,
  cap: number,
  rps: number,
  touched: Set<CrawledPage>,
  signal?: AbortSignal,
  eventLog?: EventLog,
): Promise<ImageProbeStats> {
  const stats: ImageProbeStats = { unique: 0, probed: 0, sized: 0, decoded: 0, failed: 0, reusedFromBrowser: 0 };
  const ordered = [...pages].sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));
  const cache = new Map<string, ImageAssetSize>();
  const delayMs = Math.max(0, Math.ceil(1000 / Math.max(rps, 0.1)));

  const needed: string[] = [];
  for (const page of ordered) {
    for (const img of sizeableImages(page)) {
      // The browser already paid for this one — a probe would buy nothing.
      if (img.asset && img.asset.bytes !== null && img.asset.naturalWidth !== null) {
        stats.reusedFromBrowser++;
        continue;
      }
      if (!needed.includes(img.url)) needed.push(img.url);
    }
  }
  stats.unique = needed.length;

  for (const url of needed.slice(0, cap)) {
    if (signal?.aborted) break; // cancellation reaching the asset probes — stop issuing new ones
    const result = await probeImageAsset(url, { fetchImpl, headerBytes: IMAGE_HEADER_BYTES });
    eventLog?.emit({ kind: "image-measuring", url, statusCode: result.status, message: `Measured image: ${url}` });
    cache.set(url, result);
    stats.probed++;
    if (result.bytes !== null) stats.sized++;
    else stats.failed++;
    if (result.naturalWidth !== null) stats.decoded++;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  for (const page of ordered) {
    let changed = false;
    for (const img of sizeableImages(page)) {
      if (img.asset && img.asset.bytes !== null && img.asset.naturalWidth !== null) continue;
      const probed = cache.get(img.url);
      if (probed && probed.status !== null && (probed.status < 200 || probed.status >= 300)) {
        // A definitive non-2xx overrides anything the browser thought it saw — a 404's error body
        // is not a byte size for this image.
        img.asset = probed;
      } else if (probed) {
        // Keep whatever the browser did observe; the probe only fills the gaps it left.
        img.asset = {
          ...probed,
          naturalWidth: probed.naturalWidth ?? img.asset?.naturalWidth ?? null,
          naturalHeight: probed.naturalHeight ?? img.asset?.naturalHeight ?? null,
          naturalSource: probed.naturalWidth !== null ? "header-decode" : (img.asset?.naturalSource ?? null),
          bytes: probed.bytes ?? img.asset?.bytes ?? null,
          byteSource: probed.bytes !== null ? probed.byteSource : (img.asset?.byteSource ?? null),
        };
        if (img.asset.bytes !== null) img.asset.sizeError = null;
      } else {
        img.asset = { ...(img.asset ?? emptyAssetSize("")), sizeError: `not-probed: cap of ${cap} unique image URLs reached` };
      }
      changed = true;
    }
    if (changed) touched.add(page);
  }

  return stats;
}

/**
 * `favicons.effective` is unanswerable from markup alone — last-declared wins WITH 404
 * fall-through — so without this pass it is null on every page ever stored. Results are cached
 * per icon URL, which on a normal site is a handful of requests for the whole crawl.
 */
async function resolveStoredFavicons(
  pages: CrawledPage[],
  fetchImpl: ImageFetcher,
  robots: RobotsInfo,
  touched: Set<CrawledPage>,
  signal?: AbortSignal,
): Promise<{ probed: number; resolvedPages: number }> {
  const cache = new Map<string, { status: number; bytes: Uint8Array }>();
  let resolvedPages = 0;

  const cachingFetch = async (url: string): Promise<{ status: number; bytes: Uint8Array }> => {
    const hit = cache.get(url);
    if (hit) return hit;
    if (cache.size >= FAVICON_PROBE_CAP) throw new Error("favicon probe cap reached");
    const res = await fetchImpl(url, { method: "GET", rangeBytes: FAVICON_READ_BYTES });
    const value = { status: res.status, bytes: res.bytes ?? new Uint8Array() };
    cache.set(url, value);
    return value;
  };

  // robots.txt was never successfully read → leave Googlebot access unknown rather than assume it.
  const robotsUsable = robots.parseStatus === "ok" || robots.parseStatus === "empty";
  const accessChecks = robotsUsable
    ? {
        checkGooglebotAccess: (u: string): boolean | null => robots.isAllowed(u, "Googlebot"),
        checkGooglebotImageAccess: (u: string): boolean | null => robots.isAllowed(u, "Googlebot-Image"),
      }
    : {};

  for (const page of pages) {
    if (signal?.aborted) break; // cancellation reaching the asset probes — stop issuing new ones
    const report = page.favicons;
    if (!report || report.candidates.length === 0) continue;
    const probed = await probeFaviconCandidates(report.candidates, {
      fetchImpl: cachingFetch,
      timeoutMs: FAVICON_PROBE_TIMEOUT_MS,
    });
    page.favicons = buildFaviconReport(
      probed.candidates,
      probed.effective,
      assessGoogleSerpEligibility(probed.candidates, { pageUrl: page.finalUrl ?? page.normalizedUrl, ...accessChecks }),
    );
    if (probed.effective !== null) resolvedPages++;
    touched.add(page);
  }

  return { probed: cache.size, resolvedPages };
}

/** `--check-external`: HEAD-check up to EXTERNAL_CHECK_CAP unique external link targets found in
 * the stored pages, sequentially at EXTERNAL_CHECK_RPS — politeness toward hosts we don't own. */
async function runExternalLinkChecks(
  pages: CrawledPage[],
  store: RunStore,
  userAgent: string,
  signal?: AbortSignal,
  eventLog?: EventLog,
): Promise<void> {
  const targets = new Map<string, string>();
  outer: for (const page of pages) {
    for (const link of page.links) {
      if (link.type !== "external") continue;
      if (targets.has(link.target)) continue;
      targets.set(link.target, page.finalUrl ?? page.normalizedUrl);
      if (targets.size >= EXTERNAL_CHECK_CAP) break outer;
    }
  }

  const results: ExternalCheckResult[] = [];
  const delayMs = Math.ceil(1000 / EXTERNAL_CHECK_RPS);
  for (const [url, checkedFrom] of targets) {
    if (signal?.aborted) break; // cancellation reaching the external-link pool — stop issuing new checks
    const result = await headCheckExternal(url, checkedFrom, userAgent);
    eventLog?.emit({ kind: "outbound-link-check", url, statusCode: result.statusCode, message: `Checked outbound link: ${url}` });
    results.push(result);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  await store.saveExternalChecks(results);
}

async function headCheckExternal(url: string, checkedFrom: string, userAgent: string): Promise<ExternalCheckResult> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(EXTERNAL_CHECK_TIMEOUT_MS),
    });
    return { url, statusCode: res.status, error: null, checkedFrom };
  } catch (err) {
    return { url, statusCode: null, error: err instanceof Error ? err.message : String(err), checkedFrom };
  }
}

/** Shared contract for all slices (spec.md foundation). Changes go through Main Claude only. */

export interface CrawlScope {
  /** Registrable domain (eTLD+1) via tldts, e.g. "example.com". www/non-www both in scope. */
  registrableDomain: string;
  /** For hosts without a registrable domain (localhost, IPs): exact hostname[:port] match. */
  fallbackHost: string | null;
  /**
   * Extra hostnames treated as this site (staging-domain crawls, e.g. the target-site fixtures'
   * "summittrailgear.example" while serving on localhost:3105). URLs on these hosts are in-scope
   * and remapped onto seedOrigin for queue identity; evidence keeps the authored URL.
   */
  hostAliases: string[];
  seedOrigin: string;
  seedUrl: string;
}

/**
 * Auth step 2 — drive a real browser through a login form, for sites where pasting a session
 * cookie isn't practical. The session then belongs to the Playwright context for the whole crawl.
 */
export interface FormLoginConfig {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  username: string;
  password: string;
  /** Must be present after submit for the login to count as successful; null = skip the check. */
  successSelector: string | null;
}

/** Credentials for crawling protected routes. Never persisted into run evidence. */
export interface CrawlAuth {
  /** Browser-driven form login (step 2). Mutually usable with the header forms below. */
  formLogin?: FormLoginConfig | null;
  /** HTTP Basic — becomes an Authorization header on every request (staging sites). */
  basic: { username: string; password: string } | null;
  /** Raw Cookie header value, e.g. "session=abc; csrf=xyz" (log in manually, paste the cookie). */
  cookie: string | null;
  /** Extra request headers — API tokens, WAF bypass tokens. */
  headers: Record<string, string>;
}

/**
 * Guard rails for authenticated crawls. A logged-in crawler follows every link it finds, which
 * inside a member area includes /logout (kills its own session) and destructive GET endpoints.
 * Defaults are asymmetric on purpose: ON when credentials are present, OFF otherwise — on an
 * anonymous crawl "/how-to-cancel-a-subscription" is just an article, and skipping it would
 * silently cost coverage.
 */
export interface CrawlSafety {
  /** Never fetch URLs whose path matches these (case-insensitive substrings). */
  excludePatterns: string[];
  /** Skip logout-ish paths so the crawler can't end its own session mid-run. */
  denyLogout: boolean;
  /** Skip destructive-looking GET endpoints (delete/remove/cancel/…). */
  denyDestructive: boolean;
}

/** A URL deliberately not fetched — recorded as evidence, never silently dropped. */
export interface SkippedUrlRecord {
  url: string;
  reason: "logout" | "destructive" | "user-excluded";
  matchedPattern: string;
  /** Page the link was found on. */
  foundOn: string | null;
}

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  concurrency: number;
  respectRobots: boolean;
  render: "auto" | "never" | "always";
  outDir: string;
  runId: string;
  userAgent: string;
  /** Max requests/sec against the target host (politeness). */
  maxRequestsPerSecond: number;
  /** --alias host[,host...] — see CrawlScope.hostAliases. */
  hostAliases: string[];
  /** --max-depth N — max link-hops from the start URL; null = unlimited. */
  maxDepth: number | null;
  /** Credentials for protected routes; null = anonymous crawl. */
  auth?: CrawlAuth | null;
  /** Guard rails; defaults derived from whether auth is present (see CrawlSafety). */
  safety?: CrawlSafety;
  /** Let fonts load in the browser pass. Off by default — fonts are the single heaviest
   * blocked resource class, so only pay for them when font extraction actually runs. */
  loadFonts?: boolean;
  /** Capture a thumb+full screenshot per page. Off by default; forces pages that would
   * otherwise be static-only onto the Playwright pass, since a screenshot needs a browser. */
  screenshots?: boolean;
  /** Probe image byte size + real header dimensions after the crawl. On by default; bounded by
   * imageProbeCap unique URLs and rate-limited to maxRequestsPerSecond (same host we just crawled). */
  imageSizes?: boolean;
  imageProbeCap?: number;
  /** Fetch every declared favicon candidate so `favicons.effective` can be resolved at all —
   * markup alone cannot answer it (last-declared wins, with 404 fall-through). On by default;
   * results are cached per URL across the whole crawl, so it costs a handful of requests. */
  faviconProbe?: boolean;
}

export interface Redirect {
  from: string;
  to: string;
  statusCode: number;
}

export interface LinkRecord {
  /** Final URL of the page the link was found on. */
  source: string;
  /** Resolved absolute href AS AUTHORED (preserves http://, www-mix, etc. — evidence). */
  target: string;
  targetNormalized: string | null;
  anchor: string;
  type: "internal" | "external";
  rel: string | null;
  nofollow: boolean;
  sponsored: boolean;
  ugc: boolean;
  targetAttr: string | null;
}

/** Where an image reference was found. Only "img"/"input-image" can carry an alt attribute.
 * "network" = observed as a browser response with no matching DOM node (canvas/JS-drawn assets). */
export type ImageKind = "img" | "input-image" | "picture-source" | "background" | "svg-use" | "network";

/** One srcset candidate. `width` and `density` are mutually exclusive per the HTML spec; a
 * candidate with no descriptor at all is density 1. */
export interface SrcSetCandidate {
  url: string;
  width: number | null;
  density: number | null;
  /** The descriptor exactly as authored ("640w", "2x", "" when absent) — evidence. */
  raw: string;
}

/** A <picture> alternative. Sources never carry alt: the <img> inside the picture does. */
export interface PictureSourceRecord {
  srcset: SrcSetCandidate[];
  /** <source src> is invalid inside <picture> but common in the wild — kept as evidence. */
  src: string | null;
  media: string | null;
  type: string | null;
  sizes: string | null;
}

/**
 * Real asset weight + real pixel dimensions. Every field is null until something actually
 * observed it; `sizeError` carries the reason instead of a fabricated byte count.
 * Only an image record's primary `url` is probed — srcset candidate URLs are recorded but never
 * fetched, since probing every candidate multiplies request cost by the candidate count.
 */
export interface ImageAssetSize {
  bytes: number | null;
  byteSource: "content-length" | "content-range" | "browser-transfer" | null;
  /** Decoded from the file header (or the browser's naturalWidth) — declared sizes routinely lie. */
  naturalWidth: number | null;
  naturalHeight: number | null;
  naturalSource: "header-decode" | "browser" | null;
  /** HTTP status of the probe; null when the probe never reached a response. */
  status: number | null;
  /** Non-null whenever `bytes` is null, naming why (404, cap reached, timeout, …). */
  sizeError: string | null;
}

export interface ImageRecord {
  url: string;
  /** null = alt attribute missing entirely; "" = present but empty. The distinction is evidence. */
  alt: string | null;
  width: number | null;
  height: number | null;
  /** Lowercased extension-derived format ("jpg", "png", "bmp", "webp", ...), null if none. */
  format: string | null;

  /* ── v4 (extraction-correctness wave). Optional: pre-v4 runs lack them entirely. ── */
  kind?: ImageKind;
  /** Attribute the primary URL came from ("src", "data-src", "srcset", "style", "xlink:href"). */
  source?: string;
  srcset?: SrcSetCandidate[];
  sizes?: string | null;
  loading?: string | null;
  decoding?: string | null;
  fetchPriority?: string | null;
  /** <picture> alternatives for this <img>; [] when it has no <picture> parent. */
  pictureSources?: PictureSourceRecord[];
  /** alt="" / role=presentation|none / aria-hidden=true — a declared-decorative image, so its
   * empty alt is intentional and must not be reported as a missing one. */
  decorative?: boolean;
  /** Background kind only: the CSS property and (for <style> blocks) the selector it came from. */
  cssProperty?: string;
  cssSelector?: string | null;
  /** Computed-style sweep only: "::before"/"::after" when the image came from a pseudo-element,
   * null for the element itself. Absent when the record wasn't found via the computed sweep. */
  pseudoElement?: "::before" | "::after" | null;
  /** network kind only: Content-Type of the browser response, when observed. */
  networkContentType?: string | null;
  /** Layout box the browser gave the image, CSS px. Only set when a rendered pass measured it. */
  renderedWidth?: number | null;
  renderedHeight?: number | null;
  /** The candidate the browser actually loaded. Differs from `url` whenever srcset or a
   * <picture> source won, which is why asset sizes are not adopted from the browser in that case. */
  currentSrc?: string | null;
  asset?: ImageAssetSize;
}

/**
 * Counts a rule can trust without re-deriving them. `altApplicable` — NOT images.length — is the
 * missing-alt denominator: backgrounds and <picture><source> have no alt attribute to be missing.
 */
export interface ImageSummary {
  total: number;
  altApplicable: number;
  missingAlt: number;
  emptyAlt: number;
  decorative: number;
  withSrcset: number;
  lazyLoaded: number;
  eagerLoaded: number;
  pictureCount: number;
  backgroundCount: number;
  /** data: URIs are inlined bytes, not fetchable assets — counted here, kept out of images[]. */
  dataUriCount: number;
  dataUriBytes: number;
}

/**
 * One `url(...)` found by a browser-side computed-style sweep (getComputedStyle over every
 * element + its ::before/::after), not by the regex-based inline/<style> parse in images.ts —
 * catches external-stylesheet rules and cascade-computed values the static parse cannot see.
 */
export interface ComputedBackgroundHit {
  url: string;
  property: "background-image" | "border-image-source" | "mask-image" | "list-style-image";
  pseudo: "::before" | "::after" | null;
  /** Best-effort tag/id/class locator — getComputedStyle gives no CSS selector to report. */
  locator: string | null;
}

/**
 * One browser response observed during a Playwright pass, keyed by response URL. Exists to catch
 * canvas/CSS/JS-injected image requests that never touch a DOM node an extractor could find.
 */
export interface NetworkObservedAsset {
  url: string;
  contentType: string | null;
  status: number;
  /** From Content-Length; only trustworthy when status is 2xx (a 404 body is not a byte size). */
  bytes: number | null;
}

export interface VideoRecord {
  /** Resolved absolute media/embed URL. */
  url: string;
  kind: "file" | "youtube" | "vimeo" | "iframe";
  /** Resolved poster attr when present. */
  poster: string | null;
  /** MIME type attr when present (file kind). */
  mimeType: string | null;
  /** Provider video id for youtube/vimeo, else null. */
  providerId: string | null;
}

/** v2 (POC-2 wave): raw og / twitter meta values (property → content) in document order. */
export interface SocialTags {
  og: Record<string, string>;
  twitter: Record<string, string>;
}

export interface HreflangEntry {
  lang: string;
  /** Resolved absolute. */
  href: string;
}

export interface MetaRefresh {
  delaySeconds: number | null;
  url: string | null;
  raw: string;
}

/** SERP pixel widths are ESTIMATES from a char-width table, not a browser measurement. */
export interface PixelWidths {
  titlePx: number | null;
  metaDescriptionPx: number | null;
}

export interface PageStats {
  htmlBytes: number;
  /** visible text bytes / htmlBytes, 0..1. */
  textRatio: number;
  domNodes: number;
  contentEncoding: string | null;
  httpVersion: string | null;
}

export interface ScriptResourceRecord {
  /** null = inline script. */
  url: string | null;
  async: boolean;
  defer: boolean;
  /** type="module" — deferred by spec, so never render-blocking regardless of the attrs above. */
  module: boolean;
  inHead: boolean;
  /** Byte length of the inline body (UTF-8); null for external scripts. */
  inlineBytes: number | null;
  /** External script with no async/defer/module sitting in <head> — parser-blocking by markup alone. */
  renderBlocking: boolean;
}

export interface StylesheetResourceRecord {
  url: string;
  media: string | null;
  inHead: boolean;
  /** true unless `media` is print/speech-only — a coarse static heuristic, not a cascade evaluation. */
  renderBlocking: boolean;
}

export interface PreloadResourceRecord {
  url: string;
  as: string | null;
  type: string | null;
  crossorigin: string | null;
}

/** Static (markup-only) resource inventory — no browser required, so it's populated on every page. */
export interface ResourceHints {
  scripts: ScriptResourceRecord[];
  stylesheets: StylesheetResourceRecord[];
  preloads: PreloadResourceRecord[];
  inlineScriptBytesTotal: number;
  renderBlockingScriptCount: number;
  renderBlockingStylesheetCount: number;
}

/** Raw-vs-rendered divergence when a page was escalated to Chromium. */
export interface RenderDivergence {
  titleChanged: boolean;
  metaDescriptionChanged: boolean;
  canonicalChanged: boolean;
  noindexChanged: boolean;
  linkCountDelta: number;
  wordCountDelta: number;
  /** Static HTML kept as raw/<pageId>.static.html. */
  staticRawSaved: boolean;
  /* The booleans above cannot tell a JS-deindexed page from a JS "fix" Google never renders —
   * opposite directions, opposite fixes. Optional: older runs only stored the booleans. */
  staticCanonical?: string | null;
  renderedCanonical?: string | null;
  staticNoindex?: boolean;
  renderedNoindex?: boolean;
}

/** mailto:/tel: links — excluded from links[] by design, captured here as contact evidence. */
export interface ContactRecord {
  kind: "email" | "phone";
  /** The address/number with the scheme + query stripped, e.g. "hi@example.com". */
  value: string;
  /** href as authored. */
  href: string;
  anchor: string;
}

export interface ExternalCheckResult {
  url: string;
  statusCode: number | null;
  error: string | null;
  /** Page the link was found on (finalUrl). */
  checkedFrom: string;
}

export interface StructuredDataRecord {
  type: "application/ld+json";
  raw: string;
  parsed: unknown | null;
  parseError: string | null;
}

export type StructuredDataFormat = "json-ld" | "microdata" | "rdfa";

/**
 * "no-profile" = a real schema.org type we deliberately don't gate (no Google rich result);
 * "unknown-type" = a @type that isn't schema.org at all (typo/invented) — a different finding.
 */
export type StructuredDataItemStatus = "validated" | "no-profile" | "unknown-type" | "missing-type" | "reference";

export interface StructuredDataValidation {
  /** Profile actually applied after subtype aliasing (NewsArticle -> Article), null when none. */
  profile: string | null;
  status: StructuredDataItemStatus;
  /** Google rich-result requirements not satisfied. An "a or b" group is one entry, joined by " or ". */
  missingRequired: string[];
  missingRecommended: string[];
}

/** One schema.org node, normalized to a JSON-LD-shaped object whatever syntax it was written in. */
export interface StructuredDataItem {
  format: StructuredDataFormat;
  /** schema.org type names with any URL/prefix stripped. Empty when the node declared none. */
  types: string[];
  /** Where the node sits: "[0].@graph[2].author", "microdata[1].offers", "rdfa[0]". */
  path: string;
  /** Index into structuredData[] for JSON-LD; null for DOM-sourced formats. */
  blockIndex: number | null;
  node: Record<string, unknown>;
  validation: StructuredDataValidation;
}

export interface StructuredDataError {
  kind: "malformed-json" | "empty-block" | "missing-context" | "invalid-context" | "missing-type" | "unknown-type";
  format: StructuredDataFormat;
  blockIndex: number | null;
  message: string;
  value: string | null;
}

export interface StructuredDataCounts {
  jsonLdBlocks: number;
  jsonLdParseErrors: number;
  items: number;
  jsonLdItems: number;
  microdataItems: number;
  rdfaItems: number;
  validatedItems: number;
  itemsMissingRequired: number;
  unknownTypes: number;
}

/** All three syntaxes + Google rich-result validation. structuredData[] stays JSON-LD-only. */
export interface StructuredDataReport {
  items: StructuredDataItem[];
  counts: StructuredDataCounts;
  errors: StructuredDataError[];
  /** Distinct types across every format, sorted. */
  types: string[];
  /** True when the per-page item cap was reached — items[] may be incomplete. */
  truncated: boolean;
}

export interface RobotsMeta {
  /** Raw values from <meta name="robots"> (+ googlebot variants) AND X-Robots-Tag headers. */
  meta: string[];
  noindex: boolean;
  nofollow: boolean;
}

export interface PageContent {
  text: string;
  wordCount: number;
  /** sha256 hex of whitespace-normalized lowercased text — near-duplicate evidence. */
  contentHash: string;
  /** How the content area was located — provenance, so a rule can tell "no main content"
   * from "we fell back to body". v3-optional. */
  contentAreaMethod?: "main" | "article" | "role-main" | "body-minus-chrome";
  /** Words inside [aria-hidden="true"]. Counted in `text` (Google indexes them) but tracked
   * separately because they're hidden from assistive tech — an a11y finding, not an SEO one. */
  ariaHiddenWordCount?: number;
  readability?: ReadabilityReport;
  keywordDensity?: KeywordDensityReport;
}

/** Flesch Reading Ease + Flesch-Kincaid Grade Level — the only content-quality measure in this
 * dataset beyond raw word count. Null fields mean too little text to score, not a zero score. */
export interface ReadabilityReport {
  fleschReadingEase: number | null;
  fleschKincaidGrade: number | null;
  sentences: number;
  syllables: number;
  averageWordsPerSentence: number;
  /** Plain-language reading of fleschReadingEase, e.g. "plain English — 8th to 9th grade". */
  band: string;
}

export interface KeywordCount {
  term: string;
  count: number;
  /** Share of all non-stopword terms, as a percentage. */
  density: number;
}

export interface KeywordDensityReport {
  totalTerms: number;
  oneWord: KeywordCount[];
  twoWord: KeywordCount[];
}

export interface CrawlMeta {
  depth: number;
  parentUrl: string | null;
  /** "seed" | "html-link" | "sitemap" — merged, deduped, insertion order. */
  discoverySources: string[];
}

/** What the fetch layer hands to extraction — pure data, no crawler types. */
export interface FetchArtifact {
  html: string;
  /** Normalized queue identity of the request. */
  url: string;
  /** URL that actually served the content (after redirects). */
  finalUrl: string;
  statusCode: number;
  /** Lowercased header names. Kept subset incl. content-encoding + security headers (v2). */
  headers: Record<string, string>;
  responseTimeMs: number | null;
  /** "1.1" | "2.0" etc. when observable; null otherwise (v2). */
  httpVersion?: string | null;
}

/* ── v3 extraction contract (extraction-completeness R&D §6). All additive + optional. ── */

/** Where the <head> effectively ended. Per HTML tree construction ANY invalid element
 * (div, img, noscript>img …) implicitly closes head, and Google "stops reading any further
 * elements" — so a canonical after that point is present in source but invisible to Google. */
export interface HeadBoundary {
  elementCount: number;
  /** Tag name of the element that implicitly closed head; null when head closed properly. */
  closedBy: string | null;
  closedAtOffset: number | null;
  /** Signals found after the effective head end. `honoured` is PER SIGNAL — Google ignores a
   * body canonical but explicitly respects a body meta robots. Never collapse to one verdict. */
  stranded: { signal: string; tag: string; honoured: boolean }[];
}

export interface CharsetInfo {
  value: string | null;
  source: "bom" | "header" | "meta" | null;
  /** Byte offset of <meta charset>. Must serialize within the first 1024 bytes to take effect. */
  metaOffset: number | null;
  effective: boolean;
}

/** <base href> silently rewrites every relative canonical/hreflang/icon/preload on the page.
 * All but the first are ignored per spec; OG tags do not respect it at all. */
export interface BaseHrefInfo {
  href: string | null;
  count: number;
}

export interface MetaTagRecord {
  /** twitter:* is valid on BOTH name and property — key on the token, record the attribute. */
  attr: "name" | "property" | "http-equiv" | "itemprop" | "charset";
  key: string;
  value: string;
  /** Document order. Load-bearing: OG structured sub-properties bind to the preceding root. */
  index: number;
  inHead: boolean;
}

export interface OgImageRecord {
  url: string;
  secureUrl?: string;
  type?: string;
  width?: number;
  height?: number;
  alt?: string;
}

/** Ordered-stream model. A flat {property → value} map is incorrect by construction for OG. */
export interface HeadMetaReport {
  tags: MetaTagRecord[];
  /** OG conflict rule: FIRST occurrence wins. */
  og: Record<string, string>;
  /** Twitter conflict rule: LAST occurrence wins (X's documented behaviour — inverted from OG). */
  twitter: Record<string, string>;
  ogImages: OgImageRecord[];
  viewport: string | null;
  /** viewport with user-scalable=no / maximum-scale<2 — a WCAG 1.4.4 failure. */
  viewportBlocksZoom: boolean;
  themeColor: string | null;
  colorScheme: string | null;
  referrer: string | null;
  generator: string | null;
  /** Site-verification tokens keyed by provider (google, bing, pinterest, facebook …). */
  verification: Record<string, string>;
}

export interface IconRecord {
  rel: string;
  href: string;
  declaredSizes: string | null;
  type: string | null;
  index: number;
  source: "link" | "manifest" | "meta" | "implicit";
  /** Populated only when probed: HTTP status and the ACTUAL decoded pixel size. */
  status?: number | null;
  actualSize?: { width: number; height: number } | null;
}

export interface FaviconReport {
  candidates: IconRecord[];
  /** Spec rule: the LAST equally-appropriate icon declared in tree order wins, and a 404
   * candidate falls through to the next — so every candidate must be probed, not just one. */
  effective: string | null;
  /** Google SERP eligibility is a separate question from browser-tab display. */
  googleSerpEligible: boolean | null;
  googleSerpBlockers: string[];
}

/* ── v4 performance contract. HTTP timing and browser wall-clock are deliberately separate
 * fields: conflating them produced 20 false "slow page" findings in a sibling team's audit. ── */

/** Phases of the HTTP request for the page document itself — transport only, no rendering. */
export interface HttpTimings {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  /** Request start → first response byte. This is the only field that means TTFB. */
  ttfbMs: number | null;
  /** First response byte → last response byte. */
  downloadMs: number | null;
  totalMs: number | null;
  source: "http-transport" | "browser-request-timing";
}

/** The browser's own navigation timeline. Wall-clock and includes script execution — never
 * comparable to HttpTimings and never a substitute for it. */
export interface NavigationTimings {
  ttfbMs: number | null;
  domInteractiveMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
  responseEndMs: number | null;
  transferSizeBytes: number | null;
  encodedBodySizeBytes: number | null;
  decodedBodySizeBytes: number | null;
}

/**
 * LAB Core Web Vitals — one cold load in our own headless Chromium, NOT Google field/CrUX data
 * and not comparable to a Search Console score. Read `note` and `notMeasured` before quoting any
 * number here: observation stops when the crawler scrolls, so LCP is a lower bound.
 */
export interface LabWebVitals {
  lcpMs: number | null;
  /** Tag/id of the element the browser attributed LCP to, and its URL when it was an image. */
  lcpElement: string | null;
  lcpUrl: string | null;
  cls: number | null;
  fcpMs: number | null;
  /** Long tasks (>50ms) observed, and the blocking time above 50ms summed across them. */
  longTasks: number | null;
  totalBlockingTimeMs: number | null;
  /** ms after navigation start at which measurement stopped. */
  observationEndedAtMs: number | null;
  note: string;
  /** Metrics this pass cannot produce at all — never report these as zero or as passing. */
  notMeasured: string[];
}

/** Resource counts and page weight from the browser's resource timeline. */
export interface ResourceSummary {
  total: number;
  byType: Record<string, number>;
  transferBytesByType: Record<string, number>;
  totalTransferBytes: number | null;
  totalDecodedBytes: number | null;
  /** Entries reporting transferSize 0 (cache hit or opaque cross-origin): the byte totals are a
   * floor, not an exact page weight, whenever this is above zero. */
  zeroTransferCount: number;
  /** Resource types the crawler ABORTED before they loaded. Page weight excludes them entirely,
   * so it is not the weight a real visitor downloads. Empty when nothing was blocked. */
  blockedTypes: string[];
  thirdPartyRequests: number;
  thirdPartyTransferBytes: number | null;
}

export interface PagePerformance {
  /** HTTP-transport total for the document. Never browser wall-clock — see browserWallMs. */
  responseTimeMs: number | null;
  http?: HttpTimings | null;
  /** Playwright pass only; null on the static pass. */
  navigation?: NavigationTimings | null;
  labWebVitals?: LabWebVitals | null;
  resources?: ResourceSummary | null;
  /** Crawler-measured wall-clock of the whole browser visit, including settle waits. Useful for
   * crawl-cost accounting; useless as a page-speed metric — do not threshold on it. */
  browserWallMs?: number | null;
}

export interface HeadingRecord {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** Document order ACROSS levels — hierarchy checks need sequence, not per-level buckets. */
  index: number;
  inMain: boolean;
}

export interface DocumentStructure {
  headings: HeadingRecord[];
  paragraphs: number;
  lists: { ordered: number; unordered: number; definition: number };
  /** th/caption presence separates a real data table from a layout table. */
  tables: { total: number; withTh: number; withCaption: number };
  codeBlocks: number;
  blockquotes: number;
  /** Landmark elements present: main, article, nav, aside, header, footer, section[aria-label]. */
  landmarks: string[];
}

export interface FontFaceRecord {
  family: string;
  source: string;
  origin: "same-origin" | "third-party";
  host: string | null;
  /** font-display graded by VALUE — Lighthouse's own audit wrongly passes `block`. */
  display: string | null;
  preloaded: boolean;
  /** preload as=font without crossorigin ⇒ guaranteed double download. Zero false positives. */
  preloadMissingCrossorigin: boolean;
}

export interface FontReport {
  faces: FontFaceRecord[];
  /** Distinct third-party hosts serving fonts — GDPR exposure, not just a perf finding. */
  thirdPartyHosts: string[];
  /** Families actually used by rendered text, when the browser pass observed them. */
  usedFamilies?: string[];
}

export interface ExtractionResult {
  /** First instance (back-compat); ALL instances in titles[]. */
  title: string | null;
  metaDescription: string | null;
  /** Every <title> in document order (multiple = an SEO issue). v2-optional, see below. */
  titles?: string[];
  /** Every meta description in document order. v2-optional, see below. */
  metaDescriptions?: string[];
  /** Resolved absolute; null when no canonical present. */
  canonical: string | null;
  robots: RobotsMeta;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  links: LinkRecord[];
  images: ImageRecord[];
  videos: VideoRecord[];
  structuredData: StructuredDataRecord[];
  content: PageContent;
  /**
   * v2 fields (POC-2 wave). OPTIONAL because ~50 pre-v2 stored runs lack them — readers MUST
   * treat `undefined` as "not captured" (rule skips as data-unavailable; UI shows honest empty
   * state) and never conflate it with an empty capture. New writes always populate them.
   */
  social?: SocialTags;
  contacts?: ContactRecord[];
  hreflang?: HreflangEntry[];
  metaRefresh?: MetaRefresh | null;
  metaKeywords?: string | null;
  pixelWidths?: PixelWidths;
  pageStats?: PageStats;
  /** v3 fields (extraction-completeness wave). Same "undefined ≠ empty" contract as v2 above. */
  headBoundary?: HeadBoundary;
  charset?: CharsetInfo;
  baseHref?: BaseHrefInfo;
  headMeta?: HeadMetaReport;
  favicons?: FaviconReport;
  structure?: DocumentStructure;
  fonts?: FontReport;
  /** v4 fields. CSS/svg-use image references are kept OUT of images[] on purpose: they have no
   * alt attribute, so folding them in would inflate every missing-alt denominator. */
  backgroundImages?: ImageRecord[];
  imageSummary?: ImageSummary;
  /** Microdata + RDFa + validated JSON-LD nodes. Optional: pre-wave runs on disk have no report. */
  structuredDataReport?: StructuredDataReport;
  /** Static script/stylesheet/preload inventory — markup-only, no browser required. */
  resourceHints?: ResourceHints;
}

export interface CrawledPage extends ExtractionResult {
  runId: string;
  url: string;
  normalizedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  redirectChain: Redirect[];
  headers: Record<string, string>;
  performance: PagePerformance;
  renderedWith: "http" | "playwright";
  /** Why JS escalation fired; [] when renderedWith === "http". */
  renderSignals: string[];
  /** Raw-vs-rendered diff; null when never escalated; undefined on pre-v2 records. */
  renderDivergence?: RenderDivergence | null;
  /** --screenshots evidence. undefined = flag off (or pre-screenshot run); null = flag on but
   * capture failed for this page; object = success, paths relative to the run dir. */
  screenshot?: { thumb: string; full: string; capturedAt: string } | null;
  fetchedAt: string;
  crawl: CrawlMeta;
}

export type FailureClass =
  | "timeout"
  | "dns"
  | "http-4xx"
  | "http-5xx"
  | "redirect-loop"
  | "parse-error"
  | "blocked-robots"
  | "other";

export interface FailureRecord {
  url: string;
  normalizedUrl: string | null;
  reason: FailureClass;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  depth: number | null;
  parentUrl: string | null;
}

/**
 * Which named AI-crawler agent verdicts exist. Four, not three: `partly blocked` is distinct from
 * `blocked` because collapsing "some paths disallowed" into a boolean misreports the site, and
 * `ignores robots.txt` is distinct from both because a handful of agents fetch on behalf of a
 * person who asked for that exact page and never consult robots.txt at all — "allowed"/"blocked"
 * would both imply a permission question that was never asked.
 */
export type AiCrawlerAccess = "allowed" | "blocked" | "partly blocked" | "ignores robots.txt";

/** One Allow/Disallow directive from robots.txt, with its 1-based source line for citation. */
export interface AiCrawlerSourceRule {
  directive: "Allow" | "Disallow";
  value: string;
  line: number;
}

/** What robots.txt says about one named AI-crawler agent, and the exact rule that decided it. */
export interface AiCrawlerRule {
  agent: string;
  /** Who operates it and what it does, in plain English. */
  who: string;
  access: AiCrawlerAccess;
  /** The group the verdict came from: the agent's own name token, "*", or "none" when robots.txt
   * names neither the agent nor a wildcard group. */
  matchedGroup: string;
  /** Source line of the matched group's `User-agent:` declaration; null when matchedGroup is "none". */
  matchedGroupLine: number | null;
  /** The Disallow (and, when present, Allow) rules in the matched group, so the verdict can be
   * checked by hand against the actual robots.txt text. */
  matchedRules: AiCrawlerSourceRule[];
}

/**
 * `/llms.txt` presence — reported for information only. Deliberately no scoring field: Google's
 * AI-optimization guidance says Search ignores the file, so publishing one neither helps nor hurts
 * visibility there, and no rule in this codebase's rulebook may score it either way.
 */
export interface LlmsTxtInfo {
  present: boolean;
  url: string;
  statusCode: number | null;
  bytes: number;
  fetchedAt: string;
  /** The file body when `present`. Optional so robots.json written before this field parsed
   * unchanged — older runs carry metadata only, and consumers must treat an absent field as
   * "content not stored", never as an empty file. */
  content?: string | null;
}

/** Serializable robots evidence (RobotsInfo minus the matcher function). */
export interface RobotsEvidence {
  url: string;
  statusCode: number | null;
  content: string | null;
  sitemaps: string[];
  parseStatus: "ok" | "empty" | "unavailable" | "error";
  fetchedAt: string;
  /** Seconds between requests requested by the matching Crawl-delay directive; null when absent.
   * Optional so runs stored before this field parse unchanged. */
  crawlDelay?: number | null;
  /** The 13-agent AI-crawler access table, computed from `content` by a reporting-only group
   * parser (discovery/aiCrawlers.ts) — separate from the RFC 9309 enforcement path this evidence's
   * own isAllowed() uses. Optional so runs stored before this field parse unchanged. */
  aiCrawlers?: AiCrawlerRule[];
  /** `/llms.txt` presence, fetched alongside robots.txt. Optional so runs stored before this field
   * parse unchanged. */
  llmsTxt?: LlmsTxtInfo;
}

export interface RobotsInfo extends RobotsEvidence {
  isAllowed(url: string, userAgent?: string): boolean;
}

/** One <image:image> child of a sitemap <url>. */
export interface SitemapImageEntry {
  loc: string;
  title?: string;
  caption?: string;
  geoLocation?: string;
  license?: string;
}

/** One <video:video> child of a sitemap <url>. duration is seconds, as authored. */
export interface SitemapVideoEntry {
  thumbnailLoc?: string;
  title?: string;
  description?: string;
  contentLoc?: string;
  playerLoc?: string;
  duration?: number;
  publicationDate?: string;
  familyFriendly?: string;
}

/** The <news:news> child of a sitemap <url> (at most one per URL). */
export interface SitemapNewsEntry {
  publicationName?: string;
  publicationLanguage?: string;
  publicationDate?: string;
  title?: string;
}

export interface SitemapUrlEntry {
  url: string;
  sourceSitemap: string;
  /** Raw <lastmod> exactly as authored — trust is assessed separately, never inferred here. */
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  images?: SitemapImageEntry[];
  videos?: SitemapVideoEntry[];
  news?: SitemapNewsEntry;
  /** Absent means "sitemap" — feed-discovered URLs are tagged so consumers can separate them. */
  sourceKind?: "sitemap" | "feed";
}

export interface SitemapFileRecord {
  url: string;
  statusCode: number | null;
  kind: "urlset" | "index" | "unknown" | "rss" | "atom" | "jsonfeed";
  urlCount: number;
  error: string | null;
  /** True when the file was served gzipped and had to be decompressed before parsing. */
  gzipped?: boolean;
  /** The sitemap file itself lives on a different host than the crawl origin (aliases not applied). */
  crossHost?: boolean;
  /** How many of this file's URLs point off the crawl origin — non-zero with urlCount > 0 is the
   * "sitemap exists but describes another host" case, which reads as "no sitemap" if not recorded. */
  crossHostUrlCount?: number;
  imageCount?: number;
  videoCount?: number;
  newsCount?: number;
}

/** Counters behind a <lastmod> trust judgement. Data only — thresholds belong to the rulebook. */
export interface SitemapLastmodTrust {
  totalUrls: number;
  withLastmod: number;
  /** Present but not a W3C Datetime (e.g. "15/01/2024", RFC-822) — a generator defect. */
  invalid: number;
  distinctValues: number;
  /** Dated after the fetch, beyond a 24h clock-skew allowance. */
  future: number;
  /** Stamped within an hour of the fetch — a generator writing "now" on every URL. */
  withinLastHour: number;
  allIdentical: boolean;
  newest: string | null;
  oldest: string | null;
  verdict:
    | "absent"
    | "trustworthy"
    | "partial"
    | "suspect-uniform"
    | "suspect-future"
    | "suspect-invalid"
    | "suspect-stamped-now";
}

export interface SitemapResult {
  entries: SitemapUrlEntry[];
  files: SitemapFileRecord[];
  errors: string[];
  /** Entries whose <loc> host differs from the crawl origin. */
  crossHostEntryCount?: number;
  lastmodTrust?: SitemapLastmodTrust;
}

/** ---------- POC-2 analysis contract (brief §6b, D-08: deterministic rulebook) ---------- */

export type IssueSeverity = "error" | "warning" | "notice";

export interface IssueEvidence {
  /** Dot-path into the stored record (e.g. "robots.noindex", "images[2].alt"). */
  field: string;
  value: unknown;
  /** Set when evidence lives on a different page than the issue's primary URL. */
  pageId?: string;
}

export interface Issue {
  ruleId: string;
  category: string;
  severity: IssueSeverity;
  scope: "page" | "site";
  /** Primary URL; null for pure site-scope findings. */
  url: string | null;
  pageId: string | null;
  message: string;
  howToFix: string;
  evidence: IssueEvidence[];
  /** Human-readable applied threshold, e.g. "title < 30 chars (was 7)". */
  threshold?: string;
}

export interface RuleMeta {
  id: string;
  category: string;
  defaultSeverity: IssueSeverity;
  description: string;
  howToFix: string;
  /** Record fields the rule needs; absent field on old runs → rule skips, never false-fires. */
  dataRequirements: string[];
}

export interface AnalysisReport {
  runId: string;
  generatedAt: string;
  rulebookVersion: string;
  configSnapshot: unknown;
  /** 0-100, one decimal. Severity-weighted damage per failing check, saturated so a very broken
   * site still ranks against another — see computeHealthScoreDetail for the formula. */
  healthScore: number;
  pagesAnalyzed: number;
  counts: Record<IssueSeverity, number>;
  rulesRun: number;
  rulesSkippedDataUnavailable: string[];
  issues: Issue[];
}

/** ---------- Tier 2: link graph, similarity, crawl diffing ---------- */

export interface PageGraphScore {
  pageId: string;
  url: string;
  /** Internal PageRank scaled to 1-100 on a log curve (the Ahrefs Page Rating model). */
  internalRank: number;
  /** Raw PageRank probability before scaling — kept so the maths stays auditable. */
  rawRank: number;
  inlinks: number;
  uniqueInlinks: number;
  outlinks: number;
  depth: number;
}

export interface GraphReport {
  runId: string;
  generatedAt: string;
  dampingFactor: number;
  iterations: number;
  converged: boolean;
  pages: PageGraphScore[];
  /** Crawled pages with zero internal inlinks (seed excluded). */
  orphans: string[];
}

export interface SimilarityCluster {
  /** Lowest pairwise similarity within the cluster — the conservative figure to report. */
  similarity: number;
  members: { pageId: string; url: string; wordCount: number }[];
}

export interface SimilarityReport {
  runId: string;
  generatedAt: string;
  /** Jaccard threshold a pair must meet to cluster. */
  threshold: number;
  /** Word n-gram size used for shingling. */
  shingleSize: number;
  clusters: SimilarityCluster[];
}

export interface PageFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface PageChange {
  url: string;
  pageId: string;
  changes: PageFieldChange[];
}

export interface CrawlDiff {
  baseRunId: string;
  headRunId: string;
  generatedAt: string;
  /** URLs present in head but not base. */
  added: string[];
  /** URLs present in base but not head. */
  removed: string[];
  changed: PageChange[];
  unchangedCount: number;
  /** Issue lifecycle when both runs have been analyzed; null otherwise. */
  issues: { newIssues: string[]; fixedIssues: string[]; persistingCount: number } | null;
}

export interface CrawlSummary {
  runId: string;
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  discovered: number;
  unique: number;
  allowed: number;
  blockedByRobots: number;
  attempted: number;
  successful: number;
  failed: number;
  /** Pages whose fetch traversed >= 1 redirect hop. */
  redirects: number;
  statusHistogram: Record<string, number>;
  jsRendered: number;
  internalLinks: number;
  externalLinks: number;
  /** Crawled pages with zero internal inlinks, seed excluded. */
  orphanCandidates: string[];
  /** successful / attempted * 100, one decimal. */
  coveragePercent: number;
  /** Deepest crawl.depth among stored pages (0 when none). */
  maxDepthSeen: number;
  sitemap: {
    urlsInSitemap: number;
    inSitemapNotCrawled: string[];
    crawledNotInSitemap: string[];
    sitemapEntriesFailed: string[];
  };
  failuresByClass: Record<string, number>;
}

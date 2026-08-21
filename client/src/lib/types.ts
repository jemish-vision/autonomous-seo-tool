/**
 * Read-side copy of the crawler's shared contract. Source of truth:
 * ../seo-crawler-poc/src/models/types.ts (owned by Main Claude / S1-S7 slices).
 * Duplicated (not imported) per spec.md S8 fallback — keeps the dashboard buildable
 * independent of the sibling project's TS project boundaries. Keep in sync manually.
 */

export interface Redirect {
  from: string;
  to: string;
  statusCode: number;
}

export interface LinkRecord {
  source: string;
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

/** §6.1 — where a foreground <img> sits on the page (mirrors the crawler's ImageContext). Absent
 *  on old runs and on background/network records; treat absence as "no context captured". */
export interface ImageContext {
  nearbyHeading: string | null;
  figcaption: string | null;
  linkHref: string | null;
  linkTitle: string | null;
  surroundingText: string | null;
}

export interface ImageRecord {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  context?: ImageContext;
}

export interface StructuredDataRecord {
  type: "application/ld+json";
  raw: string;
  parsed: unknown | null;
  parseError: string | null;
}

/** Additive (S13, mirrors crawler S12's src/models/types.ts VideoRecord exactly). Optional on
 *  CrawledPage so old run records without the field render fine (undefined, not []) — see
 *  MediaPanel empty state. */
export type VideoKind = "file" | "youtube" | "vimeo" | "iframe";

export interface VideoRecord {
  url: string;
  kind: VideoKind;
  poster: string | null;
  mimeType: string | null;
  providerId: string | null;
}

export interface RobotsMeta {
  meta: string[];
  noindex: boolean;
  nofollow: boolean;
}

export interface PageContent {
  text: string;
  wordCount: number;
  contentHash: string;
}

export interface CrawlMeta {
  depth: number;
  parentUrl: string | null;
  discoverySources: string[];
}

export interface CrawledPage {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robots: RobotsMeta;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  links: LinkRecord[];
  images: ImageRecord[];
  /** Optional: absent on runs crawled before S12 shipped video extraction. */
  videos?: VideoRecord[];
  structuredData: StructuredDataRecord[];
  content: PageContent;
  runId: string;
  url: string;
  normalizedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  redirectChain: Redirect[];
  headers: Record<string, string>;
  performance: { responseTimeMs: number | null };
  renderedWith: "http" | "playwright";
  renderSignals: string[];
  fetchedAt: string;
  crawl: CrawlMeta;
  /** v3 extraction (mirrors the crawler's src/models/types.ts). Optional because older stored runs
   * predate them — `undefined` means "not captured" and must never render as empty or passing. */
  renderDivergence?: RenderDivergence | null;
  /** undefined = crawled without --screenshots; null = attempted and failed; object = captured. */
  screenshot?: { thumb: string; full: string; capturedAt: string } | null;
  headBoundary?: HeadBoundary;
  charset?: CharsetInfo;
  baseHref?: BaseHrefInfo;
  headMeta?: HeadMetaReport;
  favicons?: FaviconReport;
  structure?: DocumentStructure;
  fonts?: FontReport;
}

export interface RenderDivergence {
  titleChanged: boolean;
  metaDescriptionChanged: boolean;
  canonicalChanged: boolean;
  noindexChanged: boolean;
  linkCountDelta: number;
  wordCountDelta: number;
  staticRawSaved: boolean;
  staticCanonical?: string | null;
  renderedCanonical?: string | null;
  staticNoindex?: boolean;
  renderedNoindex?: boolean;
}

export interface HeadBoundary {
  elementCount: number;
  closedBy: string | null;
  closedAtOffset: number | null;
  /** `honoured` is PER SIGNAL: Google ignores a body canonical but respects a body meta robots. */
  stranded: { signal: string; tag: string; honoured: boolean }[];
}

export interface CharsetInfo {
  value: string | null;
  source: "bom" | "header" | "meta" | null;
  metaOffset: number | null;
  effective: boolean;
}

export interface BaseHrefInfo {
  href: string | null;
  count: number;
}

export interface MetaTagRecord {
  attr: "name" | "property" | "http-equiv" | "itemprop" | "charset";
  key: string;
  value: string;
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

export interface HeadMetaReport {
  tags: MetaTagRecord[];
  /** OG takes the FIRST occurrence; twitter takes the LAST. Keys retain their prefix. */
  og: Record<string, string>;
  twitter: Record<string, string>;
  ogImages: OgImageRecord[];
  viewport: string | null;
  /** user-scalable=no or maximum-scale<2 — a WCAG 1.4.4 failure, not a neutral value. */
  viewportBlocksZoom: boolean;
  themeColor: string | null;
  colorScheme: string | null;
  referrer: string | null;
  generator: string | null;
  verification: Record<string, string>;
}

export interface IconRecord {
  rel: string;
  href: string;
  declaredSizes: string | null;
  type: string | null;
  /** Negative = implicit convention (/favicon.ico); any real declaration outranks it. */
  index: number;
  source: "link" | "manifest" | "meta" | "implicit";
  status?: number | null;
  actualSize?: { width: number; height: number } | null;
}

export interface FaviconReport {
  candidates: IconRecord[];
  effective: string | null;
  /** null means UNDETERMINED (e.g. robots access unknown), never false. */
  googleSerpEligible: boolean | null;
  googleSerpBlockers: string[];
}

export interface HeadingRecord {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
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
  landmarks: string[];
}

export interface FontFaceRecord {
  family: string;
  source: string;
  origin: "same-origin" | "third-party";
  host: string | null;
  display: string | null;
  preloaded: boolean;
  preloadMissingCrossorigin: boolean;
}

export interface FontReport {
  faces: FontFaceRecord[];
  /** Third-party font hosts are a GDPR exposure, not merely a performance note. */
  thirdPartyHosts: string[];
  usedFamilies?: string[];
}

/** pages/<pageId>.json's filename (sans extension) is the id — not a field on CrawledPage itself. */
export interface CrawledPageWithId extends CrawledPage {
  pageId: string;
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

/** Additive (B3, mirrors crawler B2's src/models/types.ts SkippedUrlRecord exactly). A URL
 *  deliberately not fetched by the safety guard rails — evidence, never a silent drop. */
export interface SkippedUrlRecord {
  url: string;
  reason: "logout" | "destructive" | "user-excluded";
  matchedPattern: string;
  foundOn: string | null;
}

/** `/llms.txt` presence, fetched alongside robots.txt (mirrors the crawler's LlmsTxtInfo).
 *  Reported for information only — no rule in the rulebook may score it. Optional on
 *  RobotsEvidence so runs stored before this field parse unchanged. */
export interface LlmsTxtInfo {
  present: boolean;
  url: string;
  statusCode: number | null;
  bytes: number;
  fetchedAt: string;
  /** The file body when `present`. Absent on runs crawled by crawler versions that stored
   *  metadata only — treat absence as "content not stored", never as an empty file. */
  content?: string | null;
}

export interface RobotsEvidence {
  url: string;
  statusCode: number | null;
  content: string | null;
  sitemaps: string[];
  parseStatus: "ok" | "empty" | "unavailable" | "error";
  fetchedAt: string;
  /** Absent on runs crawled before llms.txt probing shipped. */
  llmsTxt?: LlmsTxtInfo;
}

export interface SitemapUrlEntry {
  url: string;
  sourceSitemap: string;
}

export interface SitemapFileRecord {
  url: string;
  statusCode: number | null;
  kind: "urlset" | "index" | "unknown";
  urlCount: number;
  error: string | null;
}

export interface SitemapResult {
  entries: SitemapUrlEntry[];
  files: SitemapFileRecord[];
  errors: string[];
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
  redirects: number;
  statusHistogram: Record<string, number>;
  jsRendered: number;
  internalLinks: number;
  externalLinks: number;
  orphanCandidates: string[];
  coveragePercent: number;
  /** Absent on runs written before the crawler started recording it — treat missing as unknown. */
  maxDepthSeen?: number;
  sitemap: {
    urlsInSitemap: number;
    inSitemapNotCrawled: string[];
    crawledNotInSitemap: string[];
    sitemapEntriesFailed: string[];
  };
  failuresByClass: Record<string, number>;
}

/** Additive (A5, mirrors crawler A4's src/models/types.ts "POC-2 analysis contract" exactly).
 *  Optional on the read side: runs without issues.json simply have no AnalysisReport. */
export type IssueSeverity = "error" | "warning" | "notice";

export interface IssueEvidence {
  field: string;
  value: unknown;
  pageId?: string;
}

export interface Issue {
  ruleId: string;
  category: string;
  severity: IssueSeverity;
  scope: "page" | "site";
  url: string | null;
  pageId: string | null;
  message: string;
  howToFix: string;
  evidence: IssueEvidence[];
  threshold?: string;
}

/** Mirrors crawler's src/analysis/priority/types.ts PriorityFactors — each 0..1. */
export interface PriorityFactors {
  severity: number;
  reach: number;
  importance: number;
  confidence: number;
}

export type FindingStatus = "failing" | "passed" | "skipped-data-unavailable" | "errored" | "muted";
export type AutomationLevel = "auto-safe" | "auto-with-review" | "human-only";
export type EffortLevel = "low" | "medium" | "high";
export type DetectionTier = "observed" | "derived" | "heuristic";

/** Rule-level rollup for one crawl, mirrors crawler's FindingReport field-for-field. The composite
 *  `priority` (0-100) and its four `priorityFactors` are computed server-side only — never
 *  re-derived here. */
export interface FindingReport {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  severity: IssueSeverity;
  status: FindingStatus;
  affectedPages: number;
  affectedInstances: number;
  evaluatedPages: number;
  reach: number | null;
  importance: number | null;
  confidence: number | null;
  priority: number;
  priorityFactors: PriorityFactors | null;
  damage: number | null;
  effort: EffortLevel;
  effortWhy: string;
  automation: AutomationLevel;
  detectionTier: DetectionTier;
  automationReviewed: boolean;
  why: string;
  howToFix: string;
  sampleUrls: string[];
  skipReason: string | null;
  errorNote: string | null;
  mutedAt: string | null;
  mutedNote: string | null;
}

export interface WorstPageEntry {
  pageId: string;
  url: string;
  harm: number;
  issueCount: number;
  topRuleIds: string[];
}

export interface MuteRecord {
  ruleId: string;
  note: string | null;
  mutedBy: string | null;
  mutedAt: string;
  expiresAt: string | null;
}

export interface SkippedRuleDetail {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  pageCount: number;
  missing: string[];
}

export interface RuleErrorDetail {
  ruleId: string;
  category: string;
  scope: "page" | "site";
  message: string;
  pageCount: number;
}

export interface CategoryScore {
  name: string;
  categoryKey: string;
  weight: number;
  score: number;
  deductions?: Array<{
    ruleId: string;
    points: number;
    reach: number;
    reason: string;
  }>;
}

export interface AnalysisReport {
  runId: string;
  generatedAt: string;
  rulebookVersion: string;
  configSnapshot: unknown;
  healthScore: number;
  pagesAnalyzed: number;
  counts: Record<IssueSeverity, number>;
  rulesRun: number;
  rulesSkippedDataUnavailable: string[];
  issues: Issue[];
  categories?: CategoryScore[];
  grade?: string;
  band?: string;
  /** Additive priority-slice fields. Optional: runs analyzed before this slice shipped have
   *  issues.json without them — callers must treat absence as "not available", never as empty. */
  findings?: FindingReport[];
  worstPages?: WorstPageEntry[];
  rulesErrored?: string[];
  rulesErroredDetail?: RuleErrorDetail[];
  rulesSkippedDetail?: SkippedRuleDetail[];
  mutedRuleIds?: string[];
  graphAvailable?: boolean;
}

export interface FixPlanItem {
  rule: string;
  issue: string;
  url: string | null;
  pageId: string | null;
  action: string;
  where: string;
  change: string | string[];
  note: string;
}

export interface FixPlanSkip {
  rule: string;
  url: string | null;
  reason: string;
}

export interface FixPlan {
  runId: string;
  generatedAt: string;
  applied: boolean;
  note: string;
  rules: { id: string; findings: number }[];
  totalChanges: number;
  items: FixPlanItem[];
  skipped: FixPlanSkip[];
}

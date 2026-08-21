/**
 * AI Recommendations & Suggestions — server-only. Lives entirely in the dashboard (not the
 * crawler): the dashboard already reads every stored run's issues.json + page records directly
 * (lib/data.ts, lib/data-issues.ts), so generating a recommendation is "read what's already on
 * disk, call an LLM, validate, show it" — a Next.js API-route concern, not a CLI one. See
 * qi-feature-plam.md at the repo root for the full design.
 *
 * Contract:
 * - The deterministic rulebook (crawler) decides WHETHER an issue exists. This module never
 *   re-decides that — it only runs for issues the rulebook already confirmed.
 * - Every recommendation must cite `basedOn` evidence. A recommendation that can't point at real
 *   evidence is discarded, never displayed.
 * - `needsHumanInput: true` is a first-class, valid output — abstention beats a fabricated guess.
 * - This module NEVER writes to a customer's site. It only writes ai-recommendations.json next to
 *   the run's own issues.json/fix-plan.json. Applying a recommendation is always a human action.
 */
import type { Issue, IssueSeverity } from "../types";

export type AiRecommendationCategory =
  | "image-alt"
  | "title"
  | "meta-description"
  | "heading"
  | "social"
  | "duplicate-content"
  | "duplicate-content-rewrite"
  | "structured-data"
  | "canonical"
  | "internal-link-anchor"
  | "content-brief";

export interface AiRecommendationEvidenceRef {
  field: string;
  value: string;
}

export interface AiRecommendationValidation {
  lengthOk: boolean;
  /** null = pixel width doesn't apply to this category (only title/meta-description have an
   *  estimator). */
  pixelWidthOk: boolean | null;
  noInventedFacts: boolean;
  schemaValid: boolean;
  bannedPatternHit: string | null;
}

export interface AiRecommendation {
  issueRuleId: string;
  /** "mechanical" = no LLM call — a deterministic rulebook card (see generate.ts's fallback). */
  category: AiRecommendationCategory | "mechanical";
  url: string | null;
  pageId: string | null;
  /** Identity within a rule+page for multi-instance rules — image-missing-alt fires once per
   *  page but names several offending images, so it needs one recommendation per image. Format
   *  mirrors the issue's own evidence field path, e.g. "images[3]". Null for single-instance
   *  rules (title/meta-description/h1/... — one recommendation per issue). */
  instanceKey: string | null;

  /** For image-alt only: the absolute URL of the specific image this recommendation is for. Alt
   *  text is written to the ATTACHMENT, not the page, so applying the fix needs the image URL, not
   *  `url` (which is the page the image appears on). Null/absent for every other category and for
   *  image records generated before this field shipped (the card falls back to parsing the src out
   *  of currentValue/recommendedValue). */
  imageUrl?: string | null;

  generatedAt: string;
  model: string;
  /** Bumped on any prompt/schema change. */
  promptVersion: string;

  whatIsWrong: string;
  /** The exact current value/markup, computed deterministically from stored crawl data — never
   *  asked of the model, so it can never drift from what was actually crawled. */
  currentValue: string | null;
  /** The exact replacement markup, deterministically assembled from the model's plain-text answer
   *  (recommendedValuePlain) — never trusted raw from the model. */
  recommendedValue: string;
  /** The bare content the model produced (no markup) — what validators check. Empty string when
   *  needsHumanInput is true. */
  recommendedValuePlain: string;

  whyThisValue: string;
  basedOn: AiRecommendationEvidenceRef[];
  howToApply: string;

  /** Computed by validators.ts — the model's own self-report is recorded separately and is never
   *  the gate. */
  confidence: number;
  selfReportedConfidence: number | null;
  needsHumanInput: boolean;
  needsHumanInputReason: string | null;

  validation: AiRecommendationValidation;

  // GSC & OpenSERP Intelligence Metadata
  isGscEnriched?: boolean;
  gscKeyword?: string | null;
  gscImpressions?: number | null;
  gscClicks?: number | null;
  competitorBenchmarkTitles?: string[];

  /** Fingerprint of the input this recommendation was generated from, so a later run can reuse it
   *  without re-calling the model when nothing changed (qi-feature-plam.md §11.3). Optional:
   *  recommendations written before this shipped carry neither field, and are never reused. */
  contentHash?: string | null;
  evidenceSig?: string | null;
}

export interface AiRecommendationSkip {
  ruleId: string;
  url: string | null;
  pageId: string | null;
  reason: string;
}

export interface AiIntelligenceSummary {
  gscConnected: boolean;
  domain: string;
  topKeyword: string | null;
  impressions: number | null;
  clicks: number | null;
  competitorBenchmarks: string[];
}

export interface AiRecommendationReport {
  runId: string;
  /** Whether AI recommendations have EVER been generated for this run. Lets the UI distinguish
   *  "generation ran but produced zero recommendations" (generated: true, recommendations: [])
   *  from "never generated" (generated: false). Optional for back-compat with older payloads that
   *  predate the flag — treat a missing value as false. */
  generated?: boolean;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  rulesConsidered: string[];
  totalGenerated: number;
  totalSkipped: number;
  /** Recommendations carried over from a previous generation because the page content hash and
   *  issue evidence were unchanged. Optional for back-compat with older reports. */
  totalReused?: number;
  intelligence?: AiIntelligenceSummary;
  recommendations: AiRecommendation[];
  skipped: AiRecommendationSkip[];
}

export interface LengthConstraint {
  minChars?: number;
  maxChars?: number;
  minPx?: number;
  maxPx?: number;
}

/** Compact digest of the page's OTHER SEO signals — everything the crawler stored about this
 *  page beyond the fields the category prompt already special-cases (title/description/H1s/
 *  excerpt). Fed verbatim into the prompt so the model reasons about the FULL page, not just the
 *  single issue it is fixing (e.g. a title recommendation can weigh that the page is noindexed,
 *  or has no images, or a canonical pointing elsewhere). Never a substitute for the issue's own
 *  evidence — always additional context. */
export interface PageSignals {
  statusCode: number | null;
  canonical: string | null;
  noindex: boolean;
  nofollow: boolean;
  metaRobots: string[];
  /** Headings below H3 (levels 4-6) — captured only by runs with the structure extractor;
   *  empty when absent. */
  h4to6: { level: number; text: string }[];
  internalLinkCount: number;
  externalLinkCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  /** @type values parsed from the page's JSON-LD blocks, e.g. ["Article", "BreadcrumbList"]. */
  structuredDataTypes: string[];
  videoCount: number;
  responseTimeMs: number | null;
  wordCount: number | null;
}

/** The page's OTHER confirmed issues (same pageId, different rule) — so the model knows the full
 *  problem surface of the page it is fixing and can cross-reference (a title fix on a page that
 *  also has duplicate-title elsewhere, or an H1 mismatch, is a different situation than the same
 *  title defect in isolation). Compact: ruleId + severity + message only. */
export interface PageIssueLite {
  ruleId: string;
  category: string;
  severity: string;
  message: string;
}

/** Everything the model needs to produce a grounded, page-specific answer. See context.ts. */
export interface AiContextPack {
  ruleId: string;
  category: AiRecommendationCategory;
  url: string | null;
  pageId: string | null;
  message: string;
  evidence: { field: string; value: unknown }[];
  threshold: string | null;

  pageTitle: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  contentExcerpt: string | null;
  wordCount: number | null;
  topKeywords: string[];

  /** Only populated when category === "image-alt". */
  image?: {
    url: string;
    width: number | null;
    height: number | null;
    format: string | null;
    /** §6.1 — where the image sits on the page (nearby heading, figcaption, wrapping link,
     *  surrounding text). Null when the run predates context capture or the image has none. */
    context?: {
      nearbyHeading: string | null;
      figcaption: string | null;
      linkHref: string | null;
      linkTitle: string | null;
      surroundingText: string | null;
    };
    /** data: URL, set by generate.ts after an (optional, best-effort) fetch. Null when the fetch
     *  was skipped or failed — the prompt degrades to text-only context, never blocks generation. */
    imageDataUrl: string | null;
  };

  /** Only populated when category === "social". */
  social?: { og: Record<string, string>; twitter: Record<string, string> };

  /** Only populated when category === "structured-data". */
  structuredData?: {
    existingTypes: string[];
    missingRequired: string[];
    missingRecommended: string[];
    /** Raw JSON-LD blocks / parse-error text pulled from the issue's evidence — present only for
     *  the repair rules (parse-error, type-mismatch, unknown-type, ...) so the model can fix the
     *  actual markup rather than guess. */
    rawBlocks?: string[];
    errors?: string[];
  };

  /** Only populated when category === "duplicate-content" — the OTHER page(s) sharing the same
   *  title/description, so the model differentiates rather than proposing the same fix twice. */
  duplicatePeers?: { url: string; title: string | null; contentExcerpt: string | null }[];

  /** Only populated when category === "canonical". */
  canonicalInfo?: { currentCanonical: string | null; selfUrl: string };

  /** Only populated when category === "internal-link-anchor". */
  linkInfo?: { currentAnchor: string; targetUrl: string; targetTitle: string | null; targetH1: string[] };

  /** Operator-supplied per-project business facts (§6.2), e.g. { brand, currency, price }. The
   *  ONLY source a recommendation may fill a business field (structured-data price/brand/etc.)
   *  from — never invented by the model. Empty when none configured. */
  businessContext: Record<string, string>;

  constraints: LengthConstraint;

  /** Full-page SEO digest — always present when a page record exists (all categories except
   *  image-alt which has its own per-image context on top of this). */
  pageSignals?: PageSignals;
  /** Other confirmed issues on the same page (excluding the one being fixed). Empty when the
   *  caller didn't pass the run's full issue list. */
  pageIssues?: PageIssueLite[];
}

export type JsonSchema = Record<string, unknown>;

export interface AiProviderResult {
  raw: unknown;
  selfReportedConfidence: number | null;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Returns null (never throws) when the model returned no usable text or malformed JSON despite
   *  schema mode. Network/auth/timeout failures DO throw. */
  generate(input: {
    systemPrompt: string;
    userPrompt: string;
    schema: JsonSchema;
    imageDataUrl?: string | null;
  }): Promise<AiProviderResult | null>;
}

export type { Issue, IssueSeverity };

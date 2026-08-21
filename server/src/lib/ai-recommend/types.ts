/**
 * AI Recommendations — types. Ported from poc/seo-dashboard/lib/ai-recommend/types.ts. The Ai*
 * shapes are verbatim (they define the generation contract). The crawler-domain types the pipeline
 * reads from (`Issue`, `CrawledPageWithId`, `AnalysisReport`) are re-declared here as a LOCAL,
 * minimal superset of exactly the fields context.ts / generate.ts / validators.ts touch — the
 * Supabase read layer (db/src/crawl/readStore.ts) returns lossier row shapes, so the route adapts
 * those rows into these before calling the pipeline (see aiRecommendationsGenerate.routes.ts).
 *
 * Supabase-only: no filesystem, no crawler package import.
 */

// ---------------------------------------------------------------------------
// Crawler-domain types the pipeline reads (local, minimal — see header)
// ---------------------------------------------------------------------------

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

export interface ImageRecordLite {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  /** DOM position hints (nearby heading, figcaption, wrapping link, surrounding text). Only present
   *  on runs whose sync captured image context — absent (undefined) on the Supabase projection. */
  context?: {
    nearbyHeading: string | null;
    figcaption: string | null;
    linkHref: string | null;
    linkTitle: string | null;
    surroundingText: string | null;
  };
}

export interface HeadingRecordLite {
  level: number;
  text: string;
}

export interface CrawledPageWithId {
  pageId: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robots?: { meta: string[]; noindex: boolean; nofollow: boolean };
  headings: { h1: string[]; h2: string[]; h3: string[] };
  links: { type: "internal" | "external" }[];
  images: ImageRecordLite[];
  videos?: unknown[];
  structuredData: { parsed: unknown }[];
  content?: { text: string; wordCount: number; contentHash: string };
  url: string;
  normalizedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  performance?: { responseTimeMs: number | null };
  /** Open Graph / Twitter card tags. Parity gap on Supabase-only — undefined until the sync
   *  captures head meta; the social category then degrades to "(none)". */
  headMeta?: { og: Record<string, string>; twitter: Record<string, string> };
  /** Full document structure (H4-H6 etc). Parity gap on Supabase-only — undefined. */
  structure?: { headings: HeadingRecordLite[] };
}

export interface AnalysisReport {
  runId: string;
  issues: Issue[];
}

// ---------------------------------------------------------------------------
// AI recommendation contract (verbatim from the old lib)
// ---------------------------------------------------------------------------

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
  pixelWidthOk: boolean | null;
  noInventedFacts: boolean;
  schemaValid: boolean;
  bannedPatternHit: string | null;
}

export interface AiRecommendation {
  issueRuleId: string;
  category: AiRecommendationCategory | "mechanical";
  url: string | null;
  pageId: string | null;
  instanceKey: string | null;
  imageUrl?: string | null;

  generatedAt: string;
  model: string;
  promptVersion: string;

  whatIsWrong: string;
  currentValue: string | null;
  recommendedValue: string;
  recommendedValuePlain: string;

  whyThisValue: string;
  basedOn: AiRecommendationEvidenceRef[];
  howToApply: string;

  confidence: number;
  selfReportedConfidence: number | null;
  needsHumanInput: boolean;
  needsHumanInputReason: string | null;

  validation: AiRecommendationValidation;

  contentHash?: string | null;
  evidenceSig?: string | null;
}

export interface AiRecommendationSkip {
  ruleId: string;
  url: string | null;
  pageId: string | null;
  reason: string;
}

export interface AiRecommendationReport {
  runId: string;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  rulesConsidered: string[];
  totalGenerated: number;
  totalSkipped: number;
  totalReused?: number;
  recommendations: AiRecommendation[];
  skipped: AiRecommendationSkip[];
}

export interface LengthConstraint {
  minChars?: number;
  maxChars?: number;
  minPx?: number;
  maxPx?: number;
}

export interface PageSignals {
  statusCode: number | null;
  canonical: string | null;
  noindex: boolean;
  nofollow: boolean;
  metaRobots: string[];
  h4to6: { level: number; text: string }[];
  internalLinkCount: number;
  externalLinkCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  structuredDataTypes: string[];
  videoCount: number;
  responseTimeMs: number | null;
  wordCount: number | null;
}

export interface PageIssueLite {
  ruleId: string;
  category: string;
  severity: string;
  message: string;
}

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

  image?: {
    url: string;
    width: number | null;
    height: number | null;
    format: string | null;
    context?: {
      nearbyHeading: string | null;
      figcaption: string | null;
      linkHref: string | null;
      linkTitle: string | null;
      surroundingText: string | null;
    };
    imageDataUrl: string | null;
  };

  social?: { og: Record<string, string>; twitter: Record<string, string> };

  structuredData?: {
    existingTypes: string[];
    missingRequired: string[];
    missingRecommended: string[];
    rawBlocks?: string[];
    errors?: string[];
  };

  duplicatePeers?: { url: string; title: string | null; contentExcerpt: string | null }[];

  canonicalInfo?: { currentCanonical: string | null; selfUrl: string };

  linkInfo?: { currentAnchor: string; targetUrl: string; targetTitle: string | null; targetH1: string[] };

  businessContext: Record<string, string>;

  constraints: LengthConstraint;

  pageSignals?: PageSignals;
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
  generate(input: {
    systemPrompt: string;
    userPrompt: string;
    schema: JsonSchema;
    imageDataUrl?: string | null;
  }): Promise<AiProviderResult | null>;
}

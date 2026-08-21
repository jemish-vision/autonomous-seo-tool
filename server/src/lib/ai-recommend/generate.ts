/**
 * Orchestrates the per-issue pipeline: build context -> call the provider -> validate -> one
 * re-ask on failure -> deterministic markup assembly -> collect. Ported from
 * poc/seo-dashboard/lib/ai-recommend/generate.ts and TRIMMED for the Supabase-only server:
 *
 *   - All node:fs disk I/O removed (writeAiRecommendationReport / readBusinessContext / the
 *     ai-recommendations.json persistence). The route persists into the AiRecommendation table.
 *   - The GSC + OpenSERP "intelligence" enrichment (readConnection/querySearchAnalytics/
 *     searchOpenSerp, dynamic imports of ../gsc/* and ../ai/*) is dropped: those modules are not
 *     vendored server-side. Recommendations are generated from the run's own crawl data only.
 *   - businessContext defaults to {} (the old disk read is gone) — callers may still pass one.
 *
 * The core "read stored crawl data -> call an LLM -> validate -> assemble" pipeline, the mechanical
 * fallback card, the ITEM_CAP, the "never silently drop, always record a skip with a reason"
 * discipline, and the provider-failure circuit breaker are all preserved verbatim.
 */
import { createHash } from "node:crypto";
import { buildContextPacks, buildUrlIndex, categoryForRule } from "./context.js";
import { PROMPT_TEMPLATES, PROMPT_VERSION } from "./prompts.js";
import { validateModelOutput, computeConfidence, RULEBOOK_THRESHOLDS, type ValidationOutcome } from "./validators.js";
import { fetchImageAsDataUrl } from "./provider.js";
import type {
  AiContextPack,
  AiProvider,
  AiRecommendation,
  AiRecommendationCategory,
  AiRecommendationReport,
  AiRecommendationSkip,
  AnalysisReport,
  CrawledPageWithId,
  Issue,
  LengthConstraint,
} from "./types.js";

const ITEM_CAP = 500;

/** No rulebook threshold exists for alt-text length; 125 chars is the widely-cited practical
 *  screen-reader announcement limit (WebAIM/W3C alt-text guidance). */
const ALT_TEXT_MAX_CHARS = 125;

function thresholdsFor(ruleId: string, category: AiRecommendationCategory): LengthConstraint {
  if (category === "title") return { minChars: RULEBOOK_THRESHOLDS.titleMinChars, maxChars: RULEBOOK_THRESHOLDS.titleMaxChars };
  if (category === "meta-description") return { minChars: RULEBOOK_THRESHOLDS.descMinChars, maxChars: RULEBOOK_THRESHOLDS.descMaxChars };
  if (ruleId === "image-missing-alt") return { maxChars: ALT_TEXT_MAX_CHARS };
  return {};
}

function trimToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  let end = maxChars;
  while (end > 0 && text[end - 1] !== " ") end--;
  if (end === 0) end = maxChars;
  return text.slice(0, end).trimEnd();
}

/** Deterministic rescue for the single most common validation failure: the value is otherwise good
 *  but a few characters over the rule's maxChars. Only applied when length is the SOLE failure. */
function salvageLengthOnlyFailure(outcome: ValidationOutcome, lengthConstraint: LengthConstraint): ValidationOutcome {
  if (outcome.ok || !outcome.value) return outcome;
  if (outcome.validation.noInventedFacts === false || outcome.validation.bannedPatternHit !== null || outcome.value.basedOn.length === 0) {
    return outcome;
  }
  const maxChars = lengthConstraint.maxChars;
  if (maxChars === undefined) return outcome;
  const v = outcome.value;
  const trimmed = trimToMaxChars(v.recommendedValuePlain, maxChars);
  if (trimmed === v.recommendedValuePlain) return outcome;
  const validation = { ...outcome.validation, lengthOk: true };
  return {
    ok: true,
    errors: [],
    value: { ...v, recommendedValuePlain: trimmed },
    validation,
    confidence: computeConfidence(validation, v.basedOn.length > 0),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function currentValueFor(pack: AiContextPack): string | null {
  switch (pack.category) {
    case "image-alt":
      return `<img src="${pack.image!.url}">`;
    case "title":
      return pack.pageTitle ? `<title>${escapeHtml(pack.pageTitle)}</title>` : null;
    case "meta-description":
      return pack.metaDescription ? `<meta name="description" content="${escapeAttr(pack.metaDescription)}">` : null;
    case "heading":
      if (pack.h1.length === 0) return null;
      return pack.h1.map((h) => `<h1>${escapeHtml(h)}</h1>`).join("\n");
    case "social": {
      const s = pack.social!;
      const lines = [
        s.og.title ? `<meta property="og:title" content="${escapeAttr(s.og.title)}">` : null,
        s.og.description ? `<meta property="og:description" content="${escapeAttr(s.og.description)}">` : null,
        s.twitter.title ? `<meta name="twitter:title" content="${escapeAttr(s.twitter.title)}">` : null,
        s.twitter.description ? `<meta name="twitter:description" content="${escapeAttr(s.twitter.description)}">` : null,
      ].filter((x): x is string => Boolean(x));
      return lines.length > 0 ? lines.join("\n") : null;
    }
    case "duplicate-content":
      return pack.ruleId === "duplicate-title"
        ? pack.pageTitle
          ? `<title>${escapeHtml(pack.pageTitle)}</title>`
          : null
        : pack.metaDescription
          ? `<meta name="description" content="${escapeAttr(pack.metaDescription)}">`
          : null;
    case "structured-data":
      return pack.structuredData!.existingTypes.length > 0 ? `(existing types: ${pack.structuredData!.existingTypes.join(", ")})` : null;
    case "canonical":
      return pack.canonicalInfo!.currentCanonical ? `<link rel="canonical" href="${escapeAttr(pack.canonicalInfo!.currentCanonical)}">` : null;
    case "internal-link-anchor":
      return `<a href="${escapeAttr(pack.linkInfo!.targetUrl)}">${escapeHtml(pack.linkInfo!.currentAnchor)}</a>`;
    case "content-brief":
    case "duplicate-content-rewrite":
      return null; // guidance categories — no "current markup" to show
  }
}

function wrapRecommendedValue(pack: AiContextPack, plain: string): string {
  switch (pack.category) {
    case "image-alt":
      return `<img src="${pack.image!.url}" alt="${escapeAttr(plain)}">`;
    case "title":
      return `<title>${escapeHtml(plain)}</title>`;
    case "meta-description":
      return `<meta name="description" content="${escapeAttr(plain)}">`;
    case "heading":
      return pack.ruleId === "h1-missing" ? `<h1>${escapeHtml(plain)}</h1>` : plain;
    case "social": {
      const m = /og:title=(.*?)\s*\|\s*og:description=(.*)/i.exec(plain);
      if (!m) return plain;
      const title = m[1]!.trim();
      const desc = m[2]!.trim();
      return [
        `<meta property="og:title" content="${escapeAttr(title)}">`,
        `<meta property="og:description" content="${escapeAttr(desc)}">`,
        `<meta name="twitter:title" content="${escapeAttr(title)}">`,
        `<meta name="twitter:description" content="${escapeAttr(desc)}">`,
      ].join("\n");
    }
    case "duplicate-content":
      return pack.ruleId === "duplicate-title" ? `<title>${escapeHtml(plain)}</title>` : `<meta name="description" content="${escapeAttr(plain)}">`;
    case "structured-data":
      return `<script type="application/ld+json">${plain}</script>`;
    case "canonical":
      return ""; // always needsHumanInput — never reached
    case "internal-link-anchor":
      return `<a href="${escapeAttr(pack.linkInfo!.targetUrl)}">${escapeHtml(plain)}</a>`;
    case "content-brief":
    case "duplicate-content-rewrite":
      return plain; // guidance text is the deliverable — no markup to wrap
  }
}

async function tryGenerate(provider: AiProvider, systemPrompt: string, userPrompt: string, schema: Record<string, unknown>, pack: AiContextPack, lengthConstraint: LengthConstraint): Promise<ValidationOutcome> {
  const result = await provider.generate({ systemPrompt, userPrompt, schema, imageDataUrl: pack.image?.imageDataUrl ?? null });
  if (!result) {
    return {
      ok: false,
      errors: ["model returned no usable text (empty response or malformed JSON despite schema mode)"],
      value: null,
      validation: { lengthOk: false, pixelWidthOk: null, noInventedFacts: false, schemaValid: false, bannedPatternHit: null },
      confidence: 0,
    };
  }
  const outcome = validateModelOutput(result.raw, pack, lengthConstraint);

  // structured-data's recommendedValuePlain must be valid JSON — a broken block is worse than none.
  if (outcome.ok && !outcome.value?.needsHumanInput && pack.category === "structured-data" && outcome.value) {
    try {
      JSON.parse(outcome.value.recommendedValuePlain);
    } catch {
      return { ...outcome, ok: false, errors: [...outcome.errors, "recommendedValuePlain is not valid JSON"] };
    }
  }
  return outcome;
}

export interface GenerateOptions {
  runId: string;
  analysis: AnalysisReport;
  pages: CrawledPageWithId[];
  provider: AiProvider;
  /** Restrict generation to these rule ids only. Undefined = every supported rule. */
  ruleFilter?: string[];
  /** Restrict generation to one page only (the "generate for this page" per-page action). */
  pageIdFilter?: string;
  /** Cap the number of issues considered. Defaults to ITEM_CAP. */
  top?: number;
  /** False skips the network image fetch entirely (faster; text-only context for image-alt). */
  fetchImages?: boolean;
  /** Operator-supplied per-project business facts (§6.2). Empty when none. */
  businessContext?: Record<string, string>;
}

/** Stable fingerprint of an issue's evidence — carried onto the row for §11.3 reuse fingerprints. */
function evidenceSig(issue: Issue): string {
  return createHash("sha256").update(JSON.stringify(issue.evidence)).digest("hex");
}

/** Deterministic "mechanical" card for a rule the AI layer does not author content for — the
 *  rulebook's own howToFix + evidence, marked model="rulebook". No provider call. This is what
 *  makes the feature cover EVERY issue in a run, not just the content-authoring subset. */
function buildMechanicalRecommendation(issue: Issue, page: CrawledPageWithId | null): AiRecommendation {
  const fix = issue.howToFix || "Fix per the rulebook's guidance for this rule.";
  return {
    issueRuleId: issue.ruleId,
    category: "mechanical",
    url: issue.url,
    pageId: issue.pageId,
    instanceKey: null,
    generatedAt: new Date().toISOString(),
    model: "rulebook",
    promptVersion: PROMPT_VERSION,
    whatIsWrong: issue.message,
    currentValue: null,
    recommendedValue: fix,
    recommendedValuePlain: fix,
    whyThisValue: "Deterministic rulebook guidance — this is a structural/mechanical fix with no content to author, so no AI call was made.",
    basedOn: issue.evidence.map((e) => ({ field: e.field, value: typeof e.value === "string" ? e.value : JSON.stringify(e.value) })),
    howToApply: fix,
    confidence: 1,
    selfReportedConfidence: null,
    needsHumanInput: false,
    needsHumanInputReason: null,
    validation: { lengthOk: true, pixelWidthOk: null, noInventedFacts: true, schemaValid: true, bannedPatternHit: null },
    contentHash: page?.content?.contentHash ?? null,
    evidenceSig: evidenceSig(issue),
  };
}

export async function generateAiRecommendations(opts: GenerateOptions): Promise<AiRecommendationReport> {
  const pagesById = new Map(opts.pages.map((p) => [p.pageId, p] as const));
  const pagesByUrl = buildUrlIndex(opts.pages);
  const businessContext = opts.businessContext ?? {};

  // Every issue is eligible: AI-authorable rules get a real model call, every other rule gets a
  // deterministic "mechanical" card assembled from the rulebook's own howToFix + evidence.
  const eligible: Issue[] = opts.analysis.issues.filter((issue) => {
    if (opts.ruleFilter && !opts.ruleFilter.includes(issue.ruleId)) return false;
    if (opts.pageIdFilter && issue.pageId !== opts.pageIdFilter) return false;
    return true;
  });

  const capped = eligible.slice(0, opts.top ?? ITEM_CAP);

  const recommendations: AiRecommendation[] = [];
  const skipped: AiRecommendationSkip[] = [];
  const rulesConsidered = new Set<string>();
  // Provider-failure circuit breaker: 3 throws in a row means the provider is down for everyone —
  // fail fast instead of burning a timeout on every remaining page.
  let consecutiveProviderFailures = 0;
  let firstProviderFailure: Error | null = null;

  for (const issue of capped) {
    rulesConsidered.add(issue.ruleId);
    let page = issue.pageId ? (pagesById.get(issue.pageId) ?? null) : null;
    if (!page && issue.url) page = pagesByUrl.get(issue.url) ?? null;

    const category = categoryForRule(issue.ruleId);

    // Deterministic fallback — no AI category for this rule (structural/infra or auto-safe).
    if (!category) {
      recommendations.push(buildMechanicalRecommendation(issue, page));
      continue;
    }

    const template = PROMPT_TEMPLATES[category];
    const lengthConstraint = thresholdsFor(issue.ruleId, category);

    const entries = buildContextPacks(issue, page, {
      constraints: lengthConstraint,
      pagesById,
      pagesByUrl,
      businessContext,
      allIssues: opts.analysis.issues,
    });
    if (entries.length === 0) {
      skipped.push({ ruleId: issue.ruleId, url: issue.url, pageId: issue.pageId, reason: "no page record (or no resolvable cross-page evidence) to build AI context from" });
      continue;
    }

    for (const { pack, instanceKey } of entries) {
      try {
        if (pack.image && opts.fetchImages !== false) {
          pack.image.imageDataUrl = await fetchImageAsDataUrl(pack.image.url).catch(() => null);
        }

        const userPrompt = template.buildUserPrompt(pack);
        let outcome = await tryGenerate(opts.provider, template.instructions, userPrompt, template.schema, pack, lengthConstraint);
        if (!outcome.ok && outcome.errors.length > 0) {
          const reaskPrompt = `${userPrompt}\n\nYour previous answer was rejected for: ${outcome.errors.join("; ")}. Fix it and answer again.`;
          outcome = await tryGenerate(opts.provider, template.instructions, reaskPrompt, template.schema, pack, lengthConstraint);
        }
        // A value that's only slightly too long is worth keeping — trim it deterministically.
        outcome = salvageLengthOnlyFailure(outcome, lengthConstraint);

        if (!outcome.value) {
          skipped.push({ ruleId: issue.ruleId, url: issue.url, pageId: issue.pageId, reason: `model did not return a usable recommendation after retry: ${outcome.errors.join("; ") || "unknown"}` });
        } else {
          const v = outcome.value;
          const needsHumanInput = v.needsHumanInput || !outcome.ok;
          recommendations.push({
            issueRuleId: issue.ruleId,
            category,
            url: issue.url,
            pageId: issue.pageId,
            instanceKey,
            imageUrl: pack.category === "image-alt" ? (pack.image?.url ?? null) : null,
            generatedAt: new Date().toISOString(),
            model: opts.provider.model,
            promptVersion: PROMPT_VERSION,
            whatIsWrong: v.whatIsWrong,
            currentValue: currentValueFor(pack),
            recommendedValue: needsHumanInput ? "" : wrapRecommendedValue(pack, v.recommendedValuePlain),
            recommendedValuePlain: needsHumanInput ? "" : v.recommendedValuePlain,
            whyThisValue: v.whyThisValue,
            basedOn: v.basedOn,
            howToApply: v.howToApply,
            confidence: needsHumanInput ? 0 : outcome.confidence,
            selfReportedConfidence: v.selfReportedConfidence,
            needsHumanInput,
            needsHumanInputReason: needsHumanInput ? (v.needsHumanInputReason ?? `failed validation after retry: ${outcome.errors.join("; ")}`) : null,
            validation: outcome.validation,
            contentHash: page?.content?.contentHash ?? null,
            evidenceSig: evidenceSig(issue),
          });
        }
        consecutiveProviderFailures = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isVisionError = msg.toLowerCase().includes("image input") || msg.toLowerCase().includes("vision");
        if (!isVisionError) {
          consecutiveProviderFailures += 1;
          firstProviderFailure ??= err instanceof Error ? err : new Error(String(err));
        }
        console.error(`[AI Recs] AI call threw error for rule="${issue.ruleId}" on url="${issue.url}":`, msg);
        skipped.push({ ruleId: issue.ruleId, url: issue.url, pageId: issue.pageId, reason: `AI call failed: ${msg}` });
        if (consecutiveProviderFailures >= 3) {
          console.error(`[AI Recs] Provider threw 3 times in a row. Stopping generation gracefully to preserve partial progress.`);
          break;
        }
      }
    }

    if (consecutiveProviderFailures >= 3) break;
  }

  // Every model call failed and nothing was produced — the provider was down. Surface the real
  // error (the route turns it into a 5xx) instead of a misleading "0 recommendations" success.
  if (recommendations.length === 0 && firstProviderFailure) {
    throw firstProviderFailure;
  }

  return {
    runId: opts.analysis.runId,
    generatedAt: new Date().toISOString(),
    provider: opts.provider.name,
    model: opts.provider.model,
    promptVersion: PROMPT_VERSION,
    rulesConsidered: [...rulesConsidered],
    totalGenerated: recommendations.length,
    totalSkipped: skipped.length,
    totalReused: 0,
    recommendations,
    skipped,
  };
}

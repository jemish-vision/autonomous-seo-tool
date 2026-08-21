/**
 * Semantic checks JSON Schema can't express: length against the SAME thresholds the deterministic
 * rulebook uses, a conservative no-invented-facts check, and a banned-pattern filter. Ported
 * verbatim from poc/seo-dashboard/lib/ai-recommend/validators.ts (only the ./types import gained a
 * .js extension). Pure — no filesystem.
 */
import type { AiContextPack, AiRecommendationValidation, LengthConstraint } from "./types.js";

export interface ValidatedOutput {
  whatIsWrong: string;
  recommendedValuePlain: string;
  whyThisValue: string;
  basedOn: { field: string; value: string }[];
  howToApply: string;
  selfReportedConfidence: number | null;
  needsHumanInput: boolean;
  needsHumanInputReason: string | null;
}

export interface ValidationOutcome {
  ok: boolean;
  errors: string[];
  value: ValidatedOutput | null;
  validation: AiRecommendationValidation;
  confidence: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseShape(raw: unknown): { value: ValidatedOutput | null; errors: string[] } {
  const errors: string[] = [];
  if (!isPlainObject(raw)) return { value: null, errors: ["response was not a JSON object"] };

  const o = raw;
  if (typeof o.whatIsWrong !== "string" || !o.whatIsWrong.trim()) errors.push("whatIsWrong missing or empty");
  if (typeof o.whyThisValue !== "string" || !o.whyThisValue.trim()) errors.push("whyThisValue missing or empty");
  if (typeof o.howToApply !== "string" || !o.howToApply.trim()) errors.push("howToApply missing or empty");
  if (!Array.isArray(o.basedOn)) errors.push("basedOn missing or not an array");
  if (typeof o.needsHumanInput !== "boolean") errors.push("needsHumanInput missing or not a boolean");
  if (typeof o.recommendedValuePlain !== "string") errors.push("recommendedValuePlain missing or not a string");
  if (errors.length > 0) return { value: null, errors };

  const needsHumanInput = o.needsHumanInput as boolean;
  const recommendedValuePlain = (o.recommendedValuePlain as string).trim();
  if (!needsHumanInput && !recommendedValuePlain) {
    return { value: null, errors: ["recommendedValuePlain is empty but needsHumanInput is false — must either produce a value or abstain"] };
  }

  const basedOn = (o.basedOn as unknown[])
    .filter(isPlainObject)
    .map((e) => ({ field: String(e.field ?? "").trim(), value: String(e.value ?? "").trim() }))
    .filter((e) => e.field.length > 0);

  return {
    value: {
      whatIsWrong: (o.whatIsWrong as string).trim(),
      recommendedValuePlain,
      whyThisValue: (o.whyThisValue as string).trim(),
      basedOn,
      howToApply: (o.howToApply as string).trim(),
      selfReportedConfidence: typeof o.selfReportedConfidence === "number" ? o.selfReportedConfidence : null,
      needsHumanInput,
      needsHumanInputReason: typeof o.needsHumanInputReason === "string" ? o.needsHumanInputReason : null,
    },
    errors: [],
  };
}

const BANNED_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "image-of-prefix", pattern: /^(image|picture|photo)\s+of\b/i },
  { name: "click-here", pattern: /click here/i },
  { name: "lorem-ipsum", pattern: /lorem ipsum/i },
];

export function checkBannedPatterns(text: string): string | null {
  for (const { name, pattern } of BANNED_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

export function checkLength(text: string, c: LengthConstraint): boolean {
  if (c.minChars !== undefined && text.length < c.minChars) return false;
  if (c.maxChars !== undefined && text.length > c.maxChars) return false;
  return true;
}

/** Every number in the recommended text must appear somewhere in the grounding text (page context
 *  + the model's own cited basedOn values). The highest-value hallucination check. */
export function checkNoInventedFacts(recommendedText: string, groundingText: string): boolean {
  const grounding = groundingText.toLowerCase();
  const numbers = recommendedText.match(/\d+(\.\d+)?/g) ?? [];
  return numbers.every((n) => grounding.includes(n));
}

function groundingTextFor(pack: AiContextPack, basedOn: { field: string; value: string }[]): string {
  return [
    pack.pageTitle,
    pack.metaDescription,
    pack.h1.join(" "),
    pack.h2.join(" "),
    pack.h3.join(" "),
    pack.contentExcerpt,
    pack.topKeywords.join(" "),
    pack.social ? [...Object.values(pack.social.og), ...Object.values(pack.social.twitter)].join(" ") : null,
    pack.duplicatePeers?.map((p) => `${p.title ?? ""} ${p.contentExcerpt ?? ""}`).join(" "),
    pack.linkInfo ? `${pack.linkInfo.targetTitle ?? ""} ${pack.linkInfo.targetH1.join(" ")}` : null,
    basedOn.map((b) => b.value).join(" "),
  ]
    .filter((x): x is string => Boolean(x))
    .join(" \n ");
}

export function computeConfidence(v: AiRecommendationValidation, hasBasedOn: boolean): number {
  let score = 0.9;
  if (!v.lengthOk) score -= 0.3;
  if (!v.noInventedFacts) score -= 0.4;
  if (v.bannedPatternHit) score -= 0.2;
  if (!hasBasedOn) score -= 0.3;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

const NEUTRAL_VALIDATION: AiRecommendationValidation = { lengthOk: true, pixelWidthOk: null, noInventedFacts: true, schemaValid: true, bannedPatternHit: null };

const GUIDANCE_CATEGORIES = new Set(["content-brief", "duplicate-content-rewrite"]);

/**
 * Full validation: shape first, then — only for a non-abstaining answer — the semantic checks. A
 * model that validly abstains (needsHumanInput=true) skips semantic checks entirely.
 */
export function validateModelOutput(raw: unknown, pack: AiContextPack, lengthConstraint: LengthConstraint): ValidationOutcome {
  const { value, errors } = parseShape(raw);
  if (!value) {
    return { ok: false, errors, value: null, validation: { ...NEUTRAL_VALIDATION, lengthOk: false, noInventedFacts: false, schemaValid: false }, confidence: 0 };
  }

  if (value.needsHumanInput) {
    if (!value.needsHumanInputReason) {
      return {
        ok: false,
        errors: ["needsHumanInput is true but needsHumanInputReason is missing — must explain what's missing"],
        value,
        validation: NEUTRAL_VALIDATION,
        confidence: 0,
      };
    }
    return { ok: true, errors: [], value, validation: NEUTRAL_VALIDATION, confidence: 1 };
  }

  const text = value.recommendedValuePlain;
  const lengthOk = checkLength(text, lengthConstraint);
  const groundingText = groundingTextFor(pack, value.basedOn);
  const isGuidance = GUIDANCE_CATEGORIES.has(pack.category);
  const noInventedFacts = isGuidance ? true : checkNoInventedFacts(text, groundingText);
  const bannedPatternHit = checkBannedPatterns(text);

  const validation: AiRecommendationValidation = { lengthOk, pixelWidthOk: null, noInventedFacts, schemaValid: true, bannedPatternHit };

  const semanticErrors: string[] = [];
  if (!lengthOk) semanticErrors.push(`recommendedValuePlain length (${text.length} chars) violates the given constraint`);
  if (!noInventedFacts) semanticErrors.push("recommendedValuePlain contains a number not present in the given evidence/context — do not invent facts");
  if (bannedPatternHit) semanticErrors.push(`recommendedValuePlain matches a banned pattern: ${bannedPatternHit}`);
  if (value.basedOn.length === 0) semanticErrors.push("basedOn is empty — every recommendation must cite grounding evidence");

  const confidence = computeConfidence(validation, value.basedOn.length > 0);
  return { ok: semanticErrors.length === 0, errors: semanticErrors, value, validation, confidence };
}

/** Mirrors seo-crawler-poc/analysis.config.json's `thresholds` block. Keep in sync manually. */
export const RULEBOOK_THRESHOLDS = {
  titleMinChars: 30,
  titleMaxChars: 60,
  descMinChars: 70,
  descMaxChars: 155,
} as const;

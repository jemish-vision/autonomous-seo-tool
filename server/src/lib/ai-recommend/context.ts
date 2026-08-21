/**
 * Turns one (Issue, page(s)) into one or more AiContextPack objects — "how crawled data is fed to
 * the AI". Ported verbatim from poc/seo-dashboard/lib/ai-recommend/context.ts (the two type
 * imports were merged onto the local ./types.js). Pure and read-only over already-loaded run data
 * (no fs, no network) — the route supplies the page map.
 */
import type {
  AiContextPack,
  AiRecommendationCategory,
  CrawledPageWithId,
  Issue,
  LengthConstraint,
  PageIssueLite,
  PageSignals,
} from "./types.js";

/** Every rule id this module generates recommendations for, grouped by category. */
const CATEGORY_BY_RULE: Record<string, AiRecommendationCategory> = {
  "image-missing-alt": "image-alt",
  "image-empty-alt": "image-alt",

  "title-missing": "title",
  "title-too-short": "title",
  "title-too-long": "title",
  "title-multiple": "title",

  "meta-description-missing": "meta-description",
  "meta-description-too-short": "meta-description",
  "meta-description-too-long": "meta-description",
  "meta-description-multiple": "meta-description",

  "h1-missing": "heading",
  "h1-multiple": "heading",
  "heading-hierarchy-skip": "heading",
  "heading-empty": "heading",
  "title-h1-mismatch": "heading",
  "long-content-no-subheadings": "heading",

  "og-missing": "social",
  "twitter-missing": "social",
  "og-incomplete": "social",

  "duplicate-title": "duplicate-content",
  "duplicate-description": "duplicate-content",
  "exact-duplicate-content": "duplicate-content-rewrite",
  "near-duplicate-content": "duplicate-content-rewrite",

  "no-structured-data": "structured-data",
  "structured-data-missing-type": "structured-data",
  "structured-data-missing-required-property": "structured-data",
  "structured-data-missing-recommended-property": "structured-data",
  "structured-data-parse-error": "structured-data",
  "structured-data-type-mismatch": "structured-data",
  "structured-data-unknown-type": "structured-data",
  "structured-data-no-json-ld": "structured-data",
  "video-embed-without-schema": "structured-data",

  "canonical-mismatch": "canonical",
  "canonical-target-invalid": "canonical",
  "canonical-chain": "canonical",
  "canonical-changed-by-js": "canonical",

  "vague-anchor-text": "internal-link-anchor",

  "thin-content": "content-brief",
  "low-text-ratio": "content-brief",
  "zero-word-content": "content-brief",
  "low-readability": "content-brief",
};

export function categoryForRule(ruleId: string): AiRecommendationCategory | null {
  return CATEGORY_BY_RULE[ruleId] ?? null;
}

export function supportedRuleIds(): string[] {
  return Object.keys(CATEGORY_BY_RULE);
}

const CONTENT_EXCERPT_MAX_CHARS = 4000;
const TOP_KEYWORDS_COUNT = 8;

const STOPWORDS = new Set(
  (
    "a an the and or but if then else for of on in to with without at by from up down out about into over " +
    "under again further this that these those is are was were be been being have has had do does did " +
    "will would shall should can could may might must not no nor so than too very s t just don now our your " +
    "their his her its it we you they i he she them him us as it's you're we're they're"
  ).split(" "),
);

/** Cheap word-frequency proxy for "what is this page about". Never persisted, never shown as ground
 *  truth on its own. */
function topKeywords(text: string | null | undefined, n = TOP_KEYWORDS_COUNT): string[] {
  if (!text) return [];
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    const w = raw.replace(/^'+|'+$/g, "");
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

const CHROME_PREFIXES: RegExp[] = [
  /^blog\b/i,
  /^home\b/i,
  /^menu\b/i,
  /^search\b/i,
  /^consult\b/i,
  /^table of contents\b/i,
  /^let'?s talk\b/i,
  /^get in touch\b/i,
  /^about us\b/i,
];

function buildContentExcerpt(text: string | null | undefined, h1: string[]): string | null {
  if (!text) return null;
  const full = text.trim();
  let cleaned = full;
  const h1Text = h1.find((h) => h && h.trim())?.trim();
  if (h1Text) {
    const idx = cleaned.toLowerCase().indexOf(h1Text.toLowerCase());
    if (idx > 0) cleaned = cleaned.slice(idx).trim();
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of CHROME_PREFIXES) {
      if (re.test(cleaned)) {
        cleaned = cleaned.replace(re, "").trim();
        changed = true;
        break;
      }
    }
  }
  return (cleaned || full).slice(0, CONTENT_EXCERPT_MAX_CHARS);
}

function buildPageSignals(page: CrawledPageWithId): PageSignals {
  const images = page.images ?? [];
  const h4to6 = (page.structure?.headings ?? [])
    .filter((h) => h.level >= 4)
    .map((h) => ({ level: h.level, text: h.text }));
  return {
    statusCode: page.statusCode,
    canonical: page.canonical,
    noindex: page.robots?.noindex ?? false,
    nofollow: page.robots?.nofollow ?? false,
    metaRobots: page.robots?.meta ?? [],
    h4to6,
    internalLinkCount: (page.links ?? []).filter((l) => l.type === "internal").length,
    externalLinkCount: (page.links ?? []).filter((l) => l.type === "external").length,
    imageCount: images.length,
    imagesMissingAlt: images.filter((img) => !img.alt).length,
    structuredDataTypes: [...new Set(page.structuredData.flatMap((sd) => extractTypesFromParsed(sd.parsed)))],
    videoCount: page.videos?.length ?? 0,
    responseTimeMs: page.performance?.responseTimeMs ?? null,
    wordCount: page.content?.wordCount ?? null,
  };
}

const MAX_PAGE_ISSUES = 8;

function buildPageIssues(allIssues: Issue[] | undefined, current: Issue, page: CrawledPageWithId): PageIssueLite[] {
  if (!allIssues) return [];
  const out: PageIssueLite[] = [];
  for (const i of allIssues) {
    if (i.pageId !== page.pageId || i.ruleId === current.ruleId) continue;
    out.push({ ruleId: i.ruleId, category: i.category, severity: i.severity, message: i.message });
    if (out.length >= MAX_PAGE_ISSUES) break;
  }
  return out;
}

function baseContext(
  issue: Issue,
  page: CrawledPageWithId | null,
  category: AiRecommendationCategory,
  constraints: LengthConstraint,
  businessContext: Record<string, string> = {},
  allIssues?: Issue[],
  customKeywords?: string[],
): AiContextPack {
  return {
    ruleId: issue.ruleId,
    category,
    url: issue.url,
    pageId: issue.pageId,
    message: issue.message,
    evidence: issue.evidence,
    threshold: issue.threshold ?? null,
    pageTitle: page?.title ?? null,
    metaDescription: page?.metaDescription ?? null,
    h1: page?.headings.h1 ?? [],
    h2: page?.headings.h2 ?? [],
    h3: page?.headings.h3 ?? [],
    contentExcerpt: buildContentExcerpt(page?.content?.text, page?.headings.h1 ?? []),
    wordCount: page?.content?.wordCount ?? null,
    topKeywords: customKeywords && customKeywords.length > 0 ? customKeywords : topKeywords(page?.content?.text),
    businessContext,
    constraints,
    pageSignals: page ? buildPageSignals(page) : undefined,
    pageIssues: page ? buildPageIssues(allIssues, issue, page) : undefined,
  };
}

const IMAGE_ALT_EVIDENCE_FIELD = /^images\[(\d+)\]\.alt$/;

export interface ContextPackEntry {
  pack: AiContextPack;
  instanceKey: string | null;
}

export interface BuildContextOptions {
  constraints: LengthConstraint;
  pagesById: Map<string, CrawledPageWithId>;
  pagesByUrl: Map<string, CrawledPageWithId>;
  businessContext?: Record<string, string>;
  allIssues?: Issue[];
  pageKeywords?: string[];
}

/**
 * Returns [] (never throws) when the rule is recognized but there's no page record — or no
 * resolvable evidence — to build real context from. Never fabricates a pack from evidence alone.
 */
export function buildContextPacks(issue: Issue, page: CrawledPageWithId | null, opts: BuildContextOptions): ContextPackEntry[] {
  const category = categoryForRule(issue.ruleId);
  if (!category) return [];

  if (category === "image-alt") {
    if (!page) return [];
    const entries: ContextPackEntry[] = [];
    for (const ev of issue.evidence) {
      const match = IMAGE_ALT_EVIDENCE_FIELD.exec(ev.field);
      if (!match) continue;
      const idx = Number(match[1]);
      const img = page.images[idx];
      if (!img) continue;
      entries.push({
        instanceKey: `images[${idx}]`,
        pack: {
          ...baseContext(issue, page, category, {}, opts.businessContext, opts.allIssues, opts.pageKeywords),
          image: { url: img.url, width: img.width, height: img.height, format: img.format, context: img.context, imageDataUrl: null },
        },
      });
    }
    return entries;
  }

  if (!page) return [];

  if (category === "social") {
    return [
      {
        instanceKey: null,
        pack: {
          ...baseContext(issue, page, category, {}, opts.businessContext, opts.allIssues, opts.pageKeywords),
          social: { og: page.headMeta?.og ?? {}, twitter: page.headMeta?.twitter ?? {} },
        },
      },
    ];
  }

  if (category === "structured-data") {
    const existingTypes = [...new Set(page.structuredData.flatMap((sd) => extractTypesFromParsed(sd.parsed)))];
    return [
      {
        instanceKey: null,
        pack: {
          ...baseContext(issue, page, category, {}, opts.businessContext, opts.allIssues, opts.pageKeywords),
          structuredData: {
            existingTypes,
            missingRequired: stringEvidenceList(issue, "missingRequired"),
            missingRecommended: stringEvidenceList(issue, "missingRecommended"),
            rawBlocks: rawEvidenceStrings(issue),
            errors: errorEvidenceStrings(issue),
          },
        },
      },
    ];
  }

  if (category === "duplicate-content" || category === "duplicate-content-rewrite") {
    const peerPageIds = issue.evidence.map((e) => e.pageId).filter((id): id is string => Boolean(id) && id !== issue.pageId);
    const peers = [...new Set(peerPageIds)]
      .map((id) => opts.pagesById.get(id))
      .filter((p): p is CrawledPageWithId => Boolean(p))
      .map((p) => ({ url: p.url, title: p.title, contentExcerpt: p.content?.text ? p.content.text.slice(0, 500) : null }));
    return [{ instanceKey: null, pack: { ...baseContext(issue, page, category, {}, opts.businessContext, opts.allIssues, opts.pageKeywords), duplicatePeers: peers } }];
  }

  if (category === "canonical") {
    return [
      {
        instanceKey: null,
        pack: {
          ...baseContext(issue, page, category, {}, opts.businessContext, opts.allIssues, opts.pageKeywords),
          canonicalInfo: { currentCanonical: page.canonical, selfUrl: page.finalUrl ?? page.url },
        },
      },
    ];
  }

  if (category === "internal-link-anchor") {
    const targetField = issue.evidence.find((e) => e.field === "links" || e.field.startsWith("links["));
    const targetUrl = typeof targetField?.value === "string" ? targetField.value : null;
    const currentAnchorField = issue.evidence.find((e) => e.field.endsWith(".anchor"));
    const currentAnchor = typeof currentAnchorField?.value === "string" ? currentAnchorField.value : "";
    const targetPage = targetUrl ? (opts.pagesByUrl.get(normalizeForLookup(targetUrl)) ?? null) : null;
    if (!targetPage) {
      return [];
    }
    return [
      {
        instanceKey: null,
        pack: {
          ...baseContext(issue, page, category, {}, opts.businessContext, opts.allIssues, opts.pageKeywords),
          linkInfo: { currentAnchor, targetUrl: targetPage.url, targetTitle: targetPage.title, targetH1: targetPage.headings.h1 },
        },
      },
    ];
  }

  // title / meta-description / heading: the page record itself IS the evidence.
  return [{ instanceKey: null, pack: baseContext(issue, page, category, opts.constraints, opts.businessContext, opts.allIssues, opts.pageKeywords) }];
}

function stringEvidenceList(issue: Issue, field: string): string[] {
  const ev = issue.evidence.find((e) => e.field === field);
  if (!ev) return [];
  if (Array.isArray(ev.value)) return ev.value.map((v) => String(v));
  if (typeof ev.value === "string") return [ev.value];
  return [];
}

function rawEvidenceStrings(issue: Issue): string[] {
  const out: string[] = [];
  for (const e of issue.evidence) {
    if (/raw/i.test(e.field) && typeof e.value === "string" && e.value.trim()) out.push(e.value.trim());
  }
  return out;
}

function errorEvidenceStrings(issue: Issue): string[] {
  const out: string[] = [];
  for (const e of issue.evidence) {
    if (/(error|parse)/i.test(e.field) && typeof e.value === "string" && e.value.trim()) out.push(e.value.trim());
  }
  return out;
}

function extractTypesFromParsed(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object") return [];
  const type = (parsed as Record<string, unknown>)["@type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === "string");
  return [];
}

function normalizeForLookup(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function buildUrlIndex(pages: CrawledPageWithId[]): Map<string, CrawledPageWithId> {
  const map = new Map<string, CrawledPageWithId>();
  for (const p of pages) {
    map.set(normalizeForLookup(p.url), p);
    if (p.finalUrl) map.set(normalizeForLookup(p.finalUrl), p);
    map.set(normalizeForLookup(p.normalizedUrl), p);
  }
  return map;
}

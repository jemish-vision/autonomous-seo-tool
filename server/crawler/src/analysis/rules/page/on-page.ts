/** Title / meta description / heading rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { capturedList, issueFor } from "./shared";

const isBlank = (s: string | null): boolean => s === null || s.trim() === "";

/* Screaming Frog's published minimums, used when a config predates these thresholds. */
const DEFAULT_TITLE_MIN_PX = 200;
const DEFAULT_DESC_MIN_PX = 400;
const DEFAULT_URL_MAX_CHARS = 115;

function urlTooLong(): PageRule {
  const meta: RuleMeta = {
    id: "url-too-long",
    category: "on-page",
    defaultSeverity: "notice",
    description: "URL exceeds the configured maximum character length (Screaming Frog flags over 115).",
    howToFix: "Shorten the URL slug; long URLs are truncated in search results and harder to share.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const url = page.normalizedUrl ?? page.url;
      const max = config.thresholds.urlMaxChars ?? DEFAULT_URL_MAX_CHARS;
      if (url.length <= max) return [];
      return [
        issueFor(meta, config, page, {
          message: `URL is ${url.length} characters.`,
          evidence: [{ field: "normalizedUrl", value: url }],
          threshold: `url ${url.length} chars > max ${max}`,
        }),
      ];
    },
  };
}

function titleMissing(): PageRule {
  const meta: RuleMeta = {
    id: "title-missing",
    category: "on-page",
    defaultSeverity: "error",
    description: "Page has no <title> tag (or it is empty).",
    howToFix: "Add a unique, descriptive <title> tag between the configured min/max length.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!isBlank(page.title)) return [];
      return [issueFor(meta, config, page, { message: "Title is missing.", evidence: [{ field: "title", value: page.title }] })];
    },
  };
}

function titleTooShort(): PageRule {
  const meta: RuleMeta = {
    id: "title-too-short",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Title is shorter than the configured minimum length.",
    howToFix: "Expand the title to fall within the configured char/pixel-width range.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (isBlank(page.title)) return []; // covered by title-missing
      const len = page.title!.length;
      const px = page.pixelWidths?.titlePx ?? null;
      const minPx = config.thresholds.titleMinPx ?? DEFAULT_TITLE_MIN_PX;
      const underChars = len < config.thresholds.titleMinChars;
      // Pixel width is the real SERP constraint: "IIII" and "WWWW" are the same char count.
      const underPx = px !== null && px < minPx;
      if (!underChars && !underPx) return [];
      const parts: string[] = [];
      if (underChars) parts.push(`title ${len} chars < min ${config.thresholds.titleMinChars}`);
      if (underPx) parts.push(`title ~${px}px < min ${minPx}px`);
      return [
        issueFor(meta, config, page, {
          message: underChars ? `Title is only ${len} characters.` : `Title is only ~${px}px wide.`,
          evidence: [
            { field: "title", value: page.title },
            ...(px !== null ? [{ field: "pixelWidths.titlePx", value: px }] : []),
          ],
          threshold: parts.join("; "),
        }),
      ];
    },
  };
}

function titleTooLong(): PageRule {
  const meta: RuleMeta = {
    id: "title-too-long",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Title exceeds the configured maximum length (char count and/or estimated pixel width).",
    howToFix: "Shorten the title so it is not truncated in search results.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (isBlank(page.title)) return [];
      const len = page.title!.length;
      const px = page.pixelWidths?.titlePx ?? null;
      const overChars = len > config.thresholds.titleMaxChars;
      const overPx = px !== null && px > config.thresholds.titleMaxPx;
      if (!overChars && !overPx) return [];
      const parts: string[] = [];
      if (overChars) parts.push(`title ${len} chars > max ${config.thresholds.titleMaxChars}`);
      if (overPx) parts.push(`title ~${px}px > max ${config.thresholds.titleMaxPx}px`);
      return [
        issueFor(meta, config, page, {
          message: `Title is too long (${len} characters).`,
          evidence: [
            { field: "title", value: page.title },
            ...(px !== null ? [{ field: "pixelWidths.titlePx", value: px }] : []),
          ],
          threshold: parts.join("; "),
        }),
      ];
    },
  };
}

function titleMultiple(): PageRule {
  const meta: RuleMeta = {
    id: "title-multiple",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Page markup contains more than one <title> tag.",
    howToFix: "Keep exactly one <title> tag in <head>.",
    dataRequirements: ["titles"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.titles === undefined) return null;
      if (page.titles.length <= 1) return [];
      return [
        issueFor(meta, config, page, {
          message: `${page.titles.length} <title> tags found on this page.`,
          evidence: [{ field: "titles", value: page.titles }],
        }),
      ];
    },
  };
}

function descMissing(): PageRule {
  const meta: RuleMeta = {
    id: "meta-description-missing",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Page has no meta description (or it is empty).",
    howToFix: "Add a unique meta description within the configured char/pixel-width range.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (!isBlank(page.metaDescription)) return [];
      return [
        issueFor(meta, config, page, {
          message: "Meta description is missing.",
          evidence: [{ field: "metaDescription", value: page.metaDescription }],
        }),
      ];
    },
  };
}

function descTooShort(): PageRule {
  const meta: RuleMeta = {
    id: "meta-description-too-short",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Meta description is shorter than the configured minimum length.",
    howToFix: "Expand the meta description to fall within the configured char/pixel-width range.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (isBlank(page.metaDescription)) return [];
      const len = page.metaDescription!.length;
      const px = page.pixelWidths?.metaDescriptionPx ?? null;
      const minPx = config.thresholds.descMinPx ?? DEFAULT_DESC_MIN_PX;
      const underChars = len < config.thresholds.descMinChars;
      const underPx = px !== null && px < minPx;
      if (!underChars && !underPx) return [];
      const parts: string[] = [];
      if (underChars) parts.push(`description ${len} chars < min ${config.thresholds.descMinChars}`);
      if (underPx) parts.push(`description ~${px}px < min ${minPx}px`);
      return [
        issueFor(meta, config, page, {
          message: underChars ? `Meta description is only ${len} characters.` : `Meta description is only ~${px}px wide.`,
          evidence: [
            { field: "metaDescription", value: page.metaDescription },
            ...(px !== null ? [{ field: "pixelWidths.metaDescriptionPx", value: px }] : []),
          ],
          threshold: parts.join("; "),
        }),
      ];
    },
  };
}

function descTooLong(): PageRule {
  const meta: RuleMeta = {
    id: "meta-description-too-long",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Meta description exceeds the configured maximum length (char count and/or estimated pixel width).",
    howToFix: "Shorten the meta description so it is not truncated in search results.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (isBlank(page.metaDescription)) return [];
      const len = page.metaDescription!.length;
      const px = page.pixelWidths?.metaDescriptionPx ?? null;
      const overChars = len > config.thresholds.descMaxChars;
      const overPx = px !== null && px > config.thresholds.descMaxPx;
      if (!overChars && !overPx) return [];
      const parts: string[] = [];
      if (overChars) parts.push(`description ${len} chars > max ${config.thresholds.descMaxChars}`);
      if (overPx) parts.push(`description ~${px}px > max ${config.thresholds.descMaxPx}px`);
      return [
        issueFor(meta, config, page, {
          message: `Meta description is too long (${len} characters).`,
          evidence: [{ field: "metaDescription", value: page.metaDescription }],
          threshold: parts.join("; "),
        }),
      ];
    },
  };
}

function descMultiple(): PageRule {
  const meta: RuleMeta = {
    id: "meta-description-multiple",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Page markup contains more than one meta description tag.",
    howToFix: "Keep exactly one meta description tag in <head>.",
    dataRequirements: ["metaDescriptions"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.metaDescriptions === undefined) return null;
      if (page.metaDescriptions.length <= 1) return [];
      return [
        issueFor(meta, config, page, {
          message: `${page.metaDescriptions.length} meta description tags found on this page.`,
          evidence: [{ field: "metaDescriptions", value: page.metaDescriptions }],
        }),
      ];
    },
  };
}

function h1Missing(): PageRule {
  const meta: RuleMeta = {
    id: "h1-missing",
    category: "on-page",
    defaultSeverity: "warning",
    description: "Page has no H1 heading.",
    howToFix: "Add a single, descriptive H1 that reflects the page's primary topic.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.headings.h1.length > 0) return [];
      return [issueFor(meta, config, page, { message: "No H1 heading found.", evidence: [{ field: "headings.h1", value: [] }] })];
    },
  };
}

function h1Multiple(): PageRule {
  const meta: RuleMeta = {
    id: "h1-multiple",
    category: "on-page",
    defaultSeverity: "notice",
    description: "Page has more than one H1 heading.",
    howToFix: "Keep a single H1 per page; demote extras to H2/H3.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.headings.h1.length <= 1) return [];
      return [
        issueFor(meta, config, page, {
          message: `${page.headings.h1.length} H1 headings found.`,
          evidence: [{ field: "headings.h1", value: page.headings.h1 }],
        }),
      ];
    },
  };
}

function headingHierarchySkip(): PageRule {
  const meta: RuleMeta = {
    id: "heading-hierarchy-skip",
    category: "on-page",
    defaultSeverity: "notice",
    description:
      "The heading outline jumps down more than one level (H2 to H4, or a first heading below H2). " +
      "Uses the full document-order sequence from structure.headings when captured; pre-v3 runs fall back to the " +
      "h1/h2/h3 buckets, which can only see the H3-with-no-H2 case.",
    howToFix: "Insert the intermediate headings so the outline steps down one level at a time.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const sequence = page.structure?.headings;
      if (!capturedList(sequence)) {
        if (page.headings.h3.length === 0 || page.headings.h2.length > 0) return [];
        return [
          issueFor(meta, config, page, {
            message: "H3 headings present with no H2 — heading hierarchy skips a level.",
            evidence: [
              { field: "headings.h2", value: page.headings.h2 },
              { field: "headings.h3", value: page.headings.h3 },
            ],
          }),
        ];
      }

      // The document's implied starting level is H1, so a first heading of H3+ is itself a skip.
      const skips = sequence
        .map((heading, i) => ({ heading, i, from: i === 0 ? 1 : sequence[i - 1]!.level }))
        .filter(({ heading, from }) => heading.level - from > 1);
      if (skips.length === 0) return [];
      const described = skips.slice(0, 5).map(({ heading, from }) => `H${from} to H${heading.level} ("${heading.text.slice(0, 40)}")`);
      return [
        issueFor(meta, config, page, {
          message: `Heading outline skips ${skips.length} level transition(s): ${described.join("; ")}${skips.length > described.length ? ", …" : ""}.`,
          evidence: skips.map(({ heading, i }) => ({ field: `structure.headings[${i}].level`, value: heading.level })),
        }),
      ];
    },
  };
}

function headingEmpty(): PageRule {
  const meta: RuleMeta = {
    id: "heading-empty",
    category: "on-page",
    defaultSeverity: "notice",
    description: "A heading tag (H1-H6) is present in document order but carries no text.",
    howToFix: "Remove the empty heading, or give it text — an empty heading breaks the outline and contributes nothing.",
    dataRequirements: ["structure.headings"],
  };
  return {
    meta,
    evaluate(page, config) {
      const sequence = page.structure?.headings;
      if (!capturedList(sequence)) return null;
      const empties = sequence
        .map((h, i) => ({ h, i }))
        .filter(({ h }) => h.text.trim() === "");
      if (empties.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${empties.length} empty heading tag(s): ${empties.slice(0, 3).map(({ h }) => `<h${h.level}>`).join(", ")}${empties.length > 3 ? ", …" : ""}.`,
          evidence: empties.slice(0, 5).map(({ i }) => ({ field: `structure.headings[${i}].text`, value: "" })),
        }),
      ];
    },
  };
}

/* Kishan's rules.js 'title-h1-mismatch': needs at least 2 "significant" (>=4 char) words on
 * each side to judge either way — otherwise a short title/H1 too easily has zero legitimate overlap. */
const SIGNIFICANT_WORD_MIN_LEN = 4;
function significantWords(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => w.length >= SIGNIFICANT_WORD_MIN_LEN));
}

function titleH1Mismatch(): PageRule {
  const meta: RuleMeta = {
    id: "title-h1-mismatch",
    category: "on-page",
    defaultSeverity: "notice",
    description: "Title and H1 share no significant word — the search-result headline and the page's own heading describe different things.",
    howToFix: "Keep the same subject in both. They need not match word for word — they should agree.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (isBlank(page.title) || page.headings.h1.length === 0) return [];
      const t = significantWords(page.title!);
      const h = significantWords(page.headings.h1[0]!);
      if (t.size < 2 || h.size < 2) return []; // too short on either side to judge
      const overlap = [...h].some((w) => t.has(w));
      if (overlap) return [];
      return [
        issueFor(meta, config, page, {
          message: `Title and H1 share no significant word: title "${page.title}" vs H1 "${page.headings.h1[0]}".`,
          evidence: [
            { field: "title", value: page.title },
            { field: "headings.h1", value: page.headings.h1 },
          ],
        }),
      ];
    },
  };
}

function longContentNoSubheadings(): PageRule {
  const meta: RuleMeta = {
    id: "long-content-no-subheadings",
    category: "on-page",
    defaultSeverity: "notice",
    description: "Content is long enough to need breaking up, but the page has at most one H2/H3 subheading.",
    howToFix: "Break the copy into sections with descriptive H2/H3 subheadings.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const minWords = config.thresholds.longContentNoSubheadingsWords ?? 300;
      if (page.content.wordCount <= minWords) return [];
      const subheadings = page.headings.h2.length + page.headings.h3.length;
      if (subheadings > 1) return [];
      return [
        issueFor(meta, config, page, {
          message: `${page.content.wordCount} words with only ${subheadings} subheading(s) (H2+H3) to break it up.`,
          evidence: [
            { field: "content.wordCount", value: page.content.wordCount },
            { field: "headings.h2", value: page.headings.h2 },
            { field: "headings.h3", value: page.headings.h3 },
          ],
          threshold: `wordCount ${page.content.wordCount} > min ${minWords}, subheadings ${subheadings} <= 1`,
        }),
      ];
    },
  };
}

export function onPageRules(): PageRule[] {
  return [
    urlTooLong(),
    titleMissing(),
    titleTooShort(),
    titleTooLong(),
    titleMultiple(),
    descMissing(),
    descTooShort(),
    descTooLong(),
    descMultiple(),
    h1Missing(),
    h1Multiple(),
    headingHierarchySkip(),
    headingEmpty(),
    titleH1Mismatch(),
    longContentNoSubheadings(),
  ];
}

/** Thin content / text-ratio rule pack. */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { issueFor } from "./shared";

function thinContent(): PageRule {
  const meta: RuleMeta = {
    id: "thin-content",
    category: "content",
    defaultSeverity: "warning", // heuristic (MF-5): threshold-based, never error
    description: "Page's extracted text is below the configured word-count threshold.",
    howToFix: "Add substantive, unique content, or noindex the page if it's intentionally minimal (e.g. a utility page).",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.content.wordCount >= config.thresholds.thinContentWords) return [];
      return [
        issueFor(meta, config, page, {
          message: `Page has only ${page.content.wordCount} words of extracted content.`,
          evidence: [{ field: "content.wordCount", value: page.content.wordCount }],
          threshold: `wordCount ${page.content.wordCount} < min ${config.thresholds.thinContentWords}`,
        }),
      ];
    },
  };
}

function lowTextRatio(): PageRule {
  const meta: RuleMeta = {
    id: "low-text-ratio",
    category: "content",
    defaultSeverity: "notice", // heuristic (MF-5): threshold-based, never error
    description: "Visible text is a small fraction of total HTML bytes — markup-heavy / content-light page.",
    howToFix: "Reduce boilerplate markup or add more substantive content.",
    dataRequirements: ["pageStats"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.pageStats === undefined) return null;
      if (page.pageStats.textRatio >= config.thresholds.lowTextRatio) return [];
      return [
        issueFor(meta, config, page, {
          message: `Text-to-HTML ratio is ${(page.pageStats.textRatio * 100).toFixed(1)}%.`,
          evidence: [{ field: "pageStats.textRatio", value: page.pageStats.textRatio }],
          threshold: `textRatio ${page.pageStats.textRatio.toFixed(3)} < min ${config.thresholds.lowTextRatio}`,
        }),
      ];
    },
  };
}

function zeroWordContent(): PageRule {
  const meta: RuleMeta = {
    id: "zero-word-content",
    category: "content",
    defaultSeverity: "error", // deterministic fact (MF-5), not a threshold judgment call — matches title-missing's class
    description: "Page has zero words of extracted content — genuinely empty, not merely thin.",
    howToFix: "Add content, or noindex the page if it's intentionally blank (e.g. a redirect stub or a utility page).",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.content.wordCount > 0) return [];
      return [
        issueFor(meta, config, page, {
          message: "Page has zero words of extracted content.",
          evidence: [{ field: "content.wordCount", value: 0 }],
        }),
      ];
    },
  };
}

// Below this word count the words-per-sentence / syllables-per-word ratios are too noisy to
// trust — a 20-word nav blurb can score "postgraduate" on one long sentence. POC judgment call,
// set above thinContentWords so a page already flagged thin isn't double-penalized here too.
const READABILITY_MIN_WORDS = 100;
const DEFAULT_FLESCH_MIN = 30; // Jemish: ease < 30 = "very hard — postgraduate"

function lowReadability(): PageRule {
  const meta: RuleMeta = {
    id: "low-readability",
    category: "content",
    defaultSeverity: "notice", // heuristic (MF-5): threshold-based, never error
    description:
      'Body text scores below 30 on the Flesch Reading Ease scale ("very hard — postgraduate" reading level), read ' +
      "from the extraction layer's content.readability (src/extraction/readability.ts). Restricted to pages the " +
      "extractor classified as a genuine <article> — spot-checking against real crawl data showed a category/listing " +
      'page (contentAreaMethod "body-minus-chrome", e.g. a genre-navigation strip glued to a product grid) mechanically ' +
      "scores as unreadable without being prose at all: dozens of short polysyllabic category names with almost no " +
      "sentence structure tank the formula. <article> is the only signal available, without a grammar pass, that the " +
      "extracted text is actually authored copy.",
    howToFix: "Shorten sentences and prefer plainer, shorter words.",
    dataRequirements: ["content.contentAreaMethod", "content.readability"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.content.contentAreaMethod === undefined || page.content.readability === undefined) return null;
      if (page.content.contentAreaMethod !== "article") return [];
      if (page.content.wordCount < READABILITY_MIN_WORDS) return [];
      const ease = page.content.readability.fleschReadingEase;
      if (ease === null) return [];
      const min = config.thresholds.fleschReadingEaseMin ?? DEFAULT_FLESCH_MIN;
      if (ease >= min) return [];
      return [
        issueFor(meta, config, page, {
          message: `Flesch Reading Ease is ${ease.toFixed(1)} (below ${min}) — very hard to read.`,
          evidence: [
            { field: "content.wordCount", value: page.content.wordCount },
            { field: "content.readability.fleschReadingEase", value: ease },
          ],
          threshold: `Flesch Reading Ease ${ease.toFixed(1)} < min ${min}`,
        }),
      ];
    },
  };
}

export function contentRules(): PageRule[] {
  return [thinContent(), lowTextRatio(), zeroWordContent(), lowReadability()];
}

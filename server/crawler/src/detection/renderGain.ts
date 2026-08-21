/** Render keep/discard gain test. Fixes crawl.ts's unconditional overwrite (a render that adds
 * nothing used to replace a good static capture). Compares six signals — text, links, images,
 * headings, meta tags, JSON-LD blocks — so an image-led page that builds layout in JS without
 * adding a word still keeps its render (any ONE signal firing is enough to keep the rendered
 * capture). Pure and dependency-free so the decision itself is unit-testable without a browser. */
import type { ExtractionResult } from "../models/types";

/** Ignore noise-level word-count deltas (whitespace/formatting differences between a static parse
 * and a rendered DOM commonly shift word count by a handful even with no real content change). */
const MIN_WORD_GAIN = 10;

export interface RenderGainSignals {
  text: boolean;
  links: boolean;
  images: boolean;
  headings: boolean;
  metaTags: boolean;
  jsonLd: boolean;
}

export interface RenderGainDecision {
  keep: "rendered" | "static";
  gained: boolean;
  signals: RenderGainSignals;
  /** Compact, greppable reasons for CrawlPage.renderSignals — e.g. "render-gain:text+45w". */
  reasons: string[];
}

function countHeadings(ext: ExtractionResult): number {
  return ext.headings.h1.length + ext.headings.h2.length + ext.headings.h3.length;
}

function countImages(ext: ExtractionResult): number {
  return ext.images.length + (ext.backgroundImages?.length ?? 0);
}

function countInternalLinks(ext: ExtractionResult): number {
  return ext.links.filter((l) => l.type === "internal").length;
}

/**
 * Compares a static (Cheerio) capture against its Playwright-rendered counterpart across six
 * signals. `gained` is true the moment any single signal fires — matches Kishan's framing: an
 * image-led page that adds zero words but three new images still keeps its render.
 */
export function evaluateRenderGain(
  staticExtraction: ExtractionResult,
  renderedExtraction: ExtractionResult,
): RenderGainDecision {
  const reasons: string[] = [];

  const staticWords = staticExtraction.content.wordCount;
  const renderedWords = renderedExtraction.content.wordCount;
  const wordDelta = renderedWords - staticWords;
  const text = wordDelta >= MIN_WORD_GAIN;
  if (text) reasons.push(`render-gain:text+${wordDelta}w`);

  const staticLinks = countInternalLinks(staticExtraction);
  const renderedLinks = countInternalLinks(renderedExtraction);
  const links = renderedLinks > staticLinks;
  if (links) reasons.push(`render-gain:links+${renderedLinks - staticLinks}`);

  const staticImages = countImages(staticExtraction);
  const renderedImages = countImages(renderedExtraction);
  const images = renderedImages > staticImages;
  if (images) reasons.push(`render-gain:images+${renderedImages - staticImages}`);

  const staticHeadings = countHeadings(staticExtraction);
  const renderedHeadings = countHeadings(renderedExtraction);
  const headings = renderedHeadings > staticHeadings;
  if (headings) reasons.push(`render-gain:headings+${renderedHeadings - staticHeadings}`);

  const metaTags =
    (!staticExtraction.title && !!renderedExtraction.title) ||
    (!staticExtraction.metaDescription && !!renderedExtraction.metaDescription) ||
    (!staticExtraction.canonical && !!renderedExtraction.canonical);
  if (metaTags) reasons.push("render-gain:meta-tags");

  const staticJsonLd = staticExtraction.structuredData.length;
  const renderedJsonLd = renderedExtraction.structuredData.length;
  const jsonLd = renderedJsonLd > staticJsonLd;
  if (jsonLd) reasons.push(`render-gain:json-ld+${renderedJsonLd - staticJsonLd}`);

  const signals: RenderGainSignals = { text, links, images, headings, metaTags, jsonLd };
  const gained = Object.values(signals).some(Boolean);

  return {
    keep: gained ? "rendered" : "static",
    gained,
    signals,
    reasons: gained ? reasons : ["render-gain:kept-static"],
  };
}

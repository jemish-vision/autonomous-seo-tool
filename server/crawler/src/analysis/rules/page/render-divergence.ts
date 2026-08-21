/** Raw-vs-rendered indexing conflicts. We already stored both renders and never read them —
 * gap surfaced by the claude-seo teardown (research/competitor-claude-seo.md §4). */
import type { RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { captured, issueFor } from "./shared";

function jsAppliedNoindex(): PageRule {
  const meta: RuleMeta = {
    id: "js-applied-noindex",
    category: "indexability",
    defaultSeverity: "error",
    description:
      "The raw HTML is indexable but the rendered DOM adds noindex — JavaScript is deindexing the " +
      "page. Google indexes the rendered result, so the page drops out despite the source looking fine.",
    howToFix: "Remove the noindex your client-side code injects, or serve the correct directive in the raw HTML.",
    dataRequirements: ["renderDivergence"],
  };
  return {
    meta,
    evaluate(page, config) {
      const d = page.renderDivergence;
      if (!d || d.staticNoindex === undefined || d.renderedNoindex === undefined) return null;
      if (!(d.staticNoindex === false && d.renderedNoindex === true)) return [];
      return [
        issueFor(meta, config, page, {
          message: "Raw HTML is indexable but the rendered page is noindex — JavaScript is deindexing it.",
          evidence: [
            { field: "renderDivergence.staticNoindex", value: d.staticNoindex },
            { field: "renderDivergence.renderedNoindex", value: d.renderedNoindex },
          ],
        }),
      ];
    },
  };
}

function noindexInRawHtmlOnly(): PageRule {
  const meta: RuleMeta = {
    id: "noindex-in-raw-html-only",
    category: "indexability",
    defaultSeverity: "error",
    description:
      "The raw HTML says noindex and only the rendered DOM removes it. Googlebot may drop the page " +
      "before it ever renders, so the client-side correction is never seen — the opposite direction " +
      "of js-applied-noindex, and a different fix.",
    howToFix: "Serve the page without noindex in the raw HTML; do not rely on JavaScript to remove it.",
    dataRequirements: ["renderDivergence"],
  };
  return {
    meta,
    evaluate(page, config) {
      const d = page.renderDivergence;
      if (!d || d.staticNoindex === undefined || d.renderedNoindex === undefined) return null;
      if (!(d.staticNoindex === true && d.renderedNoindex === false)) return [];
      return [
        issueFor(meta, config, page, {
          message: "Raw HTML is noindex and only JavaScript removes it — Google may never render this page.",
          evidence: [
            { field: "renderDivergence.staticNoindex", value: d.staticNoindex },
            { field: "renderDivergence.renderedNoindex", value: d.renderedNoindex },
          ],
        }),
      ];
    },
  };
}

function canonicalChangedByJs(): PageRule {
  const meta: RuleMeta = {
    id: "canonical-changed-by-js",
    category: "canonical",
    defaultSeverity: "warning",
    description:
      "The canonical URL differs between the raw HTML and the rendered DOM. Google uses the rendered " +
      "value, so the raw one is misleading, and a canonical that only appears after render is at the " +
      "mercy of the render queue.",
    howToFix: "Serve one consistent canonical in the raw HTML rather than rewriting it client-side.",
    dataRequirements: ["renderDivergence"],
  };
  return {
    meta,
    evaluate(page, config) {
      const d = page.renderDivergence;
      if (!d || d.staticCanonical === undefined || d.renderedCanonical === undefined) return null;
      if (d.staticCanonical === d.renderedCanonical) return [];
      const appeared = d.staticCanonical === null && d.renderedCanonical !== null;
      const removed = d.staticCanonical !== null && d.renderedCanonical === null;
      const detail = appeared
        ? "canonical only exists after rendering"
        : removed
          ? "canonical is removed by rendering"
          : "canonical points somewhere else after rendering";
      return [
        issueFor(meta, config, page, {
          message: `Canonical differs between raw and rendered HTML — ${detail}.`,
          evidence: [
            { field: "renderDivergence.staticCanonical", value: d.staticCanonical },
            { field: "renderDivergence.renderedCanonical", value: d.renderedCanonical },
          ],
        }),
      ];
    },
  };
}

/** Fraction of the rendered word count that must be JS-only before the page counts as
 * render-dependent, used when a config predates this threshold. */
const DEFAULT_JS_ONLY_CONTENT_RATIO = 0.5;

function contentRequiresJavascript(): PageRule {
  const meta: RuleMeta = {
    id: "content-requires-javascript",
    category: "indexability",
    defaultSeverity: "warning",
    description:
      "Most of the page's body copy exists only after JavaScript runs. Google renders eventually but on a separate, slower queue, and most other crawlers " +
      "(Bing's fallback, LLM fetchers, social unfurlers) never render at all — they see the near-empty raw HTML.",
    howToFix: "Server-render or pre-render the primary content so it is present in the raw HTML response.",
    dataRequirements: ["renderDivergence", "content.wordCount"],
  };
  return {
    meta,
    evaluate(page, config) {
      const divergence = page.renderDivergence;
      if (!captured(divergence, "wordCountDelta") || !captured(page.content, "wordCount")) return null;
      const rendered = page.content.wordCount;
      const jsOnly = divergence.wordCountDelta;
      if (rendered <= 0 || jsOnly <= 0) return [];
      const ratio = jsOnly / rendered;
      const minRatio = config.thresholds.jsOnlyContentRatio ?? DEFAULT_JS_ONLY_CONTENT_RATIO;
      // The absolute floor stops a 10-word page with an 8-word JS addition from clearing the ratio.
      if (ratio < minRatio || jsOnly < config.thresholds.thinContentWords) return [];
      return [
        issueFor(meta, config, page, {
          message: `${Math.round(ratio * 100)}% of the page's ${rendered} words (${jsOnly}) are absent from the raw HTML and only appear after rendering.`,
          evidence: [
            { field: "renderDivergence.wordCountDelta", value: jsOnly },
            { field: "content.wordCount", value: rendered },
            { field: "renderSignals", value: page.renderSignals },
          ],
          threshold: `JS-only share ${ratio.toFixed(2)} >= ${minRatio} and ${jsOnly} JS-only words >= ${config.thresholds.thinContentWords}`,
        }),
      ];
    },
  };
}

/**
 * Adapted from Kishan's "renders produced nothing new" (their site-level renderDiscards
 * aggregate; we only have per-page divergence, so this is the per-page equivalent). A page that
 * paid the cost of a full browser render but whose measured divergence shows no gain anywhere —
 * words, links, title, description, canonical, noindex — got nothing for the render.
 */
function renderAddedNothing(): PageRule {
  const meta: RuleMeta = {
    id: "render-added-nothing",
    category: "performance",
    defaultSeverity: "notice",
    description: "Page was escalated to a full browser render, but the rendered result added no words, links, or SEO-field changes over the raw HTML — the render cost bought nothing.",
    howToFix: "Investigate why JS-rendering escalation triggered for this page; if the content is genuinely static, the escalation heuristic may be over-firing.",
    dataRequirements: ["renderDivergence"],
  };
  return {
    meta,
    evaluate(page, config) {
      if (page.renderedWith !== "playwright") return []; // never escalated — not this rule's concern
      const d = page.renderDivergence;
      if (
        !captured(
          d,
          "wordCountDelta",
          "linkCountDelta",
          "titleChanged",
          "metaDescriptionChanged",
          "canonicalChanged",
          "noindexChanged",
        )
      ) {
        return null;
      }
      const gainedNothing =
        d.wordCountDelta <= 0 &&
        d.linkCountDelta <= 0 &&
        !d.titleChanged &&
        !d.metaDescriptionChanged &&
        !d.canonicalChanged &&
        !d.noindexChanged;
      if (!gainedNothing) return [];
      return [
        issueFor(meta, config, page, {
          message: "Page was rendered in a full browser but the render added no measurable content or SEO-field changes.",
          evidence: [
            { field: "renderDivergence.wordCountDelta", value: d.wordCountDelta },
            { field: "renderDivergence.linkCountDelta", value: d.linkCountDelta },
            { field: "renderSignals", value: page.renderSignals },
          ],
        }),
      ];
    },
  };
}

export function renderDivergenceRules(): PageRule[] {
  return [jsAppliedNoindex(), noindexInRawHtmlOnly(), canonicalChangedByJs(), contentRequiresJavascript(), renderAddedNothing()];
}

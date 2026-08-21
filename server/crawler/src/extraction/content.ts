import type { CheerioAPI } from "cheerio";
import { createHash } from "node:crypto";
import type { PageContent } from "../models/types";
import { collapseWhitespace } from "./shared";
import { computeKeywordDensity, computeReadability } from "./readability";

type Nodes = ReturnType<CheerioAPI["root"]>;

const ALWAYS_NOISE = "script, style, noscript, template";
/** Per WHATWG, a header/footer/nav is page chrome only when its nearest sectioning ancestor is
 * body — inside an article it's that article's own byline/nav and belongs to the content. */
const SECTIONING_ROOT = "article, section, aside, nav";
const CHROME = "header, footer, nav";
const ARIA_HIDDEN = '[aria-hidden="true"]';
/** cheerio .text() concatenates with no separator, fusing "…Title" + "By…" into one token —
 * which corrupts wordCount and every 5-word shingle. Force a break at block boundaries. */
const BLOCK = "address, article, aside, blockquote, dd, details, dt, div, dl, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hgroup, li, main, nav, ol, p, pre, section, table, td, th, tr, ul";

function wordCountOf(text: string): number {
  return text === "" ? 0 : text.split(" ").length;
}

/** Provenance matters: a rule must tell "page has no main content" from "we scanned all of body". */
function pickContentArea($: CheerioAPI, root: Nodes): { area: Nodes; method: PageContent["contentAreaMethod"] } {
  const main = root.find("main").first();
  if (main.length) return { area: main as unknown as Nodes, method: "main" };

  const roleMain = root.find("[role=main]").first();
  if (roleMain.length) return { area: roleMain as unknown as Nodes, method: "role-main" };

  // Only an unambiguous single article counts; a listing page of many articles is not "the" content.
  const articles = root.find("article");
  if (articles.length === 1) return { area: articles.first() as unknown as Nodes, method: "article" };

  const body = root.find("body");
  return { area: (body.length ? body : root) as unknown as Nodes, method: "body-minus-chrome" };
}

/** Counted, not stripped: aria-hidden text is visible to sighted users and indexed by Google. */
function countAriaHidden($: CheerioAPI, area: Nodes): number {
  let words = 0;
  area.find(ARIA_HIDDEN).each((_, el) => {
    if ($(el).parents(ARIA_HIDDEN).length > 0) return; // nested — the outermost already counted it
    words += wordCountOf(collapseWhitespace($(el).text()));
  });
  return words;
}

export function extractContent($: CheerioAPI): PageContent {
  const root = $.root().clone(); // clone — never mutate the shared tree
  root.find(ALWAYS_NOISE).remove();
  root
    .find(CHROME)
    .filter((_, el) => $(el).parents(SECTIONING_ROOT).length === 0)
    .remove();

  root.find(BLOCK).append(" ");
  root.find("br").after(" ");

  const { area, method } = pickContentArea($, root);
  const text = collapseWhitespace(area.text());

  return {
    text,
    wordCount: wordCountOf(text),
    contentHash: createHash("sha256").update(text.toLowerCase()).digest("hex"),
    contentAreaMethod: method,
    ariaHiddenWordCount: countAriaHidden($, area),
    readability: computeReadability(text),
    keywordDensity: computeKeywordDensity(text),
  };
}

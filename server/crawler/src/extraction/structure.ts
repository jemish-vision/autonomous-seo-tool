import type { CheerioAPI } from "cheerio";
import type { DocumentStructure, HeadingRecord } from "../models/types";
import { collapseWhitespace } from "./shared";

type Nodes = ReturnType<CheerioAPI>;

/** Same main-content containers content.ts prioritizes (main, [role=main], article) — a heading
 * inside ANY of them counts, unlike content.ts's single-content-area picking which only falls
 * back to article when there's exactly one (that constraint exists to pick ONE text block, not
 * to answer "is this heading structurally inside main content"). */
const MAIN_CONTAINER = "main, [role=main], article";

function hasAccessibleName($el: Nodes): boolean {
  const label = $el.attr("aria-label");
  const labelledby = $el.attr("aria-labelledby");
  return !!label?.trim() || !!labelledby?.trim();
}

function extractHeadingSequence($: CheerioAPI): HeadingRecord[] {
  // A grouped selector walks the tree once, so results already come out in document order.
  return $("h1, h2, h3, h4, h5, h6")
    .map((index, el) => ({
      level: Number(el.tagName.slice(1)) as HeadingRecord["level"],
      text: collapseWhitespace($(el).text()),
      index,
      inMain: $(el).closest(MAIN_CONTAINER).length > 0,
    }))
    .get();
}

function extractTables($: CheerioAPI) {
  const tables = $("table");
  let withTh = 0;
  let withCaption = 0;
  // th/caption must belong to THIS table, not a table nested inside one of its cells.
  tables.each((_, table) => {
    const $table = $(table);
    const owned = ($d: Nodes) => $d.filter((_i, d) => $(d).closest("table").get(0) === table).length > 0;
    if (owned($table.find("th"))) withTh++;
    if (owned($table.find("caption"))) withCaption++;
  });
  return { total: tables.length, withTh, withCaption };
}

function extractLandmarks($: CheerioAPI): string[] {
  const landmarks: string[] = [];
  const present = (sel: string) => $(sel).length > 0;
  if (present("main")) landmarks.push("main");
  if (present("article")) landmarks.push("article");
  if (present("nav")) landmarks.push("nav");
  if (present("aside")) landmarks.push("aside");
  if (present("header")) landmarks.push("header");
  if (present("footer")) landmarks.push("footer");
  if ($("section").filter((_, el) => hasAccessibleName($(el))).length > 0) landmarks.push("section");
  return landmarks;
}

/** Pure structural inventory over the parsed tree. Never mutates $ — read-only selectors throughout. */
export function extractDocumentStructure($: CheerioAPI): DocumentStructure {
  return {
    headings: extractHeadingSequence($),
    paragraphs: $("p").length,
    lists: {
      ordered: $("ol").length,
      unordered: $("ul").length,
      definition: $("dl").length,
    },
    tables: extractTables($),
    // Block-level fenced code (`<pre>`) — an inline `<code>` span in prose isn't a "block".
    codeBlocks: $("pre").length,
    blockquotes: $("blockquote").length,
    landmarks: extractLandmarks($),
  };
}

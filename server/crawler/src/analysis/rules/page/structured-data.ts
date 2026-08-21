/** JSON-LD structured-data rule pack. */
import type { Issue, RuleMeta } from "../../../models/types";
import type { PageRule } from "./index";
import { capturedList, issueFor } from "./shared";
import { label, scorable, usableReport } from "./structured-data-report";

/**
 * POC subset of Google rich-result required properties (not the full spec — e.g. real Product
 * rich results also weigh aggregateRating/review, real FAQPage requires each Question to carry
 * acceptedAnswer). Covers the single top-level property most likely to break eligibility.
 */
const REQUIRED_PROPS: Record<string, string[]> = {
  Product: ["name", "offers"],
  Article: ["headline"],
  FAQPage: ["mainEntity"],
};

/**
 * Narrow "type-vs-context" heuristic: a curated set of topic-specific schema.org types compared
 * against URL path keywords. Not a content classifier — flags only when the URL gives no hint at
 * all that the topic matches (e.g. Recipe markup on a URL with no "recipe"/"food"/"cook" segment).
 */
const TYPE_URL_HINTS: Record<string, string[]> = {
  Recipe: ["recipe", "recipes", "cook", "food"],
  Event: ["event", "events"],
  JobPosting: ["job", "jobs", "career", "careers"],
  Course: ["course", "courses"],
  Movie: ["movie", "movies", "film"],
  Book: ["book", "books"],
};

/** Depth-bounded @type scan — VideoObject is routinely nested inside @graph or an Article's
 * `video` property, so a top-level type check alone would report false gaps. */
function hasTypeAnywhere(node: unknown, wanted: string, depth = 0): boolean {
  if (depth > 8 || node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((child) => hasTypeAnywhere(child, wanted, depth + 1));
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (type === wanted || (Array.isArray(type) && type.includes(wanted))) return true;
  return Object.values(record).some((child) => hasTypeAnywhere(child, wanted, depth + 1));
}

function typeOf(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const t = (parsed as Record<string, unknown>)["@type"];
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return null;
}

function parseError(): PageRule {
  const meta: RuleMeta = {
    id: "structured-data-parse-error",
    category: "structured-data",
    defaultSeverity: "error",
    description: "A JSON-LD block on this page failed to parse.",
    howToFix: "Fix the malformed JSON so search engines can read the structured data.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const report = usableReport(page);
      if (report !== null) {
        // The report separates a genuinely malformed block from an empty one; structuredData[]
        // records both as a parse error, which mislabels a templating bug as broken JSON.
        const malformed = report.errors.map((error, i) => ({ error, i })).filter(({ error }) => error.kind === "malformed-json");
        return malformed.map(({ error, i }) =>
          issueFor(meta, config, page, {
            message: error.message,
            evidence: [{ field: `structuredDataReport.errors[${i}]`, value: { blockIndex: error.blockIndex, format: error.format } }],
          }),
        );
      }
      if (!capturedList(page.structuredData)) return null;
      const offenders = page.structuredData.map((sd, i) => ({ sd, i })).filter(({ sd }) => sd.parseError !== null);
      if (offenders.length === 0) return [];
      return offenders.map(({ sd, i }) =>
        issueFor(meta, config, page, {
          message: `Invalid JSON-LD: ${sd.parseError}`,
          evidence: [
            { field: `structuredData[${i}].parseError`, value: sd.parseError },
            { field: `structuredData[${i}].raw`, value: sd.raw },
          ],
        }),
      );
    },
  };
}

function missingRequiredProperty(): PageRule {
  const meta: RuleMeta = {
    id: "structured-data-missing-required-property",
    category: "structured-data",
    defaultSeverity: "warning",
    description: "A structured-data block is missing a property Google requires for that type's rich result (POC subset — see module doc comment).",
    howToFix: "Add the missing property to the JSON-LD block.",
    dataRequirements: [],
  };
  return {
    meta,
    evaluate(page, config) {
      const issues: Issue[] = [];
      const report = usableReport(page);
      if (report !== null) {
        for (const { item, i } of scorable(report)) {
          if (item.validation.missingRequired.length === 0) continue;
          issues.push(
            issueFor(meta, config, page, {
              message: `${label(item.types)} (${item.format}) is missing required propert${item.validation.missingRequired.length === 1 ? "y" : "ies"}: ${item.validation.missingRequired.join(", ")}.`,
              evidence: [
                { field: `structuredDataReport.items[${i}].validation.missingRequired`, value: item.validation.missingRequired },
                { field: `structuredDataReport.items[${i}].path`, value: item.path },
                { field: `structuredDataReport.items[${i}].types`, value: item.types },
                { field: `structuredDataReport.items[${i}].format`, value: item.format },
              ],
              threshold: `Google rich-result profile: ${item.validation.profile ?? label(item.types)}`,
            }),
          );
        }
        return issues;
      }
      if (!capturedList(page.structuredData)) return null;
      for (let i = 0; i < page.structuredData.length; i++) {
        const sd = page.structuredData[i]!;
        if (sd.parseError !== null || sd.parsed === null || typeof sd.parsed !== "object") continue;
        const type = typeOf(sd.parsed);
        if (type === null || !(type in REQUIRED_PROPS)) continue;
        const obj = sd.parsed as Record<string, unknown>;
        const missing = REQUIRED_PROPS[type]!.filter((prop) => obj[prop] === undefined);
        if (missing.length === 0) continue;
        issues.push(
          issueFor(meta, config, page, {
            message: `${type} structured data is missing required propert${missing.length === 1 ? "y" : "ies"}: ${missing.join(", ")}.`,
            evidence: missing.map((prop) => ({ field: `structuredData[${i}].parsed.${prop}`, value: null })),
            threshold: `${type} requires: ${REQUIRED_PROPS[type]!.join(", ")}`,
          }),
        );
      }
      return issues;
    },
  };
}

function typeMismatch(): PageRule {
  const meta: RuleMeta = {
    id: "structured-data-type-mismatch",
    category: "structured-data",
    defaultSeverity: "warning",
    description:
      "A topic-specific @type whose URL gives no matching signal AND which is also missing required properties — together these read as " +
      "boilerplate markup pasted onto the wrong template. The URL keyword test alone is too weak to report (a real recipe at /blog/best-brownies " +
      "would fire), so it only counts when the node is independently incomplete.",
    howToFix: "Use the schema.org type that matches this page's actual content, or remove the mismatched block.",
    dataRequirements: ["structuredDataReport"],
  };
  return {
    meta,
    evaluate(page, config) {
      const report = usableReport(page);
      if (report === null) return null;
      // Corroborate against everything the page says about itself, not just the slug — a real
      // recipe at /blog/best-brownies talks about cooking in its own copy.
      const haystack = [page.url, page.title ?? "", ...page.headings.h1, page.content.text].join(" ").toLowerCase();
      const issues: Issue[] = [];
      for (const { item, i } of scorable(report)) {
        if (item.validation.missingRequired.length === 0) continue;
        const type = item.types.find((t) => TYPE_URL_HINTS[t] !== undefined);
        if (type === undefined) continue;
        if (TYPE_URL_HINTS[type]!.some((hint) => haystack.includes(hint))) continue;
        issues.push(
          issueFor(meta, config, page, {
            message: `${type} markup but nothing in the URL, title, H1 or body copy signals "${type}", and the node is also missing ${item.validation.missingRequired.join(", ")}.`,
            evidence: [
              { field: `structuredDataReport.items[${i}].types`, value: item.types },
              { field: `structuredDataReport.items[${i}].validation.missingRequired`, value: item.validation.missingRequired },
              { field: "url", value: page.url },
            ],
          }),
        );
      }
      return issues;
    },
  };
}

function videoEmbedWithoutSchema(): PageRule {
  const meta: RuleMeta = {
    id: "video-embed-without-schema",
    category: "structured-data",
    defaultSeverity: "notice",
    description:
      "Page embeds a YouTube/Vimeo video but carries no VideoObject structured data, so it cannot appear in Google's video results. " +
      "Deliberately limited to provider embeds — a bare <video> file is usually a decorative background loop, not indexable content.",
    howToFix: "Add a VideoObject block with name, description, thumbnailUrl and uploadDate for the embedded video.",
    dataRequirements: ["videos"],
  };
  return {
    meta,
    evaluate(page, config) {
      // videos[] is typed required but 1190 stored pages predate media extraction.
      if (!capturedList(page.videos) || !capturedList(page.structuredData)) return null;
      const report = usableReport(page);
      // A truncated report's types[] is taken after the item cap, so absence proves nothing.
      if (report?.truncated) return null;
      const embeds = page.videos.map((v, i) => ({ v, i })).filter(({ v }) => v.kind === "youtube" || v.kind === "vimeo");
      if (embeds.length === 0) return [];
      const declared = report
        ? report.types.includes("VideoObject")
        : page.structuredData.some((sd) => sd.parseError === null && hasTypeAnywhere(sd.parsed, "VideoObject"));
      if (declared) return [];
      return [
        issueFor(meta, config, page, {
          message: `${embeds.length} video embed(s) with no VideoObject structured data.`,
          evidence: embeds.map(({ v, i }) => ({ field: `videos[${i}].url`, value: v.url })),
        }),
      ];
    },
  };
}

export function structuredDataRules(): PageRule[] {
  return [parseError(), missingRequiredProperty(), typeMismatch(), videoEmbedWithoutSchema()];
}

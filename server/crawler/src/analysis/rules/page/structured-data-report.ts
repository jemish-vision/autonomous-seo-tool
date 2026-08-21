/** Rules over the v4 `structuredDataReport` — microdata + RDFa alongside JSON-LD, validated
 * against the 41 Google rich-result profiles. The legacy `structuredData[]` rules stay in
 * structured-data.ts; anything here needs the report and skips without it. */
import type { CrawledPage, RuleMeta, StructuredDataError, StructuredDataReport } from "../../../models/types";
import type { PageRule } from "./index";
import { captured, capturedList, issueFor } from "./shared";

/** Every recommended-property profile fires on ImageObject, and Yoast emits one ImageObject per
 * image — that alone would bury the finding on a whole class of sites. */
const RECOMMENDED_NOISE_TYPES = new Set(["ImageObject"]);

/** A partially-written report is as dangerous as a missing one; prove the shape before reading. */
function usableReport(page: CrawledPage): StructuredDataReport | null {
  const report = page.structuredDataReport;
  if (!captured(report, "items", "errors", "counts", "types", "truncated")) return null;
  if (!capturedList(report.items) || !capturedList(report.errors) || !capturedList(report.types)) return null;
  return report;
}

/** Nodes referenced by @id elsewhere carry no properties of their own — validating them would
 * report a gap the author cannot fix. */
function scorable(report: StructuredDataReport) {
  return report.items.map((item, i) => ({ item, i })).filter(({ item }) => item.validation.status !== "reference");
}

function errorsOfKind(report: StructuredDataReport, kind: StructuredDataError["kind"]) {
  return report.errors.map((error, i) => ({ error, i })).filter(({ error }) => error.kind === kind);
}

function label(types: string[]): string {
  return types.length ? types.join("/") : "(untyped)";
}

function missingRecommendedProperty(): PageRule {
  const meta: RuleMeta = {
    id: "structured-data-missing-recommended-property",
    category: "structured-data",
    defaultSeverity: "notice",
    description:
      "A structured-data node omits properties Google lists as recommended for its rich result. These do not block eligibility but " +
      "reduce how much of the result Google can render. ImageObject is excluded — every profile flags it and Yoast emits one per image.",
    howToFix: "Add the listed properties to the node, or accept a less complete rich result.",
    dataRequirements: ["structuredDataReport"],
  };
  return {
    meta,
    evaluate(page, config) {
      const report = usableReport(page);
      if (report === null) return null;
      const offenders = scorable(report).filter(
        ({ item }) =>
          item.validation.missingRecommended.length > 0 && !item.types.some((t) => RECOMMENDED_NOISE_TYPES.has(t)),
      );
      if (offenders.length === 0) return [];
      const summary = offenders
        .slice(0, 4)
        .map(({ item }) => `${label(item.types)} (${item.validation.missingRecommended.join(", ")})`);
      return [
        issueFor(meta, config, page, {
          message: `${offenders.length} node(s) missing recommended properties: ${summary.join("; ")}${offenders.length > summary.length ? ", …" : ""}.`,
          evidence: offenders.map(({ item, i }) => ({
            field: `structuredDataReport.items[${i}].validation.missingRecommended`,
            value: { path: item.path, types: item.types, format: item.format, missing: item.validation.missingRecommended },
          })),
        }),
      ];
    },
  };
}

function unknownType(): PageRule {
  const meta: RuleMeta = {
    id: "structured-data-unknown-type",
    category: "structured-data",
    defaultSeverity: "warning",
    description: "A node declares a @type that is not a schema.org type at all — typically a typo. Google cannot map it to anything and ignores the node.",
    howToFix: "Correct the type name to a real schema.org type.",
    dataRequirements: ["structuredDataReport"],
  };
  return {
    meta,
    evaluate(page, config) {
      const report = usableReport(page);
      if (report === null) return null;
      const offenders = report.items
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => item.validation.status === "unknown-type");
      if (offenders.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${offenders.length} node(s) declare a type that is not on schema.org: ${offenders.map(({ item }) => label(item.types)).join(", ")}.`,
          evidence: offenders.map(({ item, i }) => ({
            field: `structuredDataReport.items[${i}].types`,
            value: { path: item.path, types: item.types, format: item.format },
          })),
        }),
      ];
    },
  };
}

/** One factory for the three error-kind rules — they differ only in id/severity/wording. */
function fromErrorKind(
  kind: StructuredDataError["kind"],
  meta: RuleMeta,
  message: (errors: StructuredDataError[]) => string,
): PageRule {
  return {
    meta,
    evaluate(page, config) {
      const report = usableReport(page);
      if (report === null) return null;
      const offenders = errorsOfKind(report, kind);
      if (offenders.length === 0) return [];
      return [
        issueFor(meta, config, page, {
          message: message(offenders.map(({ error }) => error)),
          evidence: offenders.map(({ error, i }) => ({
            field: `structuredDataReport.errors[${i}]`,
            value: { format: error.format, blockIndex: error.blockIndex, value: error.value, message: error.message },
          })),
        }),
      ];
    },
  };
}

function missingType(): PageRule {
  return fromErrorKind(
    "missing-type",
    {
      id: "structured-data-missing-type",
      category: "structured-data",
      defaultSeverity: "warning",
      description: "A JSON-LD object or an itemscope element declares no type, so Google has nothing to map it to and the node is invisible.",
      howToFix: "Add @type (JSON-LD) or itemtype (microdata) naming the schema.org type the node describes.",
      dataRequirements: ["structuredDataReport"],
    },
    (errors) => `${errors.length} structured-data node(s) declare no type.`,
  );
}

function missingContext(): PageRule {
  return fromErrorKind(
    "missing-context",
    {
      id: "structured-data-missing-context",
      category: "structured-data",
      defaultSeverity: "warning",
      description: "A JSON-LD block has no @context, so its types are not bound to schema.org and Google discards the block.",
      howToFix: 'Add "@context": "https://schema.org" to the JSON-LD block.',
      dataRequirements: ["structuredDataReport"],
    },
    (errors) => `${errors.length} JSON-LD block(s) declare no @context.`,
  );
}

function invalidContext(): PageRule {
  return fromErrorKind(
    "invalid-context",
    {
      id: "structured-data-invalid-context",
      category: "structured-data",
      defaultSeverity: "warning",
      description: "A JSON-LD block's @context does not resolve to schema.org, so its types mean nothing to Google.",
      howToFix: 'Set @context to "https://schema.org".',
      dataRequirements: ["structuredDataReport"],
    },
    (errors) => `JSON-LD @context is not schema.org: ${[...new Set(errors.map((e) => e.value ?? "(unreadable)"))].join(", ")}.`,
  );
}

function emptyBlock(): PageRule {
  return fromErrorKind(
    "empty-block",
    {
      id: "structured-data-empty-block",
      category: "structured-data",
      defaultSeverity: "notice",
      description:
        "An empty <script type=\"application/ld+json\"> block. Reported separately from malformed JSON because it is a templating bug " +
        "(a variable that rendered to nothing), not markup an author got wrong.",
      howToFix: "Remove the empty block, or fix the template that was meant to fill it.",
      dataRequirements: ["structuredDataReport"],
    },
    (errors) => `${errors.length} empty JSON-LD block(s).`,
  );
}

function noJsonLd(): PageRule {
  const meta: RuleMeta = {
    id: "structured-data-no-json-ld",
    category: "structured-data",
    defaultSeverity: "notice",
    description:
      "All structured data on the page is microdata and/or RDFa. Google reads all three syntaxes but recommends JSON-LD, which is far easier " +
      "to keep correct because it is not interleaved with the markup.",
    howToFix: "Emit the same entities as a JSON-LD block; the legacy markup can then be retired.",
    dataRequirements: ["structuredDataReport"],
  };
  return {
    meta,
    evaluate(page, config) {
      const report = usableReport(page);
      if (report === null) return null;
      // A truncated report's counts are taken after the cap, so "no JSON-LD" may just be unseen.
      if (report.truncated) return null;
      if (!captured(report.counts, "jsonLdItems", "microdataItems", "rdfaItems")) return null;
      const legacy = report.counts.microdataItems + report.counts.rdfaItems;
      if (legacy === 0 || report.counts.jsonLdItems > 0) return [];
      return [
        issueFor(meta, config, page, {
          message: `${legacy} structured-data node(s) use microdata/RDFa and none use JSON-LD.`,
          evidence: [
            { field: "structuredDataReport.counts.jsonLdItems", value: report.counts.jsonLdItems },
            { field: "structuredDataReport.counts.microdataItems", value: report.counts.microdataItems },
            { field: "structuredDataReport.counts.rdfaItems", value: report.counts.rdfaItems },
          ],
        }),
      ];
    },
  };
}

function noStructuredDataAtAll(): PageRule {
  const meta: RuleMeta = {
    id: "no-structured-data",
    category: "structured-data",
    defaultSeverity: "notice",
    description: "The page has no structured data at all — no JSON-LD, microdata or RDFa. Distinct from no-json-ld, which requires legacy markup to already be present.",
    howToFix: "Add JSON-LD structured data describing the page's primary entity (Article, Product, etc.).",
    dataRequirements: ["structuredDataReport"],
  };
  return {
    meta,
    evaluate(page, config) {
      const report = usableReport(page);
      if (report === null) return null;
      // A truncated report's counts are taken after the item cap — "zero seen" isn't "zero present".
      if (report.truncated) return null;
      if (!captured(report.counts, "items")) return null;
      if (report.counts.items > 0) return [];
      return [
        issueFor(meta, config, page, {
          message: "No structured data (JSON-LD, microdata or RDFa) found on the page.",
          evidence: [{ field: "structuredDataReport.counts.items", value: 0 }],
        }),
      ];
    },
  };
}

export { usableReport, scorable, label };

export function structuredDataReportRules(): PageRule[] {
  return [
    missingRecommendedProperty(),
    unknownType(),
    missingType(),
    missingContext(),
    invalidContext(),
    emptyBlock(),
    noJsonLd(),
    noStructuredDataAtAll(),
  ];
}

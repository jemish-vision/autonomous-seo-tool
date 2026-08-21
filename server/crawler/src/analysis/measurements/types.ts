/**
 * "All Measurements" computation layer — every figure the crawl produced, plain-language
 * explainer included, for the dashboard's 31-card grid (ported from Jemish's tool per the
 * owner's brief). This module OWNS aggregation only: it reads stored run evidence
 * (pages/*.json, report.json, failures.json, external-links.json) and produces numbers +
 * copy. It does not judge issues (that's the rules engine) and never writes anything.
 */

/** Display-formatting hint only — the actual number always lives in `value`. */
export type MeasurementUnit =
  | "pages"
  | "images"
  | "links"
  | "ms"
  | "bytes"
  | "words"
  | "score"
  | "nodes"
  | "count"
  | "status";

/**
 * How the dashboard would re-derive the matching page/link set for a drill-down. Deliberately a
 * filter SPEC, not a resolved URL list — embedding every matching URL in every measurement would
 * make this payload scale with run size (1000+ pages) instead of staying O(31). The consuming
 * screen (a later wave) re-applies this against the same stored pages it already has.
 */
export interface MeasurementLinkTarget {
  /** Dot-path-ish field the filter is over, e.g. "title", "images[].alt", "crawl.depth".
   * "__computed__.X" marks a filter this module derives (not a single stored field) — the
   * dashboard needs the matching logic described in `note`, not just a field read. */
  field: string;
  op: "blank" | "empty" | "non-empty" | "eq" | "gt" | "lt" | "in" | "is-null" | "count-gt" | "custom";
  value?: unknown;
  /** Required when op is "custom" or field starts with "__computed__." — names the exact logic
   * (e.g. "internal link whose target is 4xx/5xx/failed, excluding 401/403") since there is no
   * single field to point at. */
  note?: string;
}

export interface Measurement {
  id: string;
  label: string;
  /** Loose grouping for the grid (Coverage / On-Page / Content / Indexability / Links / Media /
   * Social & Schema / Security / Performance) — a display hint, not a contract. */
  category: string;
  unit: MeasurementUnit;
  /** null exactly when available === false. Never a fabricated 0. */
  value: number | null;
  /** Ready-to-render string ("1,204 pages", "312 ms", "1.4 MB"). null when unavailable. */
  display: string | null;
  /** Plain-language explainer: what the figure means, in terms a non-engineer can act on. */
  explainer: string;
  available: boolean;
  /** Populated exactly when available === false — names what's missing and why, never silent. */
  unavailableReason: string | null;
  /** null when the figure isn't a page/link subset (e.g. an average) or the measurement is
   * unavailable. */
  linkTarget: MeasurementLinkTarget | null;
  /** How many pages/records actually contributed to `value` — lets the UI show "based on 18 of
   * 21 pages" instead of implying full-run coverage a partial-vintage run doesn't have. Null when
   * the concept doesn't apply (e.g. unavailable) or the sample IS the whole run with no caveat. */
  sampleSize: number | null;
  totalPages: number;
}

export interface MeasurementsResult {
  runId: string;
  generatedAt: string;
  /** Count of stored CrawledPage records — the ground truth every "of N pages" in this result is
   * measured against. */
  pagesInRun: number;
  measurements: Measurement[];
}

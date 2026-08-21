/** Cross-site competitor comparison — extends crawlDiff's crawl-over-crawl model to two DIFFERENT
 * domains. crawlDiff keys pages by pathname because that survives host-alias/scheme drift between
 * two crawls of the SAME site. There is no equivalent key across two different sites: "/products/
 * tent" on our site and "/products/tent" on a competitor's are unrelated URLs that happen to share
 * a string, not "the same page." Pretending otherwise (page-level added/removed/changed, or an
 * issue "lifecycle" keyed by ruleId+url) would silently imply a correspondence that doesn't exist.
 *
 * What DOES transfer across domains is anything already page-count-normalized or site-scoped:
 * health score (already 0-100 by construction), issue rates per 100 pages, average content/link/
 * depth stats, and structured-data TYPE coverage. This module computes only those, and explicitly
 * lists what it refuses to compare and why — see `notComparable`. Every metric is null (not a
 * fabricated zero) when the underlying evidence isn't available on one or both sides, matching
 * crawlDiff's own issues:null discipline. */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AnalysisReport, CrawledPage, CrawlSummary, GraphReport } from "../models/types";
import { readIssues } from "../analysis/store";

async function assertRunDirExists(runDir: string): Promise<void> {
  try {
    const s = await stat(runDir);
    if (!s.isDirectory()) throw new Error(`run directory not found: ${runDir}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`run directory not found: ${runDir}`);
    throw err;
  }
}

/** Deliberately duplicated from crawlDiff.ts rather than shared — keeps the two comparison modes
 * (same-site vs cross-site) independently readable and independently safe to change. */
async function loadPages(runDir: string): Promise<CrawledPage[]> {
  const dir = path.join(runDir, "pages");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const pages: CrawledPage[] = [];
  for (const f of files) {
    try {
      pages.push(JSON.parse(await readFile(path.join(dir, f), "utf8")) as CrawledPage);
    } catch {
      // malformed page record — skip, never fail the whole comparison over one bad file
    }
  }
  return pages;
}

async function readJsonOrNull<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function runIdOf(runDir: string, summary: CrawlSummary | null): Promise<string> {
  if (summary?.runId) return summary.runId;
  return path.basename(runDir);
}

function siteLabelOf(summary: CrawlSummary | null, pages: CrawledPage[]): string {
  const candidate = summary?.startUrl ?? pages[0]?.normalizedUrl ?? pages[0]?.url ?? null;
  if (!candidate) return "(unknown site)";
  try {
    return new URL(candidate).hostname;
  } catch {
    return candidate;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round1((100 * numerator) / denominator);
}

export interface CompetitorMetric {
  metric: string;
  /** Human-readable unit/description, so a consumer doesn't have to guess ("per 100 pages", "%", "chars"). */
  unit: string;
  ours: number | null;
  theirs: number | null;
  /** ours - theirs. Null whenever either side is null — never a fabricated zero. */
  delta: number | null;
  /** False when the underlying evidence is missing on one/both sides; `ours`/`theirs` may still
   * carry a value for the side that DOES have it — `comparable` gates whether delta means anything. */
  comparable: boolean;
  note?: string;
}

export interface StructuredDataCoverageRow {
  type: string;
  ourPages: number;
  ourPagesPct: number;
  theirPages: number;
  theirPagesPct: number;
}

export interface CompetitorComparison {
  ourRunId: string;
  ourSite: string;
  competitorRunId: string;
  competitorSite: string;
  generatedAt: string;
  pageCounts: { ours: number; theirs: number };
  /** The comparable, page-count-normalized measurement grid — health, issue rates, structure,
   * content depth, link density, authority concentration. */
  grid: CompetitorMetric[];
  /** Empty when neither run has structuredDataReport captured on any page. */
  structuredDataCoverage: StructuredDataCoverageRow[];
  /** Explicit refusals — comparisons this module will NOT produce, and why. Always non-empty:
   * cross-domain page-level pairing is never meaningful, regardless of what data is available. */
  notComparable: string[];
}

interface SiteFacts {
  runId: string;
  site: string;
  pages: CrawledPage[];
  issues: AnalysisReport | null;
  summary: CrawlSummary | null;
  graph: GraphReport | null;
}

async function gatherFacts(runDir: string): Promise<SiteFacts> {
  await assertRunDirExists(runDir);
  const [pages, issues, summary, graph] = await Promise.all([
    loadPages(runDir),
    readIssues(runDir),
    readJsonOrNull<CrawlSummary>(path.join(runDir, "report.json")),
    readJsonOrNull<GraphReport>(path.join(runDir, "graph.json")),
  ]);
  const runId = await runIdOf(runDir, summary);
  return { runId, site: siteLabelOf(summary, pages), pages, issues, summary, graph };
}

function internalLinkCount(page: CrawledPage): number {
  return page.links.filter((l) => l.type === "internal").length;
}

function hasStructuredDataReport(pages: CrawledPage[]): boolean {
  return pages.some((p) => p.structuredDataReport !== undefined);
}

function buildMetric(
  metric: string,
  unit: string,
  ours: number | null,
  theirs: number | null,
  note?: string,
): CompetitorMetric {
  const comparable = ours !== null && theirs !== null;
  return {
    metric,
    unit,
    ours: ours === null ? null : round1(ours),
    theirs: theirs === null ? null : round1(theirs),
    delta: comparable ? round1(ours! - theirs!) : null,
    comparable,
    ...(note ? { note } : {}),
  };
}

/** Alt-applicable images missing alt text, as a % of alt-applicable images — null when neither
 * side captured imageSummary (an optional v4 field; older stored runs lack it entirely). */
function missingAltRate(pages: CrawledPage[]): number | null {
  const withSummary = pages.filter((p) => p.imageSummary !== undefined);
  if (withSummary.length === 0) return null;
  const applicable = withSummary.reduce((sum, p) => sum + p.imageSummary!.altApplicable, 0);
  const missing = withSummary.reduce((sum, p) => sum + p.imageSummary!.missingAlt, 0);
  return pct(missing, applicable);
}

/** Share of pages in the top internalRank tier (>= 50 on the 1-100 log scale) — an aggregate,
 * page-count-normalized read on authority concentration. Requires graph.json on that side. */
function topAuthorityShare(graph: GraphReport | null, pageCount: number): number | null {
  if (!graph || pageCount === 0) return null;
  const top = graph.pages.filter((p) => p.internalRank >= 50).length;
  return pct(top, pageCount);
}

/**
 * Compare our site's crawl against a competitor's crawl. Both `ourRunDir` and `competitorRunDir`
 * are run directories (same shape diffRuns expects). Tolerant of either run lacking issues.json
 * or graph.json — those metrics report as not comparable rather than failing the whole comparison.
 */
export async function compareCompetitor(ourRunDir: string, competitorRunDir: string): Promise<CompetitorComparison> {
  const [ours, theirs] = await Promise.all([gatherFacts(ourRunDir), gatherFacts(competitorRunDir)]);

  const ourCount = ours.pages.length;
  const theirCount = theirs.pages.length;

  const grid: CompetitorMetric[] = [];

  grid.push(
    buildMetric(
      "healthScore",
      "0-100",
      ours.issues?.healthScore ?? null,
      theirs.issues?.healthScore ?? null,
      !ours.issues || !theirs.issues ? "requires npm run analyze on both runs" : undefined,
    ),
  );

  /** Raw (unrounded) rate — buildMetric does its own 1dp rounding. */
  const rawIssueRate = (report: AnalysisReport | null, severity: "error" | "warning" | "notice" | null): number | null => {
    if (!report || report.pagesAnalyzed === 0) return null;
    const count = severity ? report.counts[severity] : report.counts.error + report.counts.warning + report.counts.notice;
    return (count / report.pagesAnalyzed) * 100;
  };

  grid.push(
    buildMetric("issuesPer100Pages", "issues / 100 pages", rawIssueRate(ours.issues, null), rawIssueRate(theirs.issues, null)),
  );
  grid.push(
    buildMetric(
      "errorsPer100Pages",
      "errors / 100 pages",
      rawIssueRate(ours.issues, "error"),
      rawIssueRate(theirs.issues, "error"),
    ),
  );
  grid.push(
    buildMetric(
      "warningsPer100Pages",
      "warnings / 100 pages",
      rawIssueRate(ours.issues, "warning"),
      rawIssueRate(theirs.issues, "warning"),
    ),
  );

  grid.push(
    buildMetric(
      "avgWordCount",
      "words/page",
      mean(ours.pages.map((p) => p.content.wordCount)),
      mean(theirs.pages.map((p) => p.content.wordCount)),
    ),
  );
  grid.push(
    buildMetric(
      "medianWordCount",
      "words/page",
      median(ours.pages.map((p) => p.content.wordCount)),
      median(theirs.pages.map((p) => p.content.wordCount)),
    ),
  );

  const siteDepth = (facts: SiteFacts): number | null =>
    facts.summary?.maxDepthSeen ?? (facts.pages.length > 0 ? Math.max(...facts.pages.map((p) => p.crawl.depth)) : null);
  grid.push(buildMetric("siteDepth", "max link-hops from home", siteDepth(ours), siteDepth(theirs)));
  grid.push(
    buildMetric(
      "avgPageDepth",
      "link-hops from home",
      mean(ours.pages.map((p) => p.crawl.depth)),
      mean(theirs.pages.map((p) => p.crawl.depth)),
    ),
  );

  grid.push(
    buildMetric(
      "avgInternalLinksPerPage",
      "internal links/page",
      mean(ours.pages.map(internalLinkCount)),
      mean(theirs.pages.map(internalLinkCount)),
    ),
  );

  const orphanRate = (facts: SiteFacts): number | null => {
    const orphanCount = facts.graph?.orphans.length ?? facts.summary?.orphanCandidates?.length ?? null;
    if (orphanCount === null || facts.pages.length === 0) return null;
    return (orphanCount / facts.pages.length) * 100;
  };
  grid.push(
    buildMetric(
      "orphanPageRatePer100",
      "orphan pages / 100 pages",
      orphanRate(ours),
      orphanRate(theirs),
      "prefers graph.json (npm run graph); falls back to the crawler's own orphanCandidates",
    ),
  );

  grid.push(
    buildMetric("missingAltRate", "% of alt-applicable images", missingAltRate(ours.pages), missingAltRate(theirs.pages)),
  );

  const structuredDataPresenceRate = (facts: SiteFacts): number | null => {
    if (facts.pages.length === 0) return null;
    const withAny = facts.pages.filter(
      (p) => p.structuredData.length > 0 || (p.structuredDataReport?.items.length ?? 0) > 0,
    ).length;
    return (withAny / facts.pages.length) * 100;
  };
  grid.push(
    buildMetric(
      "pagesWithStructuredDataRate",
      "% of pages",
      structuredDataPresenceRate(ours),
      structuredDataPresenceRate(theirs),
    ),
  );

  const avgTitleLength = (pages: CrawledPage[]): number | null =>
    mean(pages.filter((p) => p.title !== null).map((p) => p.title!.length));
  grid.push(buildMetric("avgTitleLength", "chars", avgTitleLength(ours.pages), avgTitleLength(theirs.pages)));

  grid.push(
    buildMetric(
      "topAuthorityPageSharePer100",
      "% of pages with internalRank >= 50",
      topAuthorityShare(ours.graph, ourCount),
      topAuthorityShare(theirs.graph, theirCount),
      !ours.graph || !theirs.graph ? "requires npm run graph on both runs" : undefined,
    ),
  );

  // Structured-data TYPE coverage — only when at least one side actually captured it.
  const structuredDataCoverage: StructuredDataCoverageRow[] = [];
  if (hasStructuredDataReport(ours.pages) || hasStructuredDataReport(theirs.pages)) {
    const types = new Set<string>();
    for (const p of ours.pages) for (const t of p.structuredDataReport?.types ?? []) types.add(t);
    for (const p of theirs.pages) for (const t of p.structuredDataReport?.types ?? []) types.add(t);

    for (const type of [...types].sort()) {
      const ourPages = ours.pages.filter((p) => (p.structuredDataReport?.types ?? []).includes(type)).length;
      const theirPages = theirs.pages.filter((p) => (p.structuredDataReport?.types ?? []).includes(type)).length;
      structuredDataCoverage.push({
        type,
        ourPages,
        ourPagesPct: pct(ourPages, ourCount) ?? 0,
        theirPages,
        theirPagesPct: pct(theirPages, theirCount) ?? 0,
      });
    }
  }

  const notComparable = [
    "Page-level added/removed/changed URLs — pathnames don't correspond across domains; there is no cross-site page key to diff on.",
    "Per-URL field drift (title/canonical/meta changes on 'the same' page) — meaningless without a stable cross-domain page identity.",
    "Issue lifecycle (new/fixed/persisting) keyed by ruleId+URL — an issue on the same pathname on two different domains is not 'the same issue'; only pooled issue RATES (see grid) are compared.",
    "Per-page internalRank/PageRank — no page correspondence exists; only the aggregate rank distribution (topAuthorityPageSharePer100) is compared.",
    "Crawl coverage, duration, and requests-per-second — these describe how completely OUR crawler covered each site, not the site's own quality, and are deliberately excluded from the grid.",
  ];
  if (!hasStructuredDataReport(ours.pages) && !hasStructuredDataReport(theirs.pages)) {
    notComparable.push("Structured-data type coverage — neither run captured structuredDataReport (pre-wave run or field never populated).");
  } else if (!hasStructuredDataReport(ours.pages)) {
    notComparable.push("Structured-data type coverage on OUR side — our run lacks structuredDataReport; the coverage grid only reflects the competitor's types.");
  } else if (!hasStructuredDataReport(theirs.pages)) {
    notComparable.push("Structured-data type coverage on the COMPETITOR side — their run lacks structuredDataReport; the coverage grid only reflects our types.");
  }

  return {
    ourRunId: ours.runId,
    ourSite: ours.site,
    competitorRunId: theirs.runId,
    competitorSite: theirs.site,
    generatedAt: new Date().toISOString(),
    pageCounts: { ours: ourCount, theirs: theirCount },
    grid,
    structuredDataCoverage,
    notComparable,
  };
}

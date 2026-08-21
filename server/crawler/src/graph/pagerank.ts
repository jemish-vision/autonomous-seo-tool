/** Slice C2 implements — post-crawl link-graph pass (competitive research §5: every serious
 * crawler computes internal PageRank; it's the substrate for internal-linking recommendations).
 *
 * DUPLICATE-LINK DECISION: a source page linking to the same target twice (e.g. a nav logo +
 * a footer link, both to "/") counts as ONE edge for PageRank purposes (Screaming Frog's model,
 * not Oncrawl's — which counts every occurrence). Reasoning: PageRank's transition matrix models
 * "does a real navigational path exist", not "how many anchor tags point there" — letting
 * boilerplate duplicate a page's own weight would inflate rank on pages with heavy chrome, not
 * ones that earn links editorially. The raw occurrence count is still preserved on
 * PageGraphScore.inlinks (not deduped) so nothing is lost as evidence; only uniqueInlinks and the
 * edges themselves are deduped by source page.
 */
import type { CrawledPage, GraphReport, PageGraphScore } from "../models/types";
import { buildInlinkOccurrences, pageIdFor, pathnameOf, primaryUrl } from "../analysis/rules/site/helpers";

export const DEFAULT_DAMPING = 0.85;
const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_EPSILON = 1e-6;

interface GraphNode {
  page: CrawledPage;
  key: string;
  /** Unique in-graph outlink target indices — self-links and non-crawled targets excluded. */
  outEdges: number[];
}

/** Path + query, scheme/host stripped — same alias tolerance as the analyzer's pathnameOf
 * (host aliasing, e.g. www vs bare, is a deliberate crawl-scope decision made upstream, not this
 * module's to second-guess), but WITHOUT pathnameOf's query-string collapse. That collapse was a
 * measured defect: two distinct crawled pages differing only in query string (e.g. "/?a=1" vs
 * "/?a=2", or an ?lang= variant) were silently merged onto one graph node — the second one lost
 * its own rank, inlink count, and orphan eligibility because indexByKey below can only ever route
 * a link target to ONE node per key. Verified on real runs (see graph tests + PR notes): a
 * 1,051-page run had 10 pages invisible to link-target resolution under pathname-only keying,
 * a 185-page run had 11 — full path+query identity resolves all but the genuine host/scheme
 * alias cases (which are correctly still shared, by design). */
function keyOf(page: CrawledPage): string {
  return pathAndQueryOf(primaryUrl(page)) ?? primaryUrl(page);
}

function pathAndQueryOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const pathname = u.pathname.length > 1 && u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname;
    return pathname + u.search;
  } catch {
    return null;
  }
}

/**
 * Internal PageRank over the crawled link graph. Pure: same pages in → same scores out.
 * Dangling pages (no outlinks) redistribute their rank across the graph rather than leaking it.
 */
export function computeGraph(
  pages: CrawledPage[],
  runId: string,
  opts?: { damping?: number; maxIterations?: number; epsilon?: number },
): GraphReport {
  const damping = opts?.damping ?? DEFAULT_DAMPING;
  const maxIterations = opts?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const epsilon = opts?.epsilon ?? DEFAULT_EPSILON;

  const nodes: GraphNode[] = pages.map((page) => ({ page, key: keyOf(page), outEdges: [] }));
  const n = nodes.length;

  if (n === 0) {
    return {
      runId,
      generatedAt: new Date().toISOString(),
      dampingFactor: damping,
      iterations: 0,
      converged: true,
      pages: [],
      orphans: [],
    };
  }

  // First page wins a remaining key collision — now only genuine host/scheme aliases (www vs
  // bare, http vs https), not query-string variants. See keyOf's doc comment.
  const indexByKey = new Map<string, number>();
  nodes.forEach((node, i) => {
    if (!indexByKey.has(node.key)) indexByKey.set(node.key, i);
  });

  nodes.forEach((node, sourceIndex) => {
    const seen = new Set<number>();
    for (const link of node.page.links) {
      if (link.type !== "internal") continue;
      const targetKey = pathAndQueryOf(link.targetNormalized ?? link.target);
      if (!targetKey) continue;
      const targetIndex = indexByKey.get(targetKey);
      if (targetIndex === undefined || targetIndex === sourceIndex || seen.has(targetIndex)) continue;
      seen.add(targetIndex);
      node.outEdges.push(targetIndex);
    }
  });

  const inEdges: number[][] = Array.from({ length: n }, () => [] as number[]);
  nodes.forEach((node, sourceIndex) => {
    for (const targetIndex of node.outEdges) inEdges[targetIndex]!.push(sourceIndex);
  });

  let rank = new Array<number>(n).fill(1 / n);
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;

    // The classic dangling-node bug: a page with zero outlinks must redistribute its rank across
    // every node each pass, not vanish — otherwise total rank leaks below 1.0 over iterations.
    let danglingSum = 0;
    for (let i = 0; i < n; i++) {
      if (nodes[i]!.outEdges.length === 0) danglingSum += rank[i]!;
    }
    const base = (1 - damping) / n;
    const danglingShare = (damping * danglingSum) / n;

    const newRank = new Array<number>(n);
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      let incoming = 0;
      for (const j of inEdges[i]!) incoming += rank[j]! / nodes[j]!.outEdges.length;
      const raw = base + danglingShare + damping * incoming;
      // Floor to keep log-scaling finite even under a non-default damping of 1.0.
      const value = raw > 0 ? raw : Number.EPSILON;
      newRank[i] = value;
      maxDelta = Math.max(maxDelta, Math.abs(value - rank[i]!));
    }
    rank = newRank;
    if (maxDelta < epsilon) {
      converged = true;
      break;
    }
  }

  // Reused verbatim from the analyzer so orphan/inlink evidence matches issue evidence exactly.
  const inlinkOccurrences = buildInlinkOccurrences(pages);

  const logRanks = rank.map((r) => Math.log(r));
  let minLog = Infinity;
  let maxLog = -Infinity;
  for (const l of logRanks) {
    if (l < minLog) minLog = l;
    if (l > maxLog) maxLog = l;
  }
  const spread = maxLog - minLog;

  // Ahrefs' model: log-scaled 1-100, top page ~100. No variance (e.g. a symmetric cycle, or a
  // single-page graph) means every node is equally the best page available — all score 100.
  function scaleToInternalRank(logRank: number): number {
    if (spread === 0) return 100;
    const scaled = 1 + (99 * (logRank - minLog)) / spread;
    return Math.round(Math.max(1, Math.min(100, scaled)));
  }

  // buildInlinkOccurrences is keyed by bare PATHNAME (helpers.ts owns that convention), coarser
  // than this module's path+query node identity — a query-string sibling page would otherwise
  // inherit its neighbor's whole inlink bucket. Narrow the pathname-level bucket down to the
  // occurrences whose own resolved target actually matches this node's key, and (as before) drop
  // self-links, which aren't a vote of confidence from elsewhere.
  const inlinksByNode = nodes.map((node) => {
    const pathname = pathnameOf(primaryUrl(node.page)) ?? primaryUrl(node.page);
    const candidates = inlinkOccurrences.get(pathname) ?? [];
    return candidates.filter((o) => {
      if (o.source === node.page) return false;
      const occurrenceTargetKey = pathAndQueryOf(o.link.targetNormalized ?? o.link.target);
      return occurrenceTargetKey === node.key;
    });
  });

  const scores: PageGraphScore[] = nodes.map((node, i) => {
    const occurrences = inlinksByNode[i]!;
    const uniqueSources = new Set(occurrences.map((o) => o.source));
    return {
      pageId: pageIdFor(node.page.normalizedUrl),
      url: primaryUrl(node.page),
      internalRank: scaleToInternalRank(logRanks[i]!),
      rawRank: rank[i]!,
      inlinks: occurrences.length,
      uniqueInlinks: uniqueSources.size,
      outlinks: node.outEdges.length,
      depth: node.page.crawl.depth,
    };
  });

  // Deterministic ordering: rank desc, tie-broken by URL — never Map/object iteration order.
  scores.sort((a, b) => b.rawRank - a.rawRank || a.url.localeCompare(b.url));

  // 2xx-only mirrors report/summary.ts's orphanCandidates (identical doc comment on the type) —
  // a 404 with zero inlinks is a broken link, not orphaned content; verified against a real run
  // where a crawled-but-404 page would otherwise have shown up here and report.json wouldn't.
  const orphans = nodes
    .filter(
      (node, i) =>
        node.page.statusCode !== null &&
        node.page.statusCode >= 200 &&
        node.page.statusCode < 300 &&
        !node.page.crawl.discoverySources.includes("seed") &&
        inlinksByNode[i]!.length === 0,
    )
    .map((node) => primaryUrl(node.page));

  return {
    runId,
    generatedAt: new Date().toISOString(),
    dampingFactor: damping,
    iterations,
    converged,
    pages: scores,
    orphans,
  };
}

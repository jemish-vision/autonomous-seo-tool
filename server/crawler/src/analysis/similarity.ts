/**
 * Slice C3 — real near-duplicate detection: word-shingling + MinHash + LSH banding, replacing the
 * wordCount-delta proxy that used to live in duplicates.ts. See duplicates.ts for the rule that
 * consumes findNearDuplicates().
 */
import type { CrawledPage, SimilarityCluster, SimilarityReport } from "../models/types";
import { RunStore } from "../storage/runStore";

export const DEFAULT_SHINGLE_SIZE = 5;
/** 0.9 (the original POC placeholder) would miss the seeded manifest-#18 pair, which measures
 * ~0.824 true Jaccard — see WORK_LOG.md §C3 for the measurement and the tuning rationale. */
export const DEFAULT_THRESHOLD = 0.75;
export const DEFAULT_SIGNATURE_SIZE = 128;
/** Rows per LSH band when signatureSize divides evenly; see findNearDuplicates doc + WORK_LOG.md §C3. */
const ROWS_PER_BAND = 8;

/** Word n-gram shingles of normalized text — the unit similarity is measured over. */
export function shingle(text: string, size: number): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // strip punctuation, keep letters/digits/whitespace
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const shingles = new Set<string>();
  if (size < 1 || words.length < size) return shingles;
  for (let i = 0; i + size <= words.length; i++) {
    shingles.add(words.slice(i, i + size).join(" "));
  }
  return shingles;
}

/** FNV-1a, 32-bit. Pure function of (str, seed) — no RNG, no Date, no external state — so the
 * same shingle always hashes identically anywhere, which is the determinism guarantee below relies on. */
function fnv1a(str: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const FNV_BASIS_A = 0x811c9dc5;
const FNV_BASIS_B = 0x9747b28c; // distinct offset basis -> a second, ~independent 32-bit hash

/**
 * MinHash signature. Derives `hashes` pseudo-independent hash fns from 2 real FNV-1a evaluations
 * via Kirsch-Mitzenmacher double-hashing (h_i = (h1 + i*h2) mod 2^32) instead of hashing `hashes`
 * times per shingle. Deterministic: min-reduction over a Set is order-independent, no RNG anywhere,
 * so the same shingle set always yields the identical signature — run to run, machine to machine.
 */
export function minHashSignature(shingles: Set<string>, hashes: number): number[] {
  const signature = new Array<number>(hashes).fill(Number.POSITIVE_INFINITY);
  for (const s of shingles) {
    const h1 = fnv1a(s, FNV_BASIS_A);
    const h2 = fnv1a(s, FNV_BASIS_B);
    for (let i = 0; i < hashes; i++) {
      const h = (h1 + i * h2) >>> 0;
      if (h < signature[i]!) signature[i] = h;
    }
  }
  return signature;
}

function estimateJaccard(sigA: number[], sigB: number[]): number {
  let matches = 0;
  for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) matches++;
  return matches / sigA.length;
}

function primaryUrlOf(page: CrawledPage): string {
  return page.normalizedUrl ?? page.url;
}

interface PageSignature {
  page: CrawledPage;
  pageId: string;
  signature: number[];
}

/** Minimal union-find (path compression, no ranking needed at this scale). */
class UnionFind {
  private parent = new Map<string, string>();
  private root(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = this.parent.get(x)!;
    while (r !== this.parent.get(r)) r = this.parent.get(r)!;
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.root(a);
    const rb = this.root(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  find(x: string): string {
    return this.root(x);
  }
}

/**
 * Clusters pages whose estimated Jaccard similarity (over word-shingle MinHash signatures) meets
 * `threshold`. Excludes exact duplicates (identical content.contentHash) — exact-duplicate-content
 * owns those. LSH banding (bands of ROWS_PER_BAND rows; 16 bands at the default 128-hash signature)
 * avoids O(n²) comparison — two pages are only compared if a band matches byte-for-byte, so this
 * is ~O(n) bucket lookups + a small candidate-pair pass instead of full pairwise. See WORK_LOG.md
 * §C3 for the banding-math derivation (the ~50%-recall S-curve crossing) and measured recall.
 */
export function findNearDuplicates(
  pages: CrawledPage[],
  runId: string,
  opts?: { shingleSize?: number; threshold?: number; signatureSize?: number },
): SimilarityReport {
  const shingleSize = opts?.shingleSize ?? DEFAULT_SHINGLE_SIZE;
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const signatureSize = opts?.signatureSize ?? DEFAULT_SIGNATURE_SIZE;
  const generatedAt = new Date().toISOString();
  const emptyReport: SimilarityReport = { runId, generatedAt, threshold, shingleSize, clusters: [] };

  // Exact duplicates are exact-duplicate-content's job — drop any page whose contentHash recurs
  // elsewhere in the run before signatures are even built, so a byte-identical pair can never
  // also surface here.
  const hashCounts = new Map<string, number>();
  for (const p of pages) {
    if (p.content.wordCount === 0) continue;
    hashCounts.set(p.content.contentHash, (hashCounts.get(p.content.contentHash) ?? 0) + 1);
  }

  const pageSignatures: PageSignature[] = [];
  for (const page of pages) {
    if (page.content.wordCount < shingleSize) continue; // "meaningful content" floor
    if ((hashCounts.get(page.content.contentHash) ?? 0) !== 1) continue; // has an exact-dup twin
    const shingles = shingle(page.content.text, shingleSize);
    if (shingles.size === 0) continue; // normalized to nothing (e.g. symbols-only) — no signal
    pageSignatures.push({ page, pageId: RunStore.pageIdFor(page.normalizedUrl), signature: minHashSignature(shingles, signatureSize) });
  }
  if (pageSignatures.length < 2) return emptyReport;

  const rowsPerBand = signatureSize % ROWS_PER_BAND === 0 ? ROWS_PER_BAND : signatureSize;
  const bands = Math.max(1, Math.floor(signatureSize / rowsPerBand));

  const buckets = new Map<string, PageSignature[]>();
  for (const ps of pageSignatures) {
    for (let b = 0; b < bands; b++) {
      const start = b * rowsPerBand;
      const key = `${b}:${ps.signature.slice(start, start + rowsPerBand).join(",")}`;
      const list = buckets.get(key);
      if (list) list.push(ps);
      else buckets.set(key, [ps]);
    }
  }

  const uf = new UnionFind();
  const seenPairs = new Set<string>();
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        const pairKey = a.pageId < b.pageId ? `${a.pageId}|${b.pageId}` : `${b.pageId}|${a.pageId}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        if (estimateJaccard(a.signature, b.signature) >= threshold) uf.union(a.pageId, b.pageId);
      }
    }
  }

  const groups = new Map<string, PageSignature[]>();
  for (const ps of pageSignatures) {
    const root = uf.find(ps.pageId);
    const list = groups.get(root);
    if (list) list.push(ps);
    else groups.set(root, [ps]);
  }

  // Reported similarity is the lowest pairwise estimate within the final cluster (conservative —
  // see SimilarityCluster's doc comment in models/types.ts), not just the edge(s) LSH matched on.
  // Clusters are small (a handful of members) by the time we get here, so this O(k²) pass is cheap.
  const clusters: SimilarityCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let minSim = 1;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        minSim = Math.min(minSim, estimateJaccard(members[i]!.signature, members[j]!.signature));
      }
    }
    clusters.push({
      similarity: Math.round(minSim * 1000) / 1000,
      members: members.map((m) => ({ pageId: m.pageId, url: primaryUrlOf(m.page), wordCount: m.page.content.wordCount })),
    });
  }
  clusters.sort((a, b) => b.similarity - a.similarity);

  return { runId, generatedAt, threshold, shingleSize, clusters };
}

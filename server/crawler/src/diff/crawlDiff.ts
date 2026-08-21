/** Slice C4 implements — crawl-over-crawl comparison (the monitoring story: what changed,
 * what broke, which issues are new/fixed since the last crawl). */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { CrawlDiff, CrawledPage, PageChange, PageFieldChange } from "../models/types";
import { readIssues } from "../analysis/store";
import { pathnameOf, pageIdFor, primaryUrl } from "../analysis/rules/site/helpers";

async function assertRunDirExists(runDir: string): Promise<void> {
  try {
    const s = await stat(runDir);
    if (!s.isDirectory()) throw new Error(`run directory not found: ${runDir}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`run directory not found: ${runDir}`);
    throw err;
  }
}

/** Mirrors RunStore.loadAllPages but takes a run DIRECTORY (diffRuns' callers pass paths, not
 * runIds) and skips a malformed page file instead of throwing — one bad record must never sink
 * a whole comparison. */
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
      // malformed page record — skip, never fail the whole diff over one bad file
    }
  }
  return pages;
}

/** Keyed by pathname, not the full URL — survives host aliasing / scheme drift between two
 * crawls of the same site (mirrors analysis/rules/site/helpers.ts's pathnameOf convention).
 * Falls back to the raw URL when unparseable so nothing silently drops out of the diff. */
function keyFor(page: CrawledPage): string {
  return pathnameOf(primaryUrl(page)) ?? primaryUrl(page);
}

function byKey(pages: CrawledPage[]): Map<string, CrawledPage> {
  const map = new Map<string, CrawledPage>();
  for (const p of pages) map.set(keyFor(p), p);
  return map;
}

/** The meaningful field set (brief C4 §1) — deliberately excludes raw text; content changes are
 * detected via contentHash, never by diffing extracted text. */
const FIELDS: { field: string; get: (p: CrawledPage) => unknown }[] = [
  { field: "statusCode", get: (p) => p.statusCode },
  { field: "title", get: (p) => p.title },
  { field: "metaDescription", get: (p) => p.metaDescription },
  { field: "canonical", get: (p) => p.canonical },
  { field: "robots.noindex", get: (p) => p.robots.noindex },
  { field: "h1", get: (p) => p.headings.h1.join(" | ") },
  { field: "content.contentHash", get: (p) => p.content.contentHash },
  { field: "content.wordCount", get: (p) => p.content.wordCount },
  { field: "links.length", get: (p) => p.links.length },
  { field: "images.length", get: (p) => p.images.length },
  { field: "redirectChain.length", get: (p) => p.redirectChain.length },
  { field: "renderedWith", get: (p) => p.renderedWith },
];

function diffPage(base: CrawledPage, head: CrawledPage): PageFieldChange[] {
  const changes: PageFieldChange[] = [];
  for (const { field, get } of FIELDS) {
    const before = get(base);
    const after = get(head);
    if (before !== after) changes.push({ field, before, after });
  }
  return changes;
}

function issueKey(ruleId: string, url: string | null): string {
  return `${ruleId}::${url ?? "(site)"}`;
}

/** Prefer the stored report's own runId (survives a directory being renamed/copied); falls back
 * to the directory's basename when report.json is missing or malformed. */
async function runIdOf(runDir: string): Promise<string> {
  try {
    const report = JSON.parse(await readFile(path.join(runDir, "report.json"), "utf8")) as { runId?: string };
    if (report.runId) return report.runId;
  } catch {
    // missing/malformed report.json — fall back to the directory name
  }
  return path.basename(runDir);
}

/** Compare two stored runs by run directory. Tolerant of either run lacking issues.json. */
export async function diffRuns(baseRunDir: string, headRunDir: string): Promise<CrawlDiff> {
  await assertRunDirExists(baseRunDir);
  await assertRunDirExists(headRunDir);

  const [basePages, headPages, baseIssues, headIssues, baseRunId, headRunId] = await Promise.all([
    loadPages(baseRunDir),
    loadPages(headRunDir),
    readIssues(baseRunDir),
    readIssues(headRunDir),
    runIdOf(baseRunDir),
    runIdOf(headRunDir),
  ]);

  const baseMap = byKey(basePages);
  const headMap = byKey(headPages);

  const added = [...headMap.keys()]
    .filter((k) => !baseMap.has(k))
    .map((k) => primaryUrl(headMap.get(k)!))
    .sort();
  const removed = [...baseMap.keys()]
    .filter((k) => !headMap.has(k))
    .map((k) => primaryUrl(baseMap.get(k)!))
    .sort();

  const changed: PageChange[] = [];
  let unchangedCount = 0;
  for (const [key, headPage] of headMap) {
    const basePage = baseMap.get(key);
    if (!basePage) continue;
    const fieldChanges = diffPage(basePage, headPage);
    if (fieldChanges.length === 0) {
      unchangedCount++;
      continue;
    }
    changed.push({ url: primaryUrl(headPage), pageId: pageIdFor(headPage.normalizedUrl), changes: fieldChanges });
  }
  changed.sort((a, b) => a.url.localeCompare(b.url));

  let issues: CrawlDiff["issues"] = null;
  if (baseIssues && headIssues) {
    const baseKeys = new Set(baseIssues.issues.map((i) => issueKey(i.ruleId, i.url)));
    const headKeys = new Set(headIssues.issues.map((i) => issueKey(i.ruleId, i.url)));
    const newIssues = [...headKeys].filter((k) => !baseKeys.has(k)).sort();
    const fixedIssues = [...baseKeys].filter((k) => !headKeys.has(k)).sort();
    const persistingCount = [...headKeys].filter((k) => baseKeys.has(k)).length;
    issues = { newIssues, fixedIssues, persistingCount };
  }

  return {
    baseRunId,
    headRunId,
    generatedAt: new Date().toISOString(),
    added,
    removed,
    changed,
    unchangedCount,
    issues,
  };
}

/**
 * Post-analyze findings import. The crawler's syncRunToPostgres runs at crawl close — BEFORE the
 * dashboard's auto-analyze has written issues.json — so findings never made it into Postgres for
 * dashboard-spawned crawls. This module imports issues.json → Rule/Finding/Issue rows on demand,
 * after analysis, and is also the single shared implementation of the findings block (syncRun.ts
 * delegates to it, so the two paths can never drift).
 *
 * Finding quality (priority/confidence/effort/damage/detectionTier/why/mute) is read from the
 * report's `findings[]` array when present, not recomputed from `issues[]` — the crawler already
 * did the scoring, and re-deriving it here loses fidelity. A fallback covers older runs whose
 * issues.json predates the findings slice.
 *
 * Idempotent:
 *  - A fresh crawl (no findings yet) → full import (Rule + Finding + Issue + Crawl rollups).
 *  - A crawl that already has findings → an in-place ENRICHMENT pass that UPDATEs Finding/Rule
 *    quality from findings[] without deleting anything. Deleting findings would cascade
 *    Issue → AiRecommendation, so this path never deletes (blocker-A backfill requirement).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../../generated/client/index.js";

async function readJsonIfExists(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export interface FindingsImportResult {
  findingsInserted: number;
  /** Findings enriched in place on a re-run (backfill). 0 on a fresh import. */
  findingsUpdated: number;
  issuesInserted: number;
  skippedReason: string | null;
}

// --- disk (lowercase-dashed) → Prisma enum-name maps -------------------------------------------
const DISK_SEVERITY: Record<string, string> = { critical: "CRITICAL", error: "ERROR", warning: "WARNING", notice: "NOTICE" };
const DISK_STATUS: Record<string, string> = {
  failing: "FAILING",
  passed: "PASSED",
  "skipped-data-unavailable": "SKIPPED_DATA_UNAVAILABLE",
  errored: "ERRORED",
  muted: "MUTED",
};
const DISK_EFFORT: Record<string, string> = { low: "LOW", medium: "MEDIUM", high: "HIGH" };
const DISK_AUTOMATION: Record<string, string> = { "auto-safe": "AUTO_SAFE", "auto-with-review": "AUTO_WITH_REVIEW", "human-only": "HUMAN_ONLY" };
const DISK_TIER: Record<string, string> = { observed: "OBSERVED", derived: "DERIVED", heuristic: "HEURISTIC" };

/** The quality fields of a Finding row, mapped from a report `findings[]` entry. Shared by the
 *  full-import create path and the enrichment update path so the two can never drift. */
function findingQualityData(df: any): Record<string, unknown> {
  return {
    severity: (DISK_SEVERITY[df.severity] ?? "NOTICE") as any,
    status: (DISK_STATUS[df.status] ?? "FAILING") as any,
    affectedPages: df.affectedPages ?? 0,
    affectedInstances: df.affectedInstances ?? 0,
    evaluatedPages: df.evaluatedPages ?? 0,
    reach: df.reach ?? null,
    importance: df.importance ?? null,
    confidence: df.confidence ?? null,
    priority: typeof df.priority === "number" ? Math.round(df.priority) : 0,
    priorityFactors: df.priorityFactors ?? undefined,
    damage: df.damage ?? null,
    effort: (DISK_EFFORT[df.effort] ?? "MEDIUM") as any,
    effortWhy: df.effortWhy ?? null,
    automation: (DISK_AUTOMATION[df.automation] ?? "HUMAN_ONLY") as any,
    skipReason: df.skipReason ?? null,
    mutedAt: df.mutedAt ? new Date(df.mutedAt) : null,
    mutedNote: df.mutedNote ?? null,
    sampleUrls: Array.isArray(df.sampleUrls) ? df.sampleUrls : [],
  };
}

/** `why` + `detectionTier` + `automation` live on the Rule, not the Finding — carry them across. */
function ruleQualityData(df: any): Record<string, unknown> {
  return {
    why: typeof df.why === "string" ? df.why : "",
    detectionTier: (DISK_TIER[df.detectionTier] ?? "OBSERVED") as any,
    automation: (DISK_AUTOMATION[df.automation] ?? "HUMAN_ONLY") as any,
  };
}

function crawlRollupData(issuesReport: any): Record<string, unknown> {
  return {
    healthScore: issuesReport.healthScore ?? null,
    rulebookVersion: issuesReport.rulebookVersion ?? null,
    errorCount: issuesReport.counts?.error ?? 0,
    warningCount: issuesReport.counts?.warning ?? 0,
    noticeCount: issuesReport.counts?.notice ?? 0,
  };
}

/**
 * Shared findings block: issues.json → Rule (upsert, global) → Finding (upsert per rule) →
 * Issue (bulk) → Crawl.healthScore/counts. `pageKeyToId` maps the dashboard's 12-hex page ids
 * (stored as Issue.pageId foreign keys to Page.id) and `evaluatedPages` sizes the reach math.
 */
export async function importFindingsForCrawl(
  prisma: PrismaClient,
  crawl: { id: string; projectId: string },
  runDir: string,
  pageKeyToId: Map<string, string>,
  evaluatedPages: number,
): Promise<FindingsImportResult> {
  const issuesReport = await readJsonIfExists(path.join(runDir, "issues.json"));
  if (!issuesReport?.issues?.length) {
    return { findingsInserted: 0, findingsUpdated: 0, issuesInserted: 0, skippedReason: "no issues.json or no issues" };
  }

  // Real per-rule quality (priority/effort/confidence/why/...) — index by ruleId.
  const diskFindings: any[] = Array.isArray(issuesReport.findings) ? issuesReport.findings : [];
  const findingByRule = new Map<string, any>();
  for (const f of diskFindings) if (!findingByRule.has(f.ruleId)) findingByRule.set(f.ruleId, f);

  // Per-issue threshold has no dedicated Issue column; it is constant per rule, so capture it once
  // and stash it into Issue.proposedFix { threshold } (read back by readStore.ts). See that file.
  const thresholdByRule = new Map<string, string>();
  for (const i of issuesReport.issues) {
    if (typeof i.threshold === "string" && i.threshold && !thresholdByRule.has(i.ruleId)) thresholdByRule.set(i.ruleId, i.threshold);
  }

  const findingsAlreadyImported = (await prisma.finding.count({ where: { crawlId: crawl.id } })) > 0;

  // --- enrichment path (backfill re-run): findings exist. UPDATE quality in place; never delete. ---
  if (findingsAlreadyImported) {
    if (diskFindings.length === 0) {
      return { findingsInserted: 0, findingsUpdated: 0, issuesInserted: 0, skippedReason: "findings already imported" };
    }
    let findingsUpdated = 0;
    for (const [ruleId, df] of findingByRule) {
      const res = await prisma.finding.updateMany({ where: { crawlId: crawl.id, ruleSlug: ruleId }, data: findingQualityData(df) });
      findingsUpdated += res.count;
      await prisma.rule.updateMany({ where: { projectId: null, slug: ruleId, version: 1 }, data: ruleQualityData(df) });
      const threshold = thresholdByRule.get(ruleId);
      if (threshold) {
        await prisma.issue.updateMany({ where: { crawlId: crawl.id, ruleSlug: ruleId }, data: { proposedFix: { threshold } } });
      }
    }
    await prisma.crawl.update({ where: { id: crawl.id }, data: crawlRollupData(issuesReport) });
    return { findingsInserted: 0, findingsUpdated, issuesInserted: 0, skippedReason: null };
  }

  // --- full import path (fresh crawl) ---
  const byRule = new Map<string, any[]>();
  for (const issue of issuesReport.issues) {
    if (!byRule.has(issue.ruleId)) byRule.set(issue.ruleId, []);
    byRule.get(issue.ruleId)!.push(issue);
  }

  let findingsInserted = 0;
  let issuesInserted = 0;

  for (const [ruleId, ruleIssues] of byRule) {
    const first = ruleIssues[0];
    const df = findingByRule.get(ruleId);
    // Global rule row (projectId NULL). NOTE: Prisma rejects `projectId: null` in an upsert
    // WHERE (the compound-unique identifier must be non-null — NULL never matches a Postgres
    // unique index), so the global-rule pattern is findFirst-or-create, not upsert. The find
    // makes it idempotent; the catch covers a concurrent create racing this one.
    const rule =
      (await prisma.rule.findFirst({ where: { projectId: null, slug: ruleId, version: 1 } })) ??
      (await prisma.rule
        .create({
          data: {
            projectId: null,
            slug: ruleId,
            version: 1,
            scope: (df?.scope === "site" || first.scope === "site" ? "SITE" : "PAGE") as any,
            category: df?.category ?? first.category ?? "general",
            defaultSeverity: (DISK_SEVERITY[df?.severity ?? first.severity ?? "notice"] ?? "NOTICE") as any,
            title: ruleId,
            why: df?.why ?? "",
            howToFix: df?.howToFix ?? first.howToFix ?? "",
            detectionTier: (DISK_TIER[df?.detectionTier ?? "observed"] ?? "OBSERVED") as any,
            automation: (DISK_AUTOMATION[df?.automation ?? "human-only"] ?? "HUMAN_ONLY") as any,
          },
        })
        .catch(async () => {
          const raced = await prisma.rule.findFirst({ where: { projectId: null, slug: ruleId, version: 1 } });
          if (!raced) throw new Error(`rule create raced and vanished for slug "${ruleId}"`);
          return raced;
        }));

    // A pre-existing global rule may carry no why/detectionTier (created by an older run); enrich it
    // from this run's findings[] so the read side has the real explainer.
    if (df && (!rule.why || rule.why.length === 0)) {
      await prisma.rule.updateMany({ where: { id: rule.id }, data: ruleQualityData(df) });
    }

    const affectedPageKeys = new Set(ruleIssues.map((i) => i.pageId).filter(Boolean));
    const affectedPages = affectedPageKeys.size;
    const reach = Math.sqrt(Math.min(1, affectedPages / (evaluatedPages || 1)));

    // Race-safe upsert: the crawler child's own POSTGRES_SYNC_ENABLED sync and this dashboard's
    // syncRunToDb can import the same crawl concurrently — both pass the findingsAlreadyImported
    // count guard, then the second finding.upsert create collides on (crawlId, ruleSlug) (P2002).
    // On collision, adopt the winner's row and skip the issue batch (the winner inserted it).
    const createData = df
      ? {
          crawlId: crawl.id,
          projectId: crawl.projectId,
          ruleId: rule.id,
          ruleSlug: ruleId,
          scope: rule.scope,
          category: rule.category,
          ...findingQualityData(df),
        }
      : {
          crawlId: crawl.id,
          projectId: crawl.projectId,
          ruleId: rule.id,
          ruleSlug: ruleId,
          scope: rule.scope,
          category: rule.category,
          severity: rule.defaultSeverity,
          status: "FAILING" as any,
          affectedPages,
          affectedInstances: ruleIssues.length,
          evaluatedPages,
          reach,
          sampleUrls: [...new Set(ruleIssues.map((i) => i.url).filter(Boolean))].slice(0, 5),
        };

    let finding: { id: string } | null = null;
    let createdThisCall = false;
    try {
      finding = await prisma.finding.upsert({
        where: { crawlId_ruleSlug: { crawlId: crawl.id, ruleSlug: ruleId } },
        update: {},
        create: createData as any,
      });
      createdThisCall = true;
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002") {
        const existing = await prisma.finding.findFirst({ where: { crawlId: crawl.id, ruleSlug: ruleId } });
        if (!existing) throw err; // vanished mid-race — surface it rather than silently dropping
        finding = existing;
      } else {
        throw err;
      }
    }
    if (finding === null) throw new Error('finding upsert produced no row for "' + ruleId + '"');
    if (createdThisCall) {
      findingsInserted++;

      const threshold = thresholdByRule.get(ruleId);
      await prisma.issue.createMany({
        data: ruleIssues.map((i) => ({
          crawlId: crawl.id,
          projectId: crawl.projectId,
          findingId: finding!.id,
          ruleId: rule.id,
          ruleSlug: ruleId,
          pageId: i.pageId ? (pageKeyToId.get(i.pageId) ?? null) : null,
          severity: (DISK_SEVERITY[i.severity ?? "notice"] ?? "NOTICE") as any,
          category: i.category ?? "general",
          message: i.message ?? "",
          evidencePaths: Array.isArray(i.evidence) ? i.evidence.map((e: any) => e.field).filter(Boolean) : [],
          evidence: i.evidence ?? null,
          // Per-issue threshold has no column; stash it here (readStore reads it back).
          proposedFix: typeof i.threshold === "string" && i.threshold ? { threshold: i.threshold } : threshold ? { threshold } : undefined,
        })),
      });
      issuesInserted += ruleIssues.length;
    }
  }

  await prisma.crawl.update({ where: { id: crawl.id }, data: crawlRollupData(issuesReport) });

  return { findingsInserted, findingsUpdated: 0, issuesInserted, skippedReason: null };
}

/** Standalone entry point (dashboard post-analyze sync + packages/db CLI): resolves the crawl row
 *  and the pageKey→Page.id map, then delegates to the shared block above. */
export async function importIssuesToPostgres(prisma: PrismaClient, runDir: string, runId: string): Promise<FindingsImportResult> {
  const crawl = await prisma.crawl.findFirst({ where: { slug: runId } });
  if (!crawl) throw new Error(`importIssuesToPostgres: no crawl row for runId "${runId}"`);
  const pages = await prisma.page.findMany({ where: { crawlId: crawl.id }, select: { id: true, pageKey: true } });
  const pageKeyToId = new Map(pages.map((p) => [p.pageKey, p.id]));
  return importFindingsForCrawl(prisma, crawl, runDir, pageKeyToId, crawl.pagesCrawled || 1);
}

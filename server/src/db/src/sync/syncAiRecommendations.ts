import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../../generated/client/index.js";

/**
 * Syncs poc/seo-dashboard's ai-recommendations.json into the `ai_recommendations` table
 * (qi-feature-plam.md §10). The dashboard POC generates recommendations to a flat JSON file next
 * to issues.json/fix-plan.json; this pass is the production persistence target that file was
 * always meant to feed. Mirrors syncRunToPostgres's conventions: cursor-free whole-file read (the
 * report is ≤ ITEM_CAP=500 rows, not the multi-MB page corpus), idempotent upsert keyed on
 * @@unique([issueId, instanceKey]), and a result object the caller logs — never a silent drop.
 *
 * Linking rule: a recommendation carries the dashboard's pageId (the crawler's pageKey — the
 * 12-char hash, see poc/seo-dashboard/lib/types.ts) and issueRuleId. We resolve it to an Issue row
 * by (crawlId, ruleSlug, pageKey); for multi-instance rules ("images[3]") we additionally match the
 * recommendation's instanceKey against the issue's evidencePaths so image-missing-alt lands on the
 * right row. Recommendations that can't be linked are reported, not guessed.
 */
export interface SyncAiRecommendationsResult {
  runId: string;
  crawlId: string | null;
  totalInFile: number;
  inserted: number;
  updated: number;
  unlinked: number;
  unlinkedReasons: { ruleSlug: string; pageKey: string | null; instanceKey: string | null; reason: string }[];
}

const CHUNK = 25;

async function readJsonIfExists(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function syncAiRecommendations(
  prisma: PrismaClient,
  runDir: string,
  runId: string,
): Promise<SyncAiRecommendationsResult> {
  const report = await readJsonIfExists(path.join(runDir, "ai-recommendations.json"));
  const recommendations: any[] = Array.isArray(report?.recommendations) ? report.recommendations : [];

  const base: SyncAiRecommendationsResult = {
    runId,
    crawlId: null,
    totalInFile: recommendations.length,
    inserted: 0,
    updated: 0,
    unlinked: recommendations.length,
    unlinkedReasons: [],
  };
  if (recommendations.length === 0) return base;

  // slug embeds the host (e.g. "visioninfotech.net-20260813-164500"), so it is effectively
  // unique; take the most recent if a collision ever occurs rather than guessing.
  const crawl = await prisma.crawl.findFirst({ where: { slug: runId }, orderBy: { startedAt: "desc" } });
  if (!crawl) {
    return {
      ...base,
      unlinkedReasons: [
        { ruleSlug: "", pageKey: null, instanceKey: null, reason: `crawl "${runId}" not in Postgres — run syncRunToPostgres first` },
      ],
    };
  }

  const pages = await prisma.page.findMany({ where: { crawlId: crawl.id }, select: { id: true, pageKey: true } });
  const pageKeyToId = new Map(pages.map((p) => [p.pageKey, p.id]));
  const pageIdToKey = new Map(pages.map((p) => [p.id, p.pageKey]));

  // Index the crawl's issues: primary key ruleSlug::pageKey, plus instance-level keys derived from
  // evidencePaths ("images[3].alt" -> "images[3]") so multi-instance rules resolve exactly.
  const issues = await prisma.issue.findMany({
    where: { crawlId: crawl.id },
    select: { id: true, ruleSlug: true, pageId: true, evidencePaths: true },
  });
  const byRulePage = new Map<string, string>();
  const byRulePageInstance = new Map<string, string>();
  for (const issue of issues) {
    const pageKey = issue.pageId ? (pageIdToKey.get(issue.pageId) ?? null) : null;
    const key = `${issue.ruleSlug}::${pageKey ?? "site"}`;
    if (!byRulePage.has(key)) byRulePage.set(key, issue.id);
    for (const evidencePath of issue.evidencePaths ?? []) {
      const instance = String(evidencePath).split(".")[0];
      if (!instance) continue;
      const ikey = `${issue.ruleSlug}::${pageKey ?? "site"}::${instance}`;
      if (!byRulePageInstance.has(ikey)) byRulePageInstance.set(ikey, issue.id);
    }
  }

  const preExisting = await prisma.aiRecommendation.count({ where: { crawlId: crawl.id } });

  const unlinkedReasons: SyncAiRecommendationsResult["unlinkedReasons"] = [];
  let upserted = 0;
  const linked: { issueId: string; rec: any }[] = [];

  for (const rec of recommendations) {
    const pageKey = rec.pageId ?? null;
    const issueId =
      byRulePageInstance.get(`${rec.issueRuleId}::${pageKey ?? "site"}::${rec.instanceKey ?? ""}`) ??
      byRulePage.get(`${rec.issueRuleId}::${pageKey ?? "site"}`);
    if (!issueId) {
      unlinkedReasons.push({
        ruleSlug: rec.issueRuleId ?? "?",
        pageKey,
        instanceKey: rec.instanceKey ?? null,
        reason: "no matching Issue row for this rule+page in the synced crawl",
      });
      continue;
    }
    linked.push({ issueId, rec });
  }

  for (let i = 0; i < linked.length; i += CHUNK) {
    const chunk = linked.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(({ issueId, rec }) =>
        prisma.aiRecommendation.upsert({
          // instanceKey is stored as "" (never null) so the @@unique([issueId, instanceKey])
          // upsert matches reliably — Postgres treats NULLs as distinct in unique constraints.
          where: { issueId_instanceKey: { issueId, instanceKey: rec.instanceKey ?? "" } },
          update: {
            crawlId: crawl.id,
            projectId: crawl.projectId,
            ruleSlug: rec.issueRuleId,
            category: rec.category,
            url: rec.url ?? null,
            pageId: rec.pageId ? (pageKeyToId.get(rec.pageId) ?? null) : null,
            model: rec.model,
            promptVersion: rec.promptVersion,
            whatIsWrong: rec.whatIsWrong,
            currentValue: rec.currentValue ?? null,
            recommendedValue: rec.recommendedValue,
            recommendedValuePlain: rec.recommendedValuePlain ?? null,
            whyThisValue: rec.whyThisValue,
            basedOn: rec.basedOn ?? [],
            howToApply: rec.howToApply,
            confidence: rec.confidence,
            selfReportedConfidence: rec.selfReportedConfidence ?? null,
            needsHumanInput: !!rec.needsHumanInput,
            needsHumanInputReason: rec.needsHumanInputReason ?? null,
            validation: rec.validation ?? {},
            contentHash: rec.contentHash ?? null,
            evidenceSig: rec.evidenceSig ?? null,
          },
          create: {
            crawlId: crawl.id,
            projectId: crawl.projectId,
            issueId,
            ruleSlug: rec.issueRuleId,
            category: rec.category,
            url: rec.url ?? null,
            pageId: rec.pageId ? (pageKeyToId.get(rec.pageId) ?? null) : null,
            instanceKey: rec.instanceKey ?? "",
            model: rec.model,
            promptVersion: rec.promptVersion,
            whatIsWrong: rec.whatIsWrong,
            currentValue: rec.currentValue ?? null,
            recommendedValue: rec.recommendedValue,
            recommendedValuePlain: rec.recommendedValuePlain ?? null,
            whyThisValue: rec.whyThisValue,
            basedOn: rec.basedOn ?? [],
            howToApply: rec.howToApply,
            confidence: rec.confidence,
            selfReportedConfidence: rec.selfReportedConfidence ?? null,
            needsHumanInput: !!rec.needsHumanInput,
            needsHumanInputReason: rec.needsHumanInputReason ?? null,
            validation: rec.validation ?? {},
            contentHash: rec.contentHash ?? null,
            evidenceSig: rec.evidenceSig ?? null,
          },
        }),
      ),
    );
    upserted += chunk.length;
  }

  // Record that this run now has a generated AI-recommendation report, so the read route reports
  // generated: true even in the edge case where the imported report linked zero rows. Mirrors the
  // marker the live generate route stamps (aiRecommendationsGenerate.routes.ts).
  await prisma.crawl.update({ where: { id: crawl.id }, data: { aiRecsGeneratedAt: new Date() } });

  // Approximate inserted vs updated from the pre-existing row count — Prisma's upsert doesn't
  // report which branch ran, and a cheap COUNT is close enough for the operator's log line.
  const updated = Math.min(preExisting, upserted);
  const inserted = upserted - updated;

  return {
    runId,
    crawlId: crawl.id,
    totalInFile: recommendations.length,
    inserted,
    updated,
    unlinked: unlinkedReasons.length,
    unlinkedReasons,
  };
}

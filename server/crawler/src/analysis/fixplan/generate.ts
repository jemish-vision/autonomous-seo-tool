/** Turns every auto-safe finding into a concrete per-URL proposed change. Read-only over a
 * stored run's issues.json + page records — never fetches, never writes to the site, never
 * applies anything (see types.ts). */
import path from "node:path";
import { readIssues } from "../store";
import { buildCatalogMap } from "../automation/registry";
import { readPagesById } from "./pages";
import { FIX_PLAN_BUILDERS } from "./builders";
import type { FixPlan, FixPlanItem, FixPlanSkip } from "./types";

const ITEM_CAP = 500;

export async function generateFixPlan(runDir: string): Promise<FixPlan> {
  const analysis = await readIssues(runDir);
  if (!analysis) {
    throw new Error(`no issues.json in ${runDir} — run \`npm run analyze -- --run ${path.basename(runDir)}\` first`);
  }

  const catalog = buildCatalogMap();
  const autoSafeIssues = analysis.issues.filter((i) => catalog.get(i.ruleId)?.automation === "auto-safe");

  const needsPageRecord = autoSafeIssues.some((i) => i.ruleId === "canonical-absent" || i.ruleId === "image-missing-dimensions");
  const pagesById = needsPageRecord ? await readPagesById(runDir) : new Map();

  const items: FixPlanItem[] = [];
  const skipped: FixPlanSkip[] = [];
  const findingsByRule = new Map<string, number>();

  for (const issue of autoSafeIssues) {
    findingsByRule.set(issue.ruleId, (findingsByRule.get(issue.ruleId) ?? 0) + 1);
    const builder = FIX_PLAN_BUILDERS[issue.ruleId];
    if (!builder) {
      // Classified auto-safe but nobody wired a generator — surfaced loudly, never silently dropped.
      skipped.push({ rule: issue.ruleId, url: issue.url, reason: "classified auto-safe but no fix-plan builder is wired for this rule id" });
      continue;
    }
    const page = issue.pageId ? (pagesById.get(issue.pageId) ?? null) : null;
    const result = builder(issue, page);
    items.push(...result.items);
    skipped.push(...result.skipped);
  }

  return {
    runId: analysis.runId,
    generatedAt: new Date().toISOString(),
    applied: false,
    note:
      "These changes are safe to apply automatically — the correct value is computable from data already " +
      "captured, the change is reversible, and the blast radius is one page. This tool does not apply them; " +
      "review and ship through your own deploy path.",
    rules: [...findingsByRule.entries()].map(([id, findings]) => ({ id, findings })),
    totalChanges: items.length,
    items: items.slice(0, ITEM_CAP),
    skipped,
  };
}

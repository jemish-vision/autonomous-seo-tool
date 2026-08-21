/** Slice C4 implements: npm run diff -- --base <runId> --head <runId> [--out storage]
 * Extended for cross-site competitor comparison: npm run diff -- --base <ourRunId> --competitor <theirRunId> */
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import path from "node:path";
import { diffRuns } from "./crawlDiff";
import { compareCompetitor } from "./competitorDiff";
import type { CompetitorComparison } from "./competitorDiff";
import type { CrawlDiff } from "../models/types";

const HELP_TEXT = `
seo-crawler-poc diff — crawl-over-crawl comparison between two stored runs

Usage:
  npm run diff -- --base <runId> --head <runId> [options]              (same-site, over time)
  npm run diff -- --base <ourRunId> --competitor <theirRunId> [options] (cross-site, vs a competitor)

Options:
  --base ID        Baseline / "ours" run identifier under storage/runs/ (required)
  --head ID        Comparison run identifier under storage/runs/ — same-site mode
  --competitor ID   Competitor's run identifier under storage/runs/ — cross-site mode
  --out DIR        Storage root both runs live under (default: storage)
  -h, --help       Show this help

Same-site mode writes storage/diffs/<base>__<head>.json.
Competitor mode writes storage/diffs/<base>__vs__<competitor>.json and never produces a
page-level diff — see the report's notComparable list for what cross-domain comparison refuses
to claim.
`.trim();

function printSummary(diff: CrawlDiff): void {
  console.log(`\nDiff: ${diff.baseRunId} -> ${diff.headRunId}`);
  console.log(
    `  added: ${diff.added.length} | removed: ${diff.removed.length} | changed: ${diff.changed.length} | unchanged: ${diff.unchangedCount}`,
  );
  console.log(
    diff.issues
      ? `  issues: ${diff.issues.newIssues.length} new, ${diff.issues.fixedIssues.length} fixed, ${diff.issues.persistingCount} persisting`
      : "  issues: not available — both runs need issues.json (npm run analyze) to compute the lifecycle",
  );

  if (diff.changed.length > 0) {
    console.log("  top changed URLs:");
    for (const c of diff.changed.slice(0, 10)) {
      console.log(`    ${c.url}`);
      for (const ch of c.changes) console.log(`      ${ch.field}: ${JSON.stringify(ch.before)} -> ${JSON.stringify(ch.after)}`);
    }
  }
}

function printCompetitorSummary(cmp: CompetitorComparison): void {
  console.log(`\nCompetitor comparison: ${cmp.ourSite} (${cmp.ourRunId}) vs ${cmp.competitorSite} (${cmp.competitorRunId})`);
  console.log(`  pages: ours=${cmp.pageCounts.ours} theirs=${cmp.pageCounts.theirs}`);
  console.log("  measurement grid:");
  for (const m of cmp.grid) {
    const status = m.comparable ? "" : "  [not comparable]";
    console.log(`    ${m.metric.padEnd(28)} ours=${m.ours ?? "n/a"}  theirs=${m.theirs ?? "n/a"}  delta=${m.delta ?? "n/a"} (${m.unit})${status}`);
    if (m.note) console.log(`      note: ${m.note}`);
  }
  if (cmp.structuredDataCoverage.length > 0) {
    console.log("  structured-data type coverage:");
    for (const row of cmp.structuredDataCoverage) {
      console.log(`    ${row.type.padEnd(24)} ours=${row.ourPages}/${cmp.pageCounts.ours} (${row.ourPagesPct}%)  theirs=${row.theirPages}/${cmp.pageCounts.theirs} (${row.theirPagesPct}%)`);
    }
  }
  console.log("  not comparable (refused, not fabricated):");
  for (const reason of cmp.notComparable) console.log(`    - ${reason}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: "string" },
      head: { type: "string" },
      competitor: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const { base, head, competitor } = values;
  if (!base || (!head && !competitor)) {
    console.error("Error: missing --base <runId>, and either --head <runId> or --competitor <runId>.\n");
    console.log(HELP_TEXT);
    process.exit(1);
    return;
  }
  if (head && competitor) {
    console.error("Error: --head and --competitor are mutually exclusive (same-site vs cross-site mode).\n");
    console.log(HELP_TEXT);
    process.exit(1);
    return;
  }

  const outDir = values.out ?? "storage";
  const baseRunDir = path.resolve(outDir, "runs", base);
  const diffsDir = path.resolve(outDir, "diffs");
  await mkdir(diffsDir, { recursive: true });

  if (competitor) {
    const competitorRunDir = path.resolve(outDir, "runs", competitor);
    console.log(`Comparing vs competitor: ${base} vs ${competitor}`);
    console.log(`  ours: ${baseRunDir}`);
    console.log(`  theirs: ${competitorRunDir}`);

    const cmp = await compareCompetitor(baseRunDir, competitorRunDir);
    const outFile = path.join(diffsDir, `${base}__vs__${competitor}.json`);
    await writeFile(outFile, JSON.stringify(cmp, null, 2), "utf8");
    console.log(`  wrote ${outFile}`);

    printCompetitorSummary(cmp);
    process.exit(0);
    return;
  }

  const headRunDir = path.resolve(outDir, "runs", head!);
  console.log(`Comparing runs: ${base} -> ${head}`);
  console.log(`  base: ${baseRunDir}`);
  console.log(`  head: ${headRunDir}`);

  const diff = await diffRuns(baseRunDir, headRunDir);

  const outFile = path.join(diffsDir, `${base}__${head}.json`);
  await writeFile(outFile, JSON.stringify(diff, null, 2), "utf8");
  console.log(`  wrote ${outFile}`);

  printSummary(diff);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

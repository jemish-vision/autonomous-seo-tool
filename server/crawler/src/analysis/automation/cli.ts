/** npm run analyze:automation -- [--run <runId>] [--out storage]
 * No --run: prints the rulebook-wide classification (every rule currently registered).
 * With --run: also loads that run's issues.json and writes automation-report.json alongside it. */
import { parseArgs } from "node:util";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { classifyRulebook } from "./registry";
import { buildAutomationReport } from "./report";
import { readIssues } from "../store";

const HELP_TEXT = `
seo-crawler-poc automation classifier — FR-3.7: which findings can be fixed safely?

Usage:
  tsx src/analysis/automation/cli.ts [--run <runId>] [--out storage]

Options:
  --run ID    Also load storage/<out>/runs/<runId>/issues.json and write automation-report.json
  --out DIR   Storage root (default: storage)
  -h, --help  Show this help
`.trim();

function printRulebook(): void {
  const { catalog, counts } = classifyRulebook();
  console.log(`\nRulebook classification (${counts.totalRules} rules, ${counts.reviewedCount} individually reviewed)`);
  console.log(`  auto-safe: ${counts["auto-safe"]} | auto-with-review: ${counts["auto-with-review"]} | human-only: ${counts["human-only"]}`);
  if (counts.unreviewedIds.length) {
    console.log(`  unreviewed (conservative default applied): ${counts.unreviewedIds.join(", ")}`);
  }
  const autoSafe = catalog.filter((e) => e.automation === "auto-safe");
  console.log(`\n  auto-safe rules (${autoSafe.length}):`);
  for (const e of autoSafe) console.log(`    ${e.id} — ${e.rationale}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  printRulebook();

  if (values.run) {
    const outDir = values.out ?? "storage";
    const runDir = path.resolve(outDir, "runs", values.run);
    const analysis = await readIssues(runDir);
    if (!analysis) {
      console.error(`\nNo issues.json in ${runDir} — run \`npm run analyze -- --run ${values.run}\` first.`);
      process.exit(1);
      return;
    }
    const report = buildAutomationReport(analysis);
    console.log(`\nRun ${report.runId} (${report.pagesAnalyzed} pages analyzed):`);
    console.log(`  auto-safe: ${report.counts["auto-safe"]} rules fired | auto-with-review: ${report.counts["auto-with-review"]} | human-only: ${report.counts["human-only"]}`);
    if (report.unreviewedRuleIds.length) {
      console.log(`  unreviewed rule ids that fired: ${report.unreviewedRuleIds.join(", ")}`);
    }
    const outFile = path.join(runDir, "automation-report.json");
    await writeFile(outFile, JSON.stringify(report, null, 2), "utf8");
    console.log(`  wrote ${outFile}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

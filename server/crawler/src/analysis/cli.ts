/** Slice A4 implements: npm run analyze -- --run <runId> [--config path] [--out storage] */
import { parseArgs } from "node:util";
import path from "node:path";
import { loadConfig } from "./config";
import { runAnalysis } from "./engine";
import type { AnalysisReport } from "../models/types";

const HELP_TEXT = `
seo-crawler-poc analyzer — deterministic SEO rulebook over a stored crawl run

Usage:
  npm run analyze -- --run <runId> [options]

Options:
  --run ID        Run identifier under storage/runs/ (required)
  --config PATH   Path to a custom analysis.config.json (default: built-in defaults)
  --out DIR       Storage root the run lives under (default: storage)
  -h, --help      Show this help

Writes storage/<runId>/issues.json and prints a summary.
`.trim();

function printSummary(report: AnalysisReport): void {
  console.log(`\nAnalysis: ${report.runId}`);
  console.log(`  rulebook: ${report.rulebookVersion} | pagesAnalyzed: ${report.pagesAnalyzed} | healthScore: ${report.healthScore}`);
  console.log(
    `  issues: ${report.counts.error} error, ${report.counts.warning} warning, ${report.counts.notice} notice (${report.issues.length} total)`,
  );
  console.log(`  rulesRun: ${report.rulesRun}${report.rulesSkippedDataUnavailable.length ? ` | skipped (data unavailable): ${report.rulesSkippedDataUnavailable.join(", ")}` : ""}`);

  const byRule = new Map<string, number>();
  for (const issue of report.issues) byRule.set(issue.ruleId, (byRule.get(issue.ruleId) ?? 0) + 1);
  const top = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) {
    console.log("  top rules:");
    for (const [ruleId, count] of top) console.log(`    ${count.toString().padStart(4)}  ${ruleId}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: "string" },
      config: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const runId = values.run;
  if (!runId) {
    console.error("Error: missing --run <runId>.\n");
    console.log(HELP_TEXT);
    process.exit(1);
    return;
  }

  const outDir = values.out ?? "storage";
  const runDir = path.resolve(outDir, "runs", runId);

  const config = await loadConfig(values.config);
  console.log(`Analyzing run: ${runId}`);
  console.log(`  runDir: ${runDir} | rulebook: ${config.rulebookVersion}`);

  const report = await runAnalysis(runDir, config);
  printSummary(report);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

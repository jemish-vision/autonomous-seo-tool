/** npm run fixplan -- --run <runId> [--out storage]
 * Requires issues.json to already exist for the run (run the analyzer first). */
import { parseArgs } from "node:util";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { generateFixPlan } from "./generate";

const HELP_TEXT = `
seo-crawler-poc fix-plan generator — concrete per-URL changes for every auto-safe finding.
Generates plans only; never applies them (see src/analysis/fixplan/types.ts).

Usage:
  tsx src/analysis/fixplan/cli.ts --run <runId> [--out storage]

Options:
  --run ID    Run identifier under storage/runs/ (required) — must already have issues.json
  --out DIR   Storage root (default: storage)
  -h, --help  Show this help

Writes storage/<runId>/fix-plan.json and prints a summary.
`.trim();

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

  if (!values.run) {
    console.error("Error: missing --run <runId>.\n");
    console.log(HELP_TEXT);
    process.exit(1);
    return;
  }

  const outDir = values.out ?? "storage";
  const runDir = path.resolve(outDir, "runs", values.run);

  const plan = await generateFixPlan(runDir);

  console.log(`\nFix plan: ${plan.runId}`);
  console.log(`  applied: ${plan.applied} (this tool never applies changes)`);
  console.log(`  rules: ${plan.rules.map((r) => `${r.id} (${r.findings})`).join(", ") || "none"}`);
  console.log(`  totalChanges: ${plan.totalChanges}${plan.totalChanges > plan.items.length ? ` (showing first ${plan.items.length})` : ""}`);
  if (plan.skipped.length) {
    console.log(`  skipped: ${plan.skipped.length} (auto-safe finding(s) with no safe concrete value — see fix-plan.json.skipped)`);
  }

  const outFile = path.join(runDir, "fix-plan.json");
  await writeFile(outFile, JSON.stringify(plan, null, 2), "utf8");
  console.log(`  wrote ${outFile}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

/** Slice C2 implements: npm run graph -- --run <runId> [--out storage] [--damping N] */
import { parseArgs } from "node:util";
import { RunStore } from "../storage/runStore";
import { DEFAULT_DAMPING } from "./pagerank";
import { ensureGraphReport } from "./runGraph";
import type { GraphReport } from "../models/types";

const HELP_TEXT = `
seo-crawler-poc graph — internal PageRank over a stored crawl run's link graph

Usage:
  npm run graph -- --run <runId> [options]

Options:
  --run ID              Run identifier under storage/runs/ (required)
  --out DIR             Storage root the run lives under (default: storage)
  --damping N           Damping factor, 0-1 (default: ${DEFAULT_DAMPING})
  --max-iterations N    Convergence cap (default: 100)
  --epsilon N           Convergence threshold (default: 1e-6)
  -h, --help            Show this help

Writes storage/runs/<runId>/graph.json and prints a top-10 table + orphan count.
`.trim();

function printSummary(report: GraphReport): void {
  console.log(`\nGraph: ${report.runId}`);
  console.log(
    `  damping: ${report.dampingFactor} | iterations: ${report.iterations} | converged: ${report.converged} | pages: ${report.pages.length}`,
  );
  console.log(`  orphans: ${report.orphans.length}`);

  const top = [...report.pages]
    .sort((a, b) => b.internalRank - a.internalRank || b.rawRank - a.rawRank)
    .slice(0, 10);
  console.log("  top 10 by internalRank:");
  for (const p of top) {
    console.log(
      `    ${p.internalRank.toString().padStart(3)}  ${p.url}  (in:${p.inlinks}/${p.uniqueInlinks} out:${p.outlinks} depth:${p.depth})`,
    );
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: "string" },
      out: { type: "string" },
      damping: { type: "string" },
      "max-iterations": { type: "string" },
      epsilon: { type: "string" },
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
  const store = new RunStore(outDir, runId);
  console.log(`Computing graph for run: ${runId}`);
  console.log(`  runDir: ${store.runDir}`);

  const pages = await store.loadAllPages();
  if (pages.length === 0) {
    console.error(`Error: no pages found under ${store.runDir}\\pages — has this run been crawled?`);
    process.exit(1);
    return;
  }

  const t0 = Date.now();
  const report = await ensureGraphReport(outDir, runId, pages, {
    damping: values.damping ? Number(values.damping) : undefined,
    maxIterations: values["max-iterations"] ? Number(values["max-iterations"]) : undefined,
    epsilon: values.epsilon ? Number(values.epsilon) : undefined,
  });
  const elapsedMs = Date.now() - t0;

  console.log(`  wrote: ${store.runDir}\\graph.json`);
  console.log(`  computeGraph: ${elapsedMs}ms for ${pages.length} pages`);
  printSummary(report);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

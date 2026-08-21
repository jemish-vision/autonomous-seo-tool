/** One-call integration point so `graph.json` can become a first-class run artifact from ANY
 * pipeline stage, not just `npm run graph`. Today only src/graph/cli.ts calls computeGraph — no
 * analysis rule can read graph.json and only a couple of the ~100+ stored runs have one. Wiring
 * this into analysis/engine.ts's runAnalysis (owned by another agent) is a single call:
 *   import { ensureGraphReport } from "../graph/runGraph";
 *   const graph = await ensureGraphReport(path.dirname(runDir), path.basename(runDir), pages);
 * `pages` is optional — pass what the caller already loaded (e.g. runAnalysis's own readPages()
 * result) to skip a second disk read; omit it to have this function load them via RunStore. */
import { RunStore } from "../storage/runStore";
import { computeGraph, DEFAULT_DAMPING } from "./pagerank";
import { writeGraphReport } from "./writeGraphReport";
import type { CrawledPage, GraphReport } from "../models/types";

export async function ensureGraphReport(
  outDir: string,
  runId: string,
  pages?: CrawledPage[],
  opts?: { damping?: number; maxIterations?: number; epsilon?: number },
): Promise<GraphReport> {
  const loadedPages = pages ?? (await new RunStore(outDir, runId).loadAllPages());
  const report = computeGraph(loadedPages, runId, opts);
  await writeGraphReport(outDir, runId, report);
  return report;
}

export { DEFAULT_DAMPING };

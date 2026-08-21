/** Slice C2 — graph.json writer. Kept out of RunStore (owned by another slice) per brief. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GraphReport } from "../models/types";

export async function writeGraphReport(outDir: string, runId: string, report: GraphReport): Promise<string> {
  const runDir = path.resolve(outDir, "runs", runId);
  await mkdir(runDir, { recursive: true });
  const file = path.join(runDir, "graph.json");
  await writeFile(file, JSON.stringify(report, null, 2), "utf8");
  return file;
}

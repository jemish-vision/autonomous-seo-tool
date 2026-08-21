/** Slice A4 implements. */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import Chain from "stream-chain";
import parser from "stream-json";
import pick from "stream-json/filters/Pick.js";
import streamArray from "stream-json/streamers/StreamArray.js";
import Assembler from "stream-json/Assembler.js";
import type { AnalysisReport, Issue, IssueSeverity } from "../models/types";

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, notice: 2 };

/** severity -> ruleId -> url, so re-running the same analysis produces a byte-diffable file. */
function stableSort(report: AnalysisReport): AnalysisReport {
  const issues = [...report.issues].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const byRule = a.ruleId.localeCompare(b.ruleId);
    if (byRule !== 0) return byRule;
    return (a.url ?? "").localeCompare(b.url ?? "");
  });
  return { ...report, issues };
}

/** Writes storage/runs/<runId>/issues.json (pretty, stable ordering: severity → ruleId → url).
 *  Write-temp-then-rename: a reader (or a killed background analyzer process) never observes a
 *  half-written file — rename() swaps the directory entry atomically on both POSIX and NTFS, so
 *  the file is always either the complete old version or the complete new one. Fixes a real
 *  incident (books-full-site/issues.json observed truncated at exactly 8 MiB) caused by the old
 *  in-place writeFile leaving a partial file behind when the writer was killed mid-write. */
export async function writeIssues(runDir: string, report: AnalysisReport): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const file = path.join(runDir, "issues.json");
  const tmp = path.join(runDir, `.issues.json.tmp-${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(tmp, JSON.stringify(stableSort(report), null, 2), "utf8");
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** null when the run has never been analyzed. Streams the file through a SAX-style tokenizer
 *  (stream-json) instead of readFile+JSON.parse, so a large issues.json — books-full-site's is
 *  12.4MB at 1,195 pages and scales with both page count and issue density toward the 100k-page
 *  target — is parsed in chunks rather than held as one giant string alongside the object being
 *  built from it, and without blocking the event loop on a single huge synchronous JSON.parse.
 *  Same AnalysisReport shape/signature as before — full-report callers (diff, fixplan, the
 *  acceptance gate) are unaffected. */
export async function readIssues(runDir: string): Promise<AnalysisReport | null> {
  const file = path.join(runDir, "issues.json");
  return new Promise<AnalysisReport | null>((resolve, reject) => {
    const source = createReadStream(file);
    source.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") resolve(null);
      else reject(err);
    });
    const pipeline = source.pipe(parser());
    pipeline.on("error", reject);
    const asm = Assembler.connectTo(pipeline);
    asm.on("done", (a: { current: unknown }) => resolve(a.current as AnalysisReport));
  });
}

/** True cursor: yields one Issue at a time from issues.json's "issues" array without ever
 *  materializing the full array — for a caller that only needs to walk/reduce issues, not hold
 *  all of them (e.g. a future large-run export or CLI summary). readIssues stays the full-report
 *  convenience API for the existing diff/fixplan/gate callers, which genuinely need the whole
 *  report at once for cross-run comparison. Yields nothing (does not throw) when the run has
 *  never been analyzed, matching readIssues' "null" treatment of a missing file. */
export async function* streamIssues(runDir: string): AsyncGenerator<Issue> {
  const file = path.join(runDir, "issues.json");
  const pipeline = Chain.chain([createReadStream(file), parser(), pick.pick({ filter: "issues" }), streamArray.streamArray()]);
  try {
    for await (const { value } of pipeline as AsyncIterable<{ value: Issue }>) {
      yield value;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

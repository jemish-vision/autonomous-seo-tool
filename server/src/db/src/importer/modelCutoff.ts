import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Auto-detects "when the current scoring model started" as the latest mtime under the crawler's
 * src/analysis/ tree, unless SCORING_MODEL_CUTOFF_ISO overrides it. This is a real, self-updating
 * signal rather than a guess: the scoring FORMULA lives in that tree, so any issues.json generated
 * before the newest edit there was produced by code that no longer exists. Empirically, on this
 * repo right now, every run's issues.json predates the engine's last edit (six other agents are
 * actively changing src/analysis/ in parallel) — which is exactly the "same runs scored 89-97 old
 * model / 20-41 new model" problem the brief describes, caught mechanically instead of by date.
 */
export async function detectScoringModelCutoff(analysisDir: string): Promise<Date> {
  if (process.env.SCORING_MODEL_CUTOFF_ISO) {
    return new Date(process.env.SCORING_MODEL_CUTOFF_ISO);
  }
  let latest = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".ts")) {
        const s = await stat(full);
        if (s.mtimeMs > latest) latest = s.mtimeMs;
      }
    }
  }
  await walk(analysisDir);
  return latest > 0 ? new Date(latest) : new Date();
}

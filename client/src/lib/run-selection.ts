/** Client-safe (no node:fs). The default-run rule lives here alone so lib/data.ts (server render)
 *  and the topbar RunSelector (client) can never disagree about which run is showing. */

/** A 1-page crawl is a smoke test or a degenerate run: no depth spread, no timeline, a single
 *  sample masquerading as an average. Opening on one reads as a broken dashboard. */
const SUBSTANTIAL_MIN_PAGES = 2;

export interface RunChoice {
  runId: string;
  successful: number;
}

/** Expects `runs` newest-first (listRuns sorts by startedAt desc); falls back to the newest run
 *  when nothing qualifies, so a fresh install with only a 1-page crawl still shows it. */
export function pickDefaultRun<T extends RunChoice>(runs: T[]): T | undefined {
  return runs.find((r) => r.successful >= SUBSTANTIAL_MIN_PAGES) ?? runs[0];
}

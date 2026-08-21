/** Slice S5 implements. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CrawledPage,
  CrawlSummary,
  ExternalCheckResult,
  FailureRecord,
  RobotsEvidence,
  SitemapResult,
  SkippedUrlRecord,
} from "../models/types";

/**
 * Per-run evidence store: storage/runs/<runId>/{raw,pages}/ + failures.json + robots.json
 * + sitemaps.json + report.json. pageId = first 12 hex chars of sha256(normalizedUrl).
 */
export class RunStore {
  private readonly _runDir: string;
  /** Serializes failures.json read-modify-write so concurrent Crawlee handlers can't interleave. */
  private failureChain: Promise<void> = Promise.resolve();

  constructor(outDir: string, runId: string) {
    this._runDir = path.resolve(outDir, "runs", runId);
  }

  get runDir(): string {
    return this._runDir;
  }

  static pageIdFor(normalizedUrl: string): string {
    return createHash("sha256").update(normalizedUrl).digest("hex").slice(0, 12);
  }

  async init(): Promise<void> {
    await mkdir(path.join(this._runDir, "raw"), { recursive: true });
    await mkdir(path.join(this._runDir, "pages"), { recursive: true });
  }

  async saveRaw(normalizedUrl: string, html: string): Promise<void> {
    const dir = path.join(this._runDir, "raw");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${RunStore.pageIdFor(normalizedUrl)}.html`), html, "utf8");
  }

  async savePage(page: CrawledPage): Promise<void> {
    const dir = path.join(this._runDir, "pages");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${RunStore.pageIdFor(page.normalizedUrl)}.json`);
    await writeFile(file, JSON.stringify(page, null, 2), "utf8");
  }

  /** A2: static HTML kept alongside the rendered raw/<pageId>.html when a page is escalated to
   * Playwright, so raw-vs-rendered divergence has real evidence to diff against. */
  async saveStaticRaw(normalizedUrl: string, html: string): Promise<void> {
    const dir = path.join(this._runDir, "raw");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${RunStore.pageIdFor(normalizedUrl)}.static.html`), html, "utf8");
  }

  /** --screenshots: thumb + full-page WebP, named by pageId like raw/<pageId>.html. Returns
   * paths relative to the run dir (forward-slashed, for direct use as URL/JSON evidence). */
  async saveScreenshots(normalizedUrl: string, thumb: Buffer, full: Buffer): Promise<{ thumb: string; full: string }> {
    const dir = path.join(this._runDir, "screenshots");
    await mkdir(dir, { recursive: true });
    const id = RunStore.pageIdFor(normalizedUrl);
    const thumbRel = path.join("screenshots", `${id}.thumb.webp`);
    const fullRel = path.join("screenshots", `${id}.full.webp`);
    await writeFile(path.join(this._runDir, thumbRel), thumb);
    await writeFile(path.join(this._runDir, fullRel), full);
    return { thumb: thumbRel.split(path.sep).join("/"), full: fullRel.split(path.sep).join("/") };
  }

  /** Read-modify-write, chained per instance so parallel handler calls never race the file. */
  saveFailure(failure: FailureRecord): Promise<void> {
    const run = async (): Promise<void> => {
      const file = path.join(this._runDir, "failures.json");
      let list: FailureRecord[] = [];
      try {
        list = JSON.parse(await readFile(file, "utf8")) as FailureRecord[];
      } catch {
        list = [];
      }
      list.push(failure);
      await mkdir(this._runDir, { recursive: true });
      await writeFile(file, JSON.stringify(list, null, 2), "utf8");
    };
    this.failureChain = this.failureChain.then(run, run);
    return this.failureChain;
  }

  /** Robots-blocked URLs (never fetched) — blocked.json. NOT failures. */
  async saveBlocked(normalizedUrls: string[]): Promise<void> {
    await mkdir(this._runDir, { recursive: true });
    await writeFile(
      path.join(this._runDir, "blocked.json"),
      JSON.stringify(normalizedUrls, null, 2),
      "utf8",
    );
  }

  async saveRobots(evidence: RobotsEvidence): Promise<void> {
    await mkdir(this._runDir, { recursive: true });
    await writeFile(
      path.join(this._runDir, "robots.json"),
      JSON.stringify(evidence, null, 2),
      "utf8",
    );
  }

  async saveSitemaps(result: SitemapResult): Promise<void> {
    await mkdir(this._runDir, { recursive: true });
    await writeFile(
      path.join(this._runDir, "sitemaps.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
  }

  async saveReport(summary: CrawlSummary): Promise<void> {
    await mkdir(this._runDir, { recursive: true });
    await writeFile(
      path.join(this._runDir, "report.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );
  }

  /** B2: URLs deliberately not fetched by the safety guard rails — skipped.json. */
  async saveSkipped(records: SkippedUrlRecord[]): Promise<void> {
    await mkdir(this._runDir, { recursive: true });
    await writeFile(
      path.join(this._runDir, "skipped.json"),
      JSON.stringify(records, null, 2),
      "utf8",
    );
  }

  /** A2: `--check-external` HEAD-check results — external-links.json. */
  async saveExternalChecks(results: ExternalCheckResult[]): Promise<void> {
    await mkdir(this._runDir, { recursive: true });
    await writeFile(
      path.join(this._runDir, "external-links.json"),
      JSON.stringify(results, null, 2),
      "utf8",
    );
  }

  /** Read every stored page record back (report building + bench evidence checks). */
  async loadAllPages(): Promise<CrawledPage[]> {
    const dir = path.join(this._runDir, "pages");
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    return Promise.all(
      jsonFiles.map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as CrawledPage),
    );
  }
}

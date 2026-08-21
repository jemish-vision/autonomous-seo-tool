/** Minimal, local page-record reader — deliberately NOT imported from engine.ts (readPages there
 * isn't exported, and engine.ts is a shared foundation file other slices are actively editing).
 * pageId is the filename stem, same convention as engine.ts/RunStore. */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CrawledPage } from "../../models/types";

export async function readPagesById(runDir: string): Promise<Map<string, CrawledPage>> {
  const pagesDir = path.join(runDir, "pages");
  let files: string[];
  try {
    files = await readdir(pagesDir);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return new Map();
    throw err;
  }
  const byId = new Map<string, CrawledPage>();
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const page = JSON.parse(await readFile(path.join(pagesDir, file), "utf-8")) as CrawledPage;
    byId.set(file.slice(0, -".json".length), page);
  }
  return byId;
}

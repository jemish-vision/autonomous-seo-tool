/**
 * Mute / accepted-risk, keyed per SITE not per run — survives re-crawls, exactly like Prisma's
 * RuleMute model (unique on [siteId, ruleSlug]). This POC has no site table, so the site key is
 * the crawl's own start-URL host (the same identity signal that already separates
 * books.toscrape.com / example.com / quotes.toscrape.com runs from each other in storage/runs,
 * while re-crawls of the same localhost fixture correctly share one mute file).
 *
 * A mute never deletes a finding: engine.ts still runs the rule, still computes its priority —
 * this store only marks it, so the finding's status flips to "muted" and its damage drops out of
 * the health score, while the finding itself keeps appearing (as "Accepted").
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MuteRecord } from "./types";

export function siteKeyFromStartUrl(startUrl: string | null | undefined): string | null {
  if (!startUrl) return null;
  try {
    return new URL(startUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

function sanitize(key: string): string {
  return key.replace(/[^a-z0-9.-]/gi, "_");
}

function muteFile(storageRoot: string, siteKey: string): string {
  return path.join(storageRoot, "mutes", `${sanitize(siteKey)}.json`);
}

async function readRecords(file: string): Promise<MuteRecord[]> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as MuteRecord[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Active mutes only — an expired mute is treated as not-muted rather than pruned, so the
 * history stays on disk for audit. */
export async function loadSiteMutes(storageRoot: string, siteKey: string | null): Promise<Map<string, MuteRecord>> {
  if (!siteKey) return new Map();
  const records = await readRecords(muteFile(storageRoot, siteKey));
  const now = Date.now();
  const map = new Map<string, MuteRecord>();
  for (const r of records) {
    if (r.expiresAt && new Date(r.expiresAt).getTime() < now) continue;
    map.set(r.ruleId, r);
  }
  return map;
}

export async function muteRule(
  storageRoot: string,
  siteKey: string,
  ruleId: string,
  opts?: { note?: string; mutedBy?: string; expiresAt?: string },
): Promise<void> {
  const file = muteFile(storageRoot, siteKey);
  await mkdir(path.dirname(file), { recursive: true });
  const next = (await readRecords(file)).filter((r) => r.ruleId !== ruleId);
  next.push({
    ruleId,
    note: opts?.note ?? null,
    mutedBy: opts?.mutedBy ?? null,
    mutedAt: new Date().toISOString(),
    expiresAt: opts?.expiresAt ?? null,
  });
  next.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  await writeFile(file, JSON.stringify(next, null, 2), "utf8");
}

export async function unmuteRule(storageRoot: string, siteKey: string, ruleId: string): Promise<void> {
  const file = muteFile(storageRoot, siteKey);
  const records = await readRecords(file);
  const next = records.filter((r) => r.ruleId !== ruleId);
  if (next.length === records.length) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2), "utf8");
}

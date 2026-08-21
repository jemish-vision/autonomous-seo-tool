/**
 * Run-evidence store for WordPress connector activity.
 *
 * Lives under storage/runs/<runId>/wordpress/:
 *   connection.json  — last successful connection check (state, overwritten)
 *   receipts.jsonl   — append-only audit log, one JSON object per line, every
 *                      write attempt (success AND failure) with the connector's
 *                      before/after receipt. Append-only on purpose: receipts
 *                      are history and are never rewritten (same convention as
 *                      WORK_LOG.md).
 *
 * A killed process can leave a partial trailing line in receipts.jsonl; that
 * tail is tolerated on read (recorded as truncated), while a corrupt
 * non-final line throws — evidence damage is surfaced, never silently dropped.
 */
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { ConnectorStatus, ChangeReceipt, ResourceRef } from "./types";

export interface ConnectionRecord {
  siteUrl: string;
  checkedAt: string;
  status: ConnectorStatus;
}

export interface StoredReceipt {
  runId: string;
  siteUrl: string;
  /** When the platform recorded this entry (local clock). */
  recordedAt: string;
  success: boolean;
  operation: "update_seo" | "update_media";
  resource: ResourceRef;
  provider?: string;
  /** Exactly what the platform asked the connector to write. */
  requestedChanges: Record<string, unknown>;
  /** The connector's before/after receipt (empty on failures that never wrote). */
  changes: ChangeReceipt;
  /** The connector's own receipt timestamp, when one came back. */
  connectorTimestamp?: string;
  error?: { code: string; message: string; status: number };
}

export class WordPressEvidenceStore {
  private readonly runDir: string;

  constructor(runDir: string) {
    this.runDir = runDir;
  }

  get dir(): string {
    return path.join(this.runDir, "wordpress");
  }

  /** Write connection.json (temp-then-rename, so a reader never sees a half-written file). */
  async recordConnection(siteUrl: string, status: ConnectorStatus): Promise<string> {
    const dir = this.dir;
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "connection.json");
    const tmp = path.join(dir, `.connection.json.tmp-${randomBytes(6).toString("hex")}`);
    const record: ConnectionRecord = { siteUrl, checkedAt: new Date().toISOString(), status };
    try {
      await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
      await rename(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return file;
  }

  /** Append one line to receipts.jsonl. Returns the file path. */
  async recordReceipt(entry: StoredReceipt): Promise<string> {
    const dir = this.dir;
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "receipts.jsonl");
    await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
    return file;
  }

  /** Read every stored receipt, oldest first. */
  async loadReceipts(): Promise<StoredReceipt[]> {
    const file = path.join(this.dir, "receipts.jsonl");
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    const receipts: StoredReceipt[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        receipts.push(JSON.parse(lines[i]!) as StoredReceipt);
      } catch {
        if (i === lines.length - 1) {
          // Truncated tail from a killed writer — the historical prefix is intact.
          break;
        }
        throw new Error(`corrupt line ${i + 1} in ${file} — evidence integrity issue, refusing to read past it`);
      }
    }
    return receipts;
  }

  /** Last successful connection check, or null when none recorded. */
  async loadConnection(): Promise<ConnectionRecord | null> {
    const file = path.join(this.dir, "connection.json");
    try {
      return JSON.parse(await readFile(file, "utf8")) as ConnectionRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}
/** Slice: crawl queue + concurrency + activity stream. */
import { EventEmitter } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import type { CrawlActivityEvent, CrawlActivityEventInput } from "./types";

/**
 * Durable, append-only per-run activity log — storage/runs/<runId>/events.ndjson, the same
 * directory shape RunStore already uses for that run's other evidence. Two ways to consume it,
 * covering both requirements: `subscribe` is a live, in-process tail (a listener fires the
 * instant an event is queued — before the write even lands on disk), and `replay` streams the
 * file back line-by-line after the fact. Neither holds the whole log in memory: writes are one
 * NDJSON line appended at a time, and replay never reads more than the current line.
 */
export class EventLog {
  private readonly runDir: string;
  private readonly file: string;
  private readonly runId: string;
  private readonly emitter = new EventEmitter();
  /** Serializes appends the same way RunStore.saveFailure serializes its read-modify-write —
   * concurrent Crawlee handlers must never interleave two lines into one write. */
  private chain: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(outDir: string, runId: string) {
    this.runId = runId;
    this.runDir = path.resolve(outDir, "runs", runId);
    this.file = path.join(this.runDir, "events.ndjson");
  }

  get filePath(): string {
    return this.file;
  }

  async init(): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
  }

  /** Live tail. Returns an unsubscribe function. */
  subscribe(listener: (event: CrawlActivityEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  emit(input: CrawlActivityEventInput): CrawlActivityEvent {
    const event: CrawlActivityEvent = {
      ...input,
      seq: ++this.seq,
      runId: this.runId,
      at: new Date().toISOString(),
    };
    const line = `${JSON.stringify(event)}\n`;
    const write = (): Promise<void> => appendFile(this.file, line, "utf8");
    // Chained via both handlers (not just onFulfilled) so one failed append never wedges every
    // event after it — same reasoning as RunStore.saveFailure's read-modify-write chain.
    this.chain = this.chain.then(write, write);
    this.emitter.emit("event", event);
    return event;
  }

  /** Waits for every queued append to land on disk — call before treating the run as replayable. */
  async flush(): Promise<void> {
    await this.chain;
  }

  /** Streams events.ndjson off disk, oldest first, one line at a time. */
  static async *replay(outDir: string, runId: string): AsyncGenerator<CrawlActivityEvent> {
    const file = path.join(path.resolve(outDir, "runs", runId), "events.ndjson");
    if (!existsSync(file)) return;
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as CrawlActivityEvent;
      } catch {
        // a torn last line (process killed mid-write) is skipped, not fatal to the replay
      }
    }
  }
}

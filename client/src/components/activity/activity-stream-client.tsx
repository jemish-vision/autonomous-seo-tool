import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Loader2, RadioTower, RefreshCw, WifiOff } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { EventRow, type ActivityEvent } from "./event-row";
import { ActivityFilters, type StatusFilter } from "./activity-filters";
import { statusBucket, ALL_KNOWN_KINDS } from "@/lib/events-view";
import { getAccessToken, API_BASE } from "@/lib/api";
import { cn } from "@/lib/cn";

type ConnState = "connecting" | "open" | "reconnecting" | "complete" | "error" | "unavailable";

const ROW_HEIGHT = 30;
const OVERSCAN = 25;
const MAX_BUFFERED_EVENTS = 20000;
const NEAR_BOTTOM_PX = ROW_HEIGHT * 2;
const MAX_BACKOFF_MS = 10000;

const TERMINAL_TYPES = new Set(["crawl-finished", "crawl-cancelled", "done"]);

interface Props {
  runId: string;
  initialEvents: ActivityEvent[];
  initialSource: "durable" | "synthetic";
  urlToPageId: [string, string][];
  className?: string;
  /** Hide the search + status + kind filter bar (e.g. the New Crawl inline log) while still
   *  showing every event row — the full stream, just no filters. The Activity Log page leaves
   *  this off so its filter bar stays. */
  hideFilters?: boolean;
}

function appendCapped(prev: ActivityEvent[], next: ActivityEvent): ActivityEvent[] {
  if (prev.length > 0 && prev[prev.length - 1].seq === next.seq) return prev; // dedupe exact repeat seq
  const out = prev.length >= MAX_BUFFERED_EVENTS ? prev.slice(prev.length - MAX_BUFFERED_EVENTS + 1) : prev;
  return [...out, next];
}

/** True when the SSR-fetched initial batch already carries a terminal event. Matters because the
 *  shared events route only flags "finished" by OBSERVING a terminal row on THIS read — a client
 *  resuming with `fromSeq` already past that row (exactly what happens here, since the server
 *  component already consumed it) never sees it again and the durable-log tail polls forever with
 *  connState stuck on "Connecting…" even though the run plainly finished (verified live against
 *  storage/runs/extraction-verify). Skipping the connection entirely for this case is a client-side
 *  fix within this slice's own files — app/api/**' isn't owned here. */
function alreadyTerminal(events: ActivityEvent[]): boolean {
  return events.some((e) => TERMINAL_TYPES.has(e.type));
}

export function ActivityStreamClient({ runId, initialEvents, initialSource, urlToPageId, className, hideFilters = false }: Props) {
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents);
  const [source, setSource] = useState<"durable" | "synthetic">(initialSource);
  const [connState, setConnState] = useState<ConnState>(alreadyTerminal(initialEvents) ? "complete" : "connecting");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [status, setStatus] = useState<StatusFilter>(null);
  const [activeKinds, setActiveKinds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [manualConnectTick, setManualConnectTick] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef(initialEvents.reduce((m, e) => Math.max(m, e.seq), 0));
  /** Seq is the row's React key, so it must be unique in the list. Two overlapping streams (a
   *  StrictMode double-connect, a tunnel-drop reconnect, or the synthetic→durable switch where
   *  both sequences are 1-based) can deliver the same seq twice — `appendCapped`'s adjacent-only
   *  dedupe misses that and React warns about duplicate keys. Track every seq we've accepted and
   *  skip repeats (they're the same event re-sent, so dropping them loses nothing). */
  const seenSeqRef = useRef<Set<number>>(new Set(initialEvents.map((e) => e.seq)));
  /** Whether the LAST accepted event was synthetic. The durable log and the synthetic fallback
   *  have independent 1-based sequences, so when a durable event first arrives after synthetic
   *  ones we must forget the synthetic seqs — otherwise the durable log's 1..N would be wrongly
   *  skipped as "duplicates" (see the events route's own mid-stream transition note). */
  const lastEventSyntheticRef = useRef<boolean | null>(initialSource !== "durable" ? null : false);
  const esRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const attemptRef = useRef(0);
  const completedRef = useRef(alreadyTerminal(initialEvents));
  /** Holds the latest `connect` so the retry timeout can call it without a direct
   *  self-reference inside its own `useCallback` body (flagged as a TDZ hazard by the
   *  react-hooks lint rules even though it's runtime-safe — the timeout only fires later). */
  const connectRef = useRef<() => void>(() => {});

  const urlMap = useMemo(() => new Map(urlToPageId), [urlToPageId]);

  // --- SSE connect + capped-backoff reconnect. Native EventSource auto-retry is deliberately not
  // relied on: it would keep re-opening forever even after a legitimate terminal event, and gives
  // no visible attempt count. We close it ourselves on a terminal event or unmount instead. ---
  const connect = useCallback(() => {
    if (cancelledRef.current) return;
    esRef.current?.close();
    setConnState((prev) => (prev === "open" ? "reconnecting" : "connecting"));

    void (async () => {
      if (cancelledRef.current) return;
      // EventSource can't set an Authorization header, so pass the Supabase token as a query param —
      // the /events route is mounted public and verifies ?access_token=. API_BASE keeps it on the
      // same origin the rest of the app talks to.
      const token = await getAccessToken();
      const params = new URLSearchParams({ fromSeq: String(lastSeqRef.current) });
      if (token) params.set("access_token", token);
      const es = new EventSource(`${API_BASE}/api/crawls/${encodeURIComponent(runId)}/events?${params.toString()}`);
      esRef.current = es;

    const handle = (e: MessageEvent) => {
      let evt: ActivityEvent;
      try {
        evt = JSON.parse(e.data) as ActivityEvent;
      } catch {
        return;
      }
      // Durable log appeared mid-stream after synthetic rows — independent 1-based sequences,
      // so accept its seqs as brand-new (clear the set on the FIRST durable event).
      if (evt.synthetic === false && lastEventSyntheticRef.current === true) {
        seenSeqRef.current = new Set();
      }
      if (typeof evt.seq === "number") {
        if (seenSeqRef.current.has(evt.seq)) return; // same event re-delivered (replay/reconnect)
        seenSeqRef.current.add(evt.seq);
        lastSeqRef.current = Math.max(lastSeqRef.current, evt.seq);
      }
      lastEventSyntheticRef.current = evt.synthetic;
      if (evt.synthetic === false) setSource("durable");
      setEvents((prev) => appendCapped(prev, evt));
      if (TERMINAL_TYPES.has(evt.type)) {
        completedRef.current = true;
        setConnState("complete");
        es.close(); // deliberate client-side close — a self-initiated close does not fire onerror,
        // so the reconnect path below never runs for a legitimate finish/replay-complete.
      }
    };
    for (const kind of ALL_KNOWN_KINDS) es.addEventListener(kind, handle);

    es.onopen = () => {
      setConnState("open");
      attemptRef.current = 0;
      setReconnectAttempt(0);
    };
    es.onerror = () => {
      if (cancelledRef.current || completedRef.current) return;
      // A live event stream is produced by the crawler worker (`seo-crawler-poc`), which isn't in
      // this deployment. The events route answers 501 (not an event-stream), so the browser fails
      // the connection permanently: readyState is CLOSED, never CONNECTING. That's our signal the
      // capability is missing — stop the infinite reconnect loop and show it honestly, rather than
      // spinning on "Reconnecting…" forever against a dead endpoint. A genuine mid-stream network
      // drop leaves readyState CONNECTING, so that case still falls through to the backoff retry.
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        completedRef.current = true; // suppress any further onerror re-entry
        setConnState("unavailable");
        return;
      }
      es.close();
      attemptRef.current += 1;
      setReconnectAttempt(attemptRef.current);
      setConnState("reconnecting");
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(attemptRef.current, 5));
      retryTimerRef.current = setTimeout(() => {
        if (!cancelledRef.current) connectRef.current();
      }, delay);
    };
    })();
  }, [runId]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (completedRef.current) return; // already-finished replay — see alreadyTerminal() above
    cancelledRef.current = false;
    connect();
    return () => {
      cancelledRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      esRef.current?.close();
    };
    // manualConnectTick intentionally re-triggers this effect for the "Reconnect" button.
  }, [connect, manualConnectTick]);

  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [events]);

  const statusCounts = useMemo(() => {
    const c = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
    for (const e of events) {
      const b = statusBucket(e.statusCode);
      if (b !== "none") c[b]++;
    }
    return c;
  }, [events]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (activeKinds.size > 0 && !activeKinds.has(e.type)) return false;
      if (status && statusBucket(e.statusCode) !== status) return false;
      if (q && !(e.url ?? "").toLowerCase().includes(q) && !e.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, activeKinds, status, search]);

  // --- Virtualization ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const currentH = el.clientHeight || 500;
    setViewportHeight(currentH);
    const ro = new ResizeObserver((entries) => {
      if (entries[0]) {
        const h = entries[0].contentRect.height || el.clientHeight;
        if (h > 0) setViewportHeight(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [events.length, filtered.length]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const currentHeight = el.clientHeight;
    if (currentHeight && currentHeight !== viewportHeight) {
      setViewportHeight(currentHeight);
    }
    setScrollTop(el.scrollTop);
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom < NEAR_BOTTOM_PX);
  }, [viewportHeight]);

  const prevFilteredLen = useRef(filtered.length);
  useEffect(() => {
    const grew = filtered.length > prevFilteredLen.current;
    prevFilteredLen.current = filtered.length;
    if (grew && autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const total = filtered.length;
  const effectiveHeight = viewportHeight > 0 ? viewportHeight : 500;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(effectiveHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(total, startIndex + visibleCount);
  const visibleItems = filtered.slice(startIndex, endIndex);

  function toggleKind(kind: string) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function scrollToBottom() {
    setAutoScroll(true);
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }

  return (
    <div className={cn("flex h-[calc(100dvh-320px)] min-h-[360px] flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ConnectionPill state={connState} attempt={reconnectAttempt} onReconnect={() => setManualConnectTick((n) => n + 1)} />
        {source === "synthetic" && (
          <span className="rounded-pill border border-border-strong bg-subtle px-2 py-0.5 text-[11px] font-medium text-faint">
            Durable per-request log not available yet — showing a lower-fidelity synthetic tail (crawl.log + progress).
          </span>
        )}
      </div>

      {!hideFilters && (
        <ActivityFilters
          kindCounts={kindCounts}
          activeKinds={activeKinds}
          onToggleKind={toggleKind}
          onClearKinds={() => setActiveKinds(new Set())}
          status={status}
          statusCounts={statusCounts}
          onStatus={setStatus}
          search={search}
          onSearch={setSearch}
          total={events.length}
          visible={filtered.length}
        />
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-card">
        {events.length === 0 && connState === "unavailable" ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={WifiOff}
              title="Live activity isn’t available in this build"
              description="The live event stream is produced by the crawler worker, which isn’t part of this deployment."
            />
          </div>
        ) : events.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={connState === "connecting" ? Loader2 : RadioTower}
              title={connState === "connecting" ? "Connecting to the activity stream…" : "Waiting for the first event"}
              description="Events appear here the instant the crawler emits them."
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={RadioTower} title="No events match these filters" />
          </div>
        ) : (
          <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto">
            <div style={{ height: total * ROW_HEIGHT, position: "relative" }}>
              <div style={{ position: "absolute", top: startIndex * ROW_HEIGHT, left: 0, right: 0 }}>
                {/* Synthetic and durable streams have independent 1-based seqs, so a bare seq key
                    collides when the durable log takes over mid-stream (two events with key 1/2). */}
                {visibleItems.map((evt) => (
                  <EventRow key={`${evt.synthetic ? "synthetic" : "durable"}:${evt.seq}`} event={evt} runId={runId} pageId={evt.url ? urlMap.get(evt.url) ?? null : null} style={{ height: ROW_HEIGHT }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {!autoScroll && filtered.length > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-pill border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-contrast shadow-popover outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <ArrowDown size={12} strokeWidth={2.5} aria-hidden="true" />
            Paused — jump to latest
          </button>
        )}
      </div>
    </div>
  );
}

function ConnectionPill({ state, attempt, onReconnect }: { state: ConnState; attempt: number; onReconnect: () => void }) {
  const base = "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium";
  if (state === "open") return <span className={cn(base, "bg-ok-bg text-ok")}><RadioTower size={12} strokeWidth={2} aria-hidden="true" /> Live</span>;
  if (state === "complete") return <span className={cn(base, "bg-subtle text-secondary")}><RadioTower size={12} strokeWidth={2} aria-hidden="true" /> Replay complete</span>;
  if (state === "connecting") return <span className={cn(base, "bg-subtle text-secondary")}><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Connecting…</span>;
  if (state === "unavailable") return <span className={cn(base, "bg-subtle text-faint")}><WifiOff size={12} strokeWidth={2} aria-hidden="true" /> Live activity unavailable</span>;
  if (state === "reconnecting")
    return (
      <button type="button" onClick={onReconnect} className={cn(base, "border border-warn bg-warn-bg text-warn outline-none focus-visible:ring-2 focus-visible:ring-primary")}>
        <RefreshCw size={12} strokeWidth={2} aria-hidden="true" /> Reconnecting (attempt {attempt})
      </button>
    );
  return (
    <button type="button" onClick={onReconnect} className={cn(base, "border border-danger bg-danger-bg text-danger outline-none focus-visible:ring-2 focus-visible:ring-primary")}>
      <WifiOff size={12} strokeWidth={2} aria-hidden="true" /> Disconnected — reconnect
    </button>
  );
}

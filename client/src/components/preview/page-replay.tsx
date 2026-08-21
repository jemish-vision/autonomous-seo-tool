import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, ExternalLink, FileWarning, RefreshCw, Play, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyButton } from "@/components/ui/copy-button";
import { SettingSwitch } from "@/components/new-crawl/SettingSwitch";
import { ArtifactStorageNotice } from "@/components/artifacts/artifact-storage-notice";
import { statusTone } from "@/lib/explorer-shared";
import { cn } from "@/lib/cn";
import { apiGet, ApiError } from "@/lib/api";
import { isFrameableScheme } from "./frameability";

export type ReplayVariant = "rendered" | "static";

export interface PageReplayProps {
  runId: string;
  pageId: string;
  pageUrl: string;
  statusCode: number | null;
  fetchedAt: string;
  hasStaticHtml: boolean;
  /** From the page's OWN stored response headers — x-frame-options / CSP frame-ancestors. */
  canFrameLive: boolean;
  frameBlockedBy: string | null;
  hasScreenshot: boolean;
  /** MVP acceptance criterion #11 — undefined while the server-side check hasn't run (never true
   *  blank-render: the notice only shows once we know for sure it's false). */
  artifactStorageConfigured?: boolean;
  artifactStorageReason?: string;
  className?: string;
}

/** The NEW server hands back a short-lived SIGNED URL for the captured HTML / screenshot object in
 *  Supabase Storage (see server/src/modules/blobs/blobs.routes.ts) instead of streaming bytes. */
interface SignedUrlResponse {
  url: string;
}

// Cross-origin src to a Supabase object with an empty sandbox: the captured markup renders but no
// scripts run and forms are inert — a faithful, safe replay of what the crawler stored.
const SANDBOX = "";

export function PageReplay({
  runId,
  pageId,
  pageUrl,
  statusCode,
  fetchedAt,
  hasStaticHtml,
  canFrameLive,
  frameBlockedBy,
  hasScreenshot,
  artifactStorageConfigured,
  artifactStorageReason,
  className,
}: PageReplayProps) {
  const [variant, setVariant] = useState<ReplayVariant>("rendered");
  const [styled, setStyled] = useState(true);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const liveOk = canFrameLive && isFrameableScheme(pageUrl);
  const [mode, setMode] = useState<"live" | "shot" | "replay">(liveOk ? "live" : hasScreenshot ? "shot" : "replay");
  const [state, setState] = useState<"loading" | "loaded" | "error" | "not-found">("loading");
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Screenshot has its own signed-URL lifecycle (fetched only when the Screenshot tab is active).
  const [shotState, setShotState] = useState<"loading" | "loaded" | "error" | "not-found">("loading");
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const shotSeq = useRef(0);

  const [capturedLabel, setCapturedLabel] = useState(() => new Date(fetchedAt).toISOString().replace("T", " ").slice(0, 19) + " UTC");
  useEffect(() => {
    setCapturedLabel(new Date(fetchedAt).toLocaleString());
  }, [fetchedAt]);

  function load() {
    const seq = ++requestSeq.current;
    setState("loading");
    setReplayUrl(null);
    setErrorMessage(null);

    // Authed GET (apiGet attaches the Supabase Bearer token). The endpoint returns a signed URL to
    // the captured HTML object, which we then render as the iframe's src.
    apiGet<SignedUrlResponse>(`/api/crawls/${encodeURIComponent(runId)}/pages/${encodeURIComponent(pageId)}/replay`)
      .then((data) => {
        if (seq !== requestSeq.current) return;
        if (!data?.url) {
          setState("not-found");
          return;
        }
        setReplayUrl(data.url);
        setState("loaded");
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        // 404 = blob not synced / storage off — a graceful empty state, not an error.
        if (err instanceof ApiError && err.status === 404) {
          setState("not-found");
          return;
        }
        setErrorMessage(err instanceof Error ? err.message : "Network error");
        setState("error");
      });
  }

  useEffect(() => {
    if (mode === "replay") load();
    // variant/styled retained as UX toggles; the server serves the one captured object regardless,
    // so re-running load on their change is a harmless refetch that keeps the tabs responsive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, pageId, variant, styled, mode]);

  // Screenshot signed URL — fetched lazily when the Screenshot tab is opened.
  useEffect(() => {
    if (mode !== "shot") return;
    const seq = ++shotSeq.current;
    setShotState("loading");
    setShotUrl(null);
    setShotError(null);

    apiGet<SignedUrlResponse>(`/api/crawls/${encodeURIComponent(runId)}/pages/${encodeURIComponent(pageId)}/screenshot?size=full`)
      .then((data) => {
        if (seq !== shotSeq.current) return;
        if (!data?.url) {
          setShotState("not-found");
          return;
        }
        setShotUrl(data.url);
        setShotState("loaded");
      })
      .catch((err) => {
        if (seq !== shotSeq.current) return;
        if (err instanceof ApiError && err.status === 404) {
          setShotState("not-found");
          return;
        }
        setShotError(err instanceof Error ? err.message : "Network error");
        setShotState("error");
      });
  }, [runId, pageId, mode]);

  return (
    <div className={cn("space-y-3", className)}>
      {artifactStorageConfigured === false && <ArtifactStorageNotice reason={artifactStorageReason} />}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-subtle px-4 py-3 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={statusTone(statusCode)}>{statusCode ?? "—"}</Badge>
          <span className="max-w-[420px] truncate text-secondary font-mono" title={pageUrl}>
            {pageUrl}
          </span>
          <CopyButton text={pageUrl} label="Copy page URL" />
          {isFrameableScheme(pageUrl) && (
            <a
              href={pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-primary underline underline-offset-2"
            >
              <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
              open live URL
            </a>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-faint">
          <Clock size={12} strokeWidth={1.75} aria-hidden="true" />
          Captured {capturedLabel} · this is a snapshot, not the live page
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Preview mode" className="inline-flex rounded-control border border-border bg-subtle p-0.5 text-xs">
          {([
            ["live", "Live page", liveOk],
            ["shot", "Screenshot", hasScreenshot],
            ["replay", "Captured HTML", true],
          ] as const).map(([key, label, enabled]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              disabled={!enabled}
              title={
                enabled
                  ? undefined
                  : key === "live"
                    ? (frameBlockedBy ?? "This site blocks embedding")
                    : 'No screenshot stored for this run — turn on "Capture screenshots" in New crawl and run it again'
              }
              onClick={() => setMode(key)}
              className={cn(
                "rounded-[6px] px-2.5 py-1.5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                mode === key ? "bg-card text-foreground shadow-card" : "text-secondary hover:text-foreground",
                !enabled && "cursor-not-allowed opacity-40 hover:text-secondary",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "replay" && hasStaticHtml && (
          <div role="tablist" aria-label="Replay variant" className="inline-flex rounded-control border border-border bg-subtle p-0.5 text-xs">
            {([["rendered", "Rendered (post-JS)"], ["static", "Static (pre-JS)"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={variant === key}
                onClick={() => setVariant(key)}
                className={cn(
                  "rounded-[6px] px-2.5 py-1.5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                  variant === key ? "bg-card text-foreground shadow-card" : "text-secondary hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "replay" && (
          <div role="tablist" aria-label="Asset loading" className="inline-flex rounded-control border border-border bg-subtle p-0.5 text-xs">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                role="tab"
                aria-selected={styled === on}
                onClick={() => setStyled(on)}
                className={cn(
                  "rounded-[6px] px-2.5 py-1.5 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                  styled === on ? "bg-card text-foreground shadow-card" : "text-secondary hover:text-foreground",
                )}
              >
                {on ? "Styled" : "As captured"}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "replay" && (
        <div className="flex items-start gap-2 rounded-control border border-border-strong bg-elevated px-3 py-2 text-xs text-secondary">
          <FileWarning size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
          <span>
            {styled ? (
              <>
                Captured HTML, with stylesheets, images and fonts loaded from the live site so the page looks like itself.
                Scripts never run, and links are inert. Assets come from the site as it is <em>now</em>, so a since-changed
                page may not look exactly as it did at capture.
              </>
            ) : (
              <>
                HTML exactly as captured — nothing is fetched from the live site, so the page is deliberately unstyled.
                Faithful to the snapshot, but asset-heavy pages render as bare boxes.
              </>
            )}
          </span>
        </div>
      )}

      {mode === "live" && liveOk && (
        <div className="space-y-3">
          <SettingSwitch
            label="Live Page Preview"
            checked={liveEnabled}
            onChange={setLiveEnabled}
            onText="Live embed is active and rendering the external page."
            offText="Live embed is paused to avoid background load and scripts. Toggle to load."
            offTone="neutral"
          />

          {liveEnabled ? (
            <>
              <div className="flex items-start gap-2 rounded-control border border-border-strong bg-elevated px-3 py-2 text-xs text-secondary">
                <FileWarning size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
                <span>
                  The live site, embedded now — not the crawl snapshot. It reflects the page as it is today, so it can differ
                  from what was captured on {capturedLabel}.
                </span>
              </div>
              <div className="overflow-hidden rounded-card border border-border bg-white" style={{ height: "70vh" }}>
                <iframe
                  src={pageUrl}
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin"
                  title={`Live page: ${pageUrl}`}
                  className="h-full w-full"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border-strong bg-subtle p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card border border-border text-primary shadow-card">
                <Globe size={22} strokeWidth={1.75} />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">Live Site Preview is Paused</h4>
                <p className="max-w-md text-xs text-secondary mt-1">
                  Live preview loads external stylesheets, trackers, and scripts directly from {pageUrl}. Enable the switch above or click below to load it on demand.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLiveEnabled(true)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-control bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
              >
                <Play size={13} strokeWidth={2} />
                <span>Load Live Preview</span>
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "shot" && (
        <>
          <div className="flex items-start gap-2 rounded-control border border-border-strong bg-elevated px-3 py-2 text-xs text-secondary">
            <FileWarning size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
            <span>
              Full-page screenshot taken during the crawl, with JavaScript executed — this is exactly what the crawler saw
              at {capturedLabel}.
            </span>
          </div>

          {shotState === "loading" && <Skeleton className="h-[70vh] w-full" />}

          {shotState === "error" && (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load the screenshot"
              description={shotError ?? "Unknown error"}
            />
          )}

          {shotState === "not-found" && (
            <EmptyState
              icon={FileWarning}
              title="No screenshot stored for this page"
              description='Turn on "Capture screenshots" in New crawl and run it again, or the artifact has not been synced to storage yet.'
            />
          )}

          {shotState === "loaded" && shotUrl && (
            <div className="overflow-auto rounded-card border border-border bg-white" style={{ maxHeight: "70vh" }}>
              <img
                src={shotUrl}
                alt={`Screenshot of ${pageUrl} captured during the crawl`}
                className="w-full"
              />
            </div>
          )}
        </>
      )}

      {mode === "replay" && state === "loading" && <Skeleton className="h-[70vh] w-full" />}

      {mode === "replay" && state === "error" && (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load the replay"
          description={errorMessage ?? "Unknown error"}
          action={
            <button
              type="button"
              onClick={load}
              className="inline-flex h-8 items-center gap-1.5 rounded-control border border-border bg-transparent px-2.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
            >
              <RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" />
              Retry
            </button>
          }
        />
      )}

      {mode === "replay" && state === "not-found" && (
        <EmptyState
          icon={FileWarning}
          title={`No stored HTML for this page (${variant === "static" ? "static pre-JS" : "rendered"} variant)`}
          description="The crawler didn't save this variant for this page — it may only exist as the other variant, or this page failed before capture."
        />
      )}

      {mode === "replay" && state === "loaded" && replayUrl && (
        <div className="overflow-hidden rounded-card border border-border bg-white" style={{ height: "70vh" }}>
          <iframe
            key={`${variant}-${styled}`}
            src={replayUrl}
            sandbox={SANDBOX}
            referrerPolicy="no-referrer"
            title={`Captured HTML replay (${variant}) for ${pageUrl}`}
            className="h-full w-full"
          />
        </div>
      )}
    </div>
  );
}

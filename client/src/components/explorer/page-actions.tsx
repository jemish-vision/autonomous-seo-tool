import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clipboard, Download, ExternalLink, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiGet, ApiError } from "@/lib/api";
import type { CrawledPageWithId } from "@/lib/types";

// Mirrors Button's outline/sm classes — an <a> can't be a Button (button-in-anchor is invalid HTML).
const LINK_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-control border border-border bg-transparent px-2.5 text-xs font-medium text-foreground transition-colors duration-150 ease-out hover:bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50";

export function PageActions({ page, runId, hasRawHtml }: { page: CrawledPageWithId; runId: string; hasRawHtml: boolean }) {
  const [copied, setCopied] = useState(false);
  const [rawBusy, setRawBusy] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  // The raw HTML lives in Supabase Storage; this authed endpoint returns a short-lived signed URL.
  async function fetchRawUrl(): Promise<string> {
    const { url } = await apiGet<{ url: string }>(
      `/api/crawls/${encodeURIComponent(runId)}/pages/${encodeURIComponent(page.pageId)}/raw`,
    );
    return url;
  }

  function describeRawError(err: unknown): string {
    if (err instanceof ApiError) {
      return err.status === 404 ? "Raw HTML not stored for this page yet" : err.message;
    }
    return err instanceof Error ? err.message : "Couldn't load raw HTML";
  }

  async function openRaw() {
    setRawBusy(true);
    setRawError(null);
    try {
      const url = await fetchRawUrl();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setRawError(describeRawError(err));
    } finally {
      setRawBusy(false);
    }
  }

  async function downloadRaw() {
    setRawBusy(true);
    setRawError(null);
    try {
      const url = await fetchRawUrl();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${page.pageId}.html`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setRawError(describeRawError(err));
    } finally {
      setRawBusy(false);
    }
  }

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(page, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(page, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${page.pageId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The embedded replay below shares this page with 15 other panels in a narrow column;
          /preview is the same component full-width, and works even when no raw HTML was stored. */}
      <Link
        to={`/pages/${encodeURIComponent(page.pageId)}/preview?run=${encodeURIComponent(runId)}`}
        className={LINK_BUTTON_CLASS}
      >
        <Maximize2 size={14} strokeWidth={1.75} aria-hidden="true" />
        Full-page replay
      </Link>
      {hasRawHtml ? (
        <>
          <button type="button" onClick={openRaw} disabled={rawBusy} className={LINK_BUTTON_CLASS}>
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            Open raw HTML
          </button>
          <button type="button" onClick={downloadRaw} disabled={rawBusy} className={LINK_BUTTON_CLASS}>
            <Download size={14} strokeWidth={1.75} aria-hidden="true" />
            Download raw
          </button>
          {rawError && <span className="text-xs text-warn">{rawError}</span>}
        </>
      ) : (
        <span className="text-xs text-faint">No raw HTML stored for this page</span>
      )}
      <Button variant="outline" size="sm" onClick={copyJson}>
        {copied ? <Check size={14} strokeWidth={1.75} aria-hidden="true" /> : <Clipboard size={14} strokeWidth={1.75} aria-hidden="true" />}
        {copied ? "Copied" : "Copy JSON"}
      </Button>
      <Button variant="outline" size="sm" onClick={downloadJson}>
        <Download size={14} strokeWidth={1.75} aria-hidden="true" />
        Download JSON
      </Button>
    </div>
  );
}

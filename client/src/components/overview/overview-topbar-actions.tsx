import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, MoreVertical, Plus } from "lucide-react";
import type { CrawlSummary } from "@/lib/types";
import { useTopbarActions } from "@/lib/topbar-actions-context";
import { Button } from "@/components/ui/button";
import { NewCrawlTriggerButton } from "./new-crawl-trigger-button";

function downloadReport(report: CrawlSummary) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${report.runId}-report.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function OverviewActions({ report }: { report: CrawlSummary | null }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileMenuOpen]);

  return (
    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
      {/* Desktop & Tablet actions (>= 640px) */}
      <div className="hidden sm:flex items-center gap-2">
        {report && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadReport(report)}
            title="Export report JSON"
            aria-label="Export report JSON"
          >
            <Download size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Export</span>
          </Button>
        )}
        <NewCrawlTriggerButton />
      </div>

      {/* Mobile action menu popover (< 640px) */}
      <div ref={menuRef} className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={mobileMenuOpen}
          aria-label="Open action options"
          title="More actions"
          className="flex h-8 w-8 items-center justify-center rounded-control border border-border bg-subtle text-secondary hover:bg-elevated hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
        >
          <MoreVertical size={16} strokeWidth={2} />
        </button>

        {mobileMenuOpen && (
          <div
            role="menu"
            aria-label="Crawl actions"
            className="absolute right-0 top-[calc(100%+6px)] z-40 w-44 rounded-xl border border-border bg-card p-1.5 shadow-popover divide-y divide-border/50 animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="py-0.5">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate("/new-crawl");
                }}
                className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                <Plus size={15} strokeWidth={2} className="shrink-0 text-primary" />
                <span>New crawl</span>
              </button>
            </div>
            {report && (
              <div className="py-0.5">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    downloadReport(report);
                  }}
                  className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-xs font-medium text-secondary hover:bg-subtle hover:text-foreground transition-colors"
                >
                  <Download size={15} strokeWidth={1.75} className="shrink-0" />
                  <span>Export JSON</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function OverviewTopbarActions({ report }: { report: CrawlSummary | null }) {
  const { setActions } = useTopbarActions();

  useEffect(() => {
    setActions(<OverviewActions report={report} />);
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report identity changes per run; re-registering on every render would thrash the topbar
  }, [report?.runId]);

  return null;
}

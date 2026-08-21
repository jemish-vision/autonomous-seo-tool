import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface Props {
  runId: string;
  label?: string;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md";
  /** Stretch the button to fill its container (used in the new-crawl done panel's full-width row). */
  fullWidth?: boolean;
  className?: string;
  /** Called after a successful analyze + router.refresh() — e.g. navigate to /issues?run=. */
  onComplete?: () => void;
}

/** The in-app "Analyze now" button: POSTs /api/crawls/:id/reanalyze (which runs the rules engine,
 *  automation classifier, AND fix-plan generator, awaited), then router.refresh()s so the server
 *  components re-read the fresh issues.json / automation-report.json / fix-plan.json. Shared by the
 *  issues empty state, the run selector, and the new-crawl done panel. */
export function AnalyzeNowButton({ runId, label = "Analyze now", variant = "primary", size = "sm", fullWidth = false, className, onComplete }: Props) {
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (state === "running") return;
    setState("running");
    setError(null);
    try {
      const res = await fetch(`/api/crawls/${encodeURIComponent(runId)}/reanalyze`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        // reanalyze re-runs the rules engine over stored pages, which lives in the crawler worker.
        // Until that worker is wired in, the route returns 404/501 — surface that honestly rather
        // than a bare status code.
        if (res.status === 404 || res.status === 501) {
          throw new Error("Re-analysis isn't available in this build yet (requires the crawler worker).");
        }
        throw new Error(body?.error?.message ?? `Analysis failed (HTTP ${res.status}).`);
      }
      setState("idle");
      onComplete?.();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Analysis failed.");
    }
  }

  return (
    <span className={cn("inline-flex flex-col items-start gap-1.5", fullWidth && "w-full", className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => void run()}
        disabled={state === "running"}
        aria-live="polite"
        className={fullWidth ? "w-full" : undefined}
      >
        {state === "running" ? (
          <Loader2 size={13} strokeWidth={2} className="animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" />
        )}
        {state === "running" ? "Analyzing…" : label}
      </Button>
      {state === "error" && error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

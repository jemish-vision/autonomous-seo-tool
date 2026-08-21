import { useState } from "react";
import { Loader2, Sparkles, CheckCircle2, Search, TrendingUp, Globe, Bot, ChevronRight, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getGscStatus } from "@/components/gsc/gsc-api";
import { useGenerateAiRecommendations, type IntelligencePayload } from "@/api/ai-generate";

interface Props {
  runId: string;
  /** Scope to one rule (the "AI Suggestions" panel's own generate action). Omit to generate for
   *  the whole run, up to the endpoint's default cap. */
  ruleId?: string;
  /** Scope to one page (a page-detail "generate for this page" action, if ever wired). */
  pageId?: string;
  label?: string;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md";
  className?: string;
  onComplete?: () => void;
}

interface GscCheckState {
  connected: boolean;
  email?: string | null;
}

/** Professional Autonomous SEO Intelligence & Generation Flow Component */
export function AiRecommendNowButton({ runId, ruleId, pageId, label, variant = "primary", size = "sm", className, onComplete }: Props) {
  const generate = useGenerateAiRecommendations(runId);
  const [state, setState] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [gscStatus, setGscStatus] = useState<GscCheckState | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (state === "running") return;
    setState("running");
    setCurrentStep(1); // 1. Checking GSC
    setError(null);
    setIntelligence(null);
    setGscStatus(null);

    // 1. Immediately verify Google Search Console connection in parallel
    getGscStatus()
      .then((st) => {
        setGscStatus({
          connected: Boolean(st?.connected),
          email: st?.connection?.googleEmail ?? null,
        });
        setCurrentStep((prev) => Math.max(prev, 2));
      })
      .catch(() => {
        setGscStatus({ connected: false });
        setCurrentStep((prev) => Math.max(prev, 2));
      });

    // 2. Timed transition to Step 3 for smooth UX while backend processes SERP & model
    const timer3 = setTimeout(() => {
      setCurrentStep((prev) => Math.max(prev, 3));
    }, 1800);

    try {
      const data = await generate.mutateAsync({ ruleId, pageId });

      clearTimeout(timer3);

      setCurrentStep(4);
      if (data.intelligence) {
        setIntelligence(data.intelligence);
        setGscStatus({
          connected: data.intelligence.gscConnected,
          email: gscStatus?.email,
        });
      }

      // Keep success / live intelligence card visible
      setState("completed");
      onComplete?.();
    } catch (err) {
      clearTimeout(timer3);
      setState("error");
      setError(err instanceof Error ? err.message : "AI generation failed.");
    }
  }

  const isGscActive = intelligence ? intelligence.gscConnected : gscStatus ? gscStatus.connected : false;

  return (
    <div className={cn("flex flex-col items-start gap-3 w-full", className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => void run()}
        disabled={state === "running"}
        aria-live="polite"
        className="transition-all duration-200"
      >
        {state === "running" ? (
          <Loader2 size={13} strokeWidth={2} className="animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" />
        )}
        {state === "running"
          ? "Autonomous Intelligence Active…"
          : state === "completed"
            ? "Regenerate AI Suggestions"
            : (label ?? (ruleId ? "Generate AI suggestions" : "Generate AI suggestions for this run"))}
      </Button>

      {/* Real-time SaaS Workflow & Intelligence Card */}
      {(state === "running" || state === "completed") && (
        <div className="w-full rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card to-card p-4 shadow-sm backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200 space-y-3.5">
          {/* Card Header */}
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/50">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-contrast shadow-xs">
                <Sparkles size={11} />
              </span>
              <span className="text-xs font-bold text-foreground">Autonomous Fix Workflow</span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-0.5 font-mono text-[10px] font-semibold text-secondary">
              {state === "running" ? (
                <>
                  <Loader2 size={10} className="animate-spin text-primary" /> Step {Math.min(currentStep, 4)} of 4
                </>
              ) : (
                <span className="text-emerald-500 flex items-center gap-1">
                  <CheckCircle2 size={11} /> Completed
                </span>
              )}
            </span>
          </div>

          {/* Steps Timeline */}
          <div className="space-y-2.5">
            {/* Step 1: GSC Connection & Domain Check */}
            <div className="flex items-start gap-2.5 text-xs">
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] transition-all",
                  gscStatus !== null || state === "completed"
                    ? isGscActive
                      ? "bg-emerald-500/20 text-emerald-400 font-bold"
                      : "bg-amber-500/20 text-amber-400 font-bold"
                    : currentStep === 1
                      ? "bg-primary text-primary-contrast shadow-xs"
                      : "bg-subtle text-faint border border-border"
                )}
              >
                {gscStatus !== null || state === "completed" ? (
                  <CheckCircle2 size={11} strokeWidth={2.5} />
                ) : currentStep === 1 ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  "1"
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Globe size={12} className="text-primary shrink-0" />
                  <span>Google Search Console Integration</span>
                </div>
                {gscStatus === null && state === "running" && (
                  <p className="text-[11px] text-primary mt-0.5 animate-pulse">
                    Checking Google Search Console connection & domain metrics…
                  </p>
                )}
                {(gscStatus !== null || state === "completed") && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {isGscActive ? (
                      <span className="text-emerald-400 font-medium">
                        ✅ Active GSC connection verified {intelligence?.domain ? `for ${intelligence.domain}` : gscStatus?.email ? `(${gscStatus.email})` : ""}
                      </span>
                    ) : (
                      <span className="text-amber-400 font-medium">Direct crawl mode (no connected GSC account)</span>
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* Step 2: Top Search Query Analysis */}
            <div className="flex items-start gap-2.5 text-xs">
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] transition-all",
                  currentStep > 2 || state === "completed" || intelligence?.topKeyword
                    ? "bg-emerald-500/20 text-emerald-400 font-bold"
                    : currentStep === 2
                      ? "bg-primary text-primary-contrast shadow-xs"
                      : "bg-subtle text-faint border border-border"
                )}
              >
                {currentStep > 2 || state === "completed" || intelligence?.topKeyword ? (
                  <CheckCircle2 size={11} strokeWidth={2.5} />
                ) : currentStep === 2 ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  "2"
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Search size={12} className="text-primary shrink-0" />
                  <span>Target Search Intent & Queries</span>
                </div>
                {state === "running" && !intelligence?.topKeyword && (
                  <p className="text-[11px] text-primary mt-0.5 animate-pulse">
                    Extracting high-ranking search queries & impressions…
                  </p>
                )}
                {intelligence?.topKeyword && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-subtle/80 px-2.5 py-1 text-[11px]">
                    <span className="font-semibold text-foreground">
                      Keyword: <span className="text-emerald-400">"{intelligence.topKeyword}"</span>
                    </span>
                    <span className="text-faint">•</span>
                    <span className="text-muted-foreground">{intelligence.impressions?.toLocaleString() ?? 0} impressions</span>
                    <span className="text-faint">•</span>
                    <span className="text-muted-foreground">{intelligence.clicks ?? 0} clicks</span>
                  </div>
                )}
                {state === "completed" && !intelligence?.topKeyword && (
                  <p className="text-[11px] text-faint mt-0.5">Using on-page extracted topic & keywords</p>
                )}
              </div>
            </div>

            {/* Step 3: OpenSERP Competitor Benchmarks */}
            <div className="flex items-start gap-2.5 text-xs">
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] transition-all",
                  currentStep > 3 || state === "completed" || (intelligence?.competitorBenchmarks && intelligence.competitorBenchmarks.length > 0)
                    ? "bg-emerald-500/20 text-emerald-400 font-bold"
                    : currentStep === 3
                      ? "bg-primary text-primary-contrast shadow-xs"
                      : "bg-subtle text-faint border border-border"
                )}
              >
                {currentStep > 3 || state === "completed" || (intelligence?.competitorBenchmarks && intelligence.competitorBenchmarks.length > 0) ? (
                  <CheckCircle2 size={11} strokeWidth={2.5} />
                ) : currentStep === 3 ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  "3"
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <TrendingUp size={12} className="text-primary shrink-0" />
                  <span>Live OpenSERP Competitor Intelligence</span>
                </div>
                {state === "running" && (!intelligence?.competitorBenchmarks || intelligence.competitorBenchmarks.length === 0) && (
                  <p className="text-[11px] text-primary mt-0.5 animate-pulse">
                    Scanning top SERP competitors via OpenSERP…
                  </p>
                )}
                {intelligence?.competitorBenchmarks && intelligence.competitorBenchmarks.length > 0 && (
                  <div className="mt-1 space-y-1 rounded-lg border border-border/60 bg-subtle/80 p-2 text-[11px]">
                    <div className="text-faint font-semibold uppercase text-[10px]">Top Benchmarked Competitors:</div>
                    {intelligence.competitorBenchmarks.slice(0, 3).map((title, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-secondary truncate">
                        <ChevronRight size={11} className="text-primary shrink-0" />
                        <span className="truncate">{title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Step 4: Final AI Recommendation Synthesis */}
            <div className="flex items-start gap-2.5 text-xs">
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] transition-all",
                  state === "completed"
                    ? "bg-emerald-500/20 text-emerald-400 font-bold"
                    : currentStep === 4
                      ? "bg-primary text-primary-contrast shadow-xs"
                      : "bg-subtle text-faint border border-border"
                )}
              >
                {state === "completed" ? (
                  <CheckCircle2 size={11} strokeWidth={2.5} />
                ) : currentStep === 4 ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  "4"
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Bot size={12} className="text-primary shrink-0" />
                  <span>Exact-Fix AI Recommendations Assembled</span>
                </div>
                {state === "running" && currentStep === 4 && (
                  <p className="text-[11px] text-primary mt-0.5 animate-pulse">
                    Synthesizing rulebook fixes with AI…
                  </p>
                )}
                {state === "completed" && (
                  <p className="text-[11px] text-emerald-400 mt-0.5 font-medium">
                    All suggestions validated against rules and ready for review below.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {state === "error" && error && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger font-medium">
          <XCircle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

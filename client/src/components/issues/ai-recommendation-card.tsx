import { useMemo, useState } from "react";
import { Sparkles, Copy, Check, AlertTriangle, Globe, ArrowRight, Lightbulb, ListChecks, Wrench, Search, TrendingUp, Plug, Send, Loader2, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { splitHowToApply } from "@/lib/ai-recommend/how-to-apply";
import { formatShortDate } from "@/lib/format-date";
import { changesForRecommendation } from "@/lib/ai-recommend/apply-plan";
import { apiGet, apiSend, ApiError } from "@/lib/api";
import { useAppliedFixes } from "./applied-fixes-context";
import type { AiRecommendation } from "@/lib/ai-recommend/types";

/** The stored recommendedValue/currentValue is exact HTML markup, so a literal & is legitimately
 *  serialised as &amp; (and < > " likewise). That is correct for pasting into a page, but reads
 *  wrong in the UI — decode those four entities for DISPLAY only, so the user sees the original
 *  characters. The copy button keeps using recommendedValuePlain (already clean text), so what
 *  you copy is never affected. Order matters: named entities first, &amp; last, so an escaped
 *  literal like &amp;lt; decodes back to &lt; rather than being double-decoded into <. */
function decodeHtmlEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Section label with a colour-coded icon + text so a user can scan a card by colour, not just
 *  read it. Tones: `current` (neutral), `recommended` (green = the fix), `why` (primary),
 *  `basedOn` (blue = evidence), `howToApply` (amber = action). */
function SectionLabel({ icon, children, tone }: { icon: React.ReactNode; children: string; tone: "current" | "recommended" | "why" | "basedOn" | "howToApply" }) {
  const tones: Record<string, string> = {
    current: "text-faint",
    recommended: "text-ok",
    why: "text-primary",
    basedOn: "text-data-blue",
    howToApply: "text-warn",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest", tones[tone])}>
      {icon}
      {children}
    </span>
  );
}

/** Short absolute date for the Applied badge — a relative "3 days ago" is worse here, because
 *  what the user needs to know is whether the fix predates their last content edit. */
const formatAppliedAt = formatShortDate;

// ── Fix & Apply state machine ─────────────────────────────────────────────

type FixState =
  | { phase: "idle" }
  /** Restored from applied-fixes.json on mount — a fix applied in an earlier session must not
   *  come back looking like it was never applied. */
  | { phase: "applied"; appliedAt: string; changes: Record<string, string>; queued: boolean }
  | { phase: "resolving" }
  | { phase: "needs-connect"; sourceName: string; sourceId: string }
  | { phase: "writing" }
  | { phase: "success"; receipt: Record<string, unknown>; note?: string }
  | { phase: "error"; message: string };

/** Tunnel writes are applied asynchronously by the WordPress plugin — poll the command until it
 *  reports back (or we give up), so the UI can show a real applied/failed outcome instead of a
 *  permanent "queued". Returns the finished command, or null on timeout. */
async function pollTunnelCommand(id: string): Promise<{ status: string; receipt: Record<string, unknown> | null } | null> {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2000)); // plugin polls ~every 10s; check a few times over ~24s
    try {
      const { command } = await apiGet<{ command: { status: string; receipt: Record<string, unknown> | null } }>(
        `/api/tunnel/commands/${encodeURIComponent(id)}`,
      );
      if (command.status === "completed" || command.status === "failed") return command;
    } catch {
      /* keep polling — a transient error shouldn't abort the wait */
    }
  }
  return null;
}

/** On a noindex page the SEO plugin deliberately omits the meta description, so a saved value is
 *  stored but never renders on the live page. The plugin reports `noindex` in its receipt — prefer
 *  that; fall back to warning on archive types (commonly noindexed) for older plugin builds. */
function noindexNote(receipt: Record<string, unknown> | null): string | undefined {
  if (receipt?.noindex === true) {
    return "This page is set to noindex, so your SEO plugin won't render a meta description on it. The value was saved (you'll see it in the WordPress SEO box) but it won't appear in the page source — that's expected for noindex pages.";
  }
  if (receipt?.noindex === undefined) {
    const type = (receipt?.resource as { type?: string } | undefined)?.type;
    if (type === "author" || type === "category" || type === "home_index") {
      return "Heads up: this is an archive page. If your SEO plugin has it set to noindex, the value is saved but won't render on the live page.";
    }
  }
  return undefined;
}

/** Per Design DNA: rounded card with a gradient accent strip up top, a soft brand-tinted
 *  background, and colour-coded sections (Current / Recommended / Why / Based on / How to apply)
 *  so the fix reads at a glance. Each card is scoped to ONE page — the page URL is shown as a
 *  link at the top ("page-wise"), so a rule with several recommendations is easy to scan by page.
 *  Nothing is written to the customer's site except on an explicit Fix & Apply click, and only
 *  for the categories changesForRecommendation() maps onto a writable connector field. */
export function AiRecommendationCard({ recommendation }: { recommendation: AiRecommendation }) {
  const [copied, setCopied] = useState(false);
  const r = recommendation;
  const applied = useAppliedFixes();

  // Seed from this run's applied-fixes.json so a refresh (or a Regenerate, which rewrites
  // ai-recommendations.json wholesale) never resurrects an already-applied card as untouched.
  const priorFix = applied.get(r.issueRuleId, r.pageId, r.instanceKey);
  const [fixState, setFixState] = useState<FixState>(() =>
    priorFix ? { phase: "applied", appliedAt: priorFix.appliedAt, changes: priorFix.changes, queued: priorFix.queued } : { phase: "idle" },
  );

  function handleCopy() {
    navigator.clipboard.writeText(r.recommendedValuePlain || r.recommendedValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleFixAndApply() {
    if (!r.url) return;

    const plan = changesForRecommendation(r);
    if (!plan) {
      setFixState({
        phase: "error",
        message: `This recommendation has no automatic apply path — "${r.category}" is advisory or needs markup the connector cannot write. Copy the value and apply it by hand.`,
      });
      return;
    }

    // Source is matched by the page URL (always on the site). The WRITE target can differ: an
    // image-alt fix resolves to the attachment behind the image URL, not the page.
    const writeUrl = plan.targetUrl ?? r.url;

    // Phase 1: Resolve which source owns this URL. apiSend attaches the Supabase Bearer token —
    // a raw fetch would 401 (the API authenticates by the Authorization header, not the cookie).
    setFixState({ phase: "resolving" });
    try {
      const resolveData = await apiSend<{
        resolved?: boolean;
        source?: { id: string; name: string };
        connection?: { state?: string };
      }>("POST", "/api/sources/resolve", { url: r.url });

      if (!resolveData.resolved || !resolveData.source) {
        setFixState({ phase: "needs-connect", sourceName: "", sourceId: "" });
        return;
      }

      // Phase 2: Check if connected
      if (resolveData.connection?.state !== "connected") {
        setFixState({
          phase: "needs-connect",
          sourceName: resolveData.source.name,
          sourceId: resolveData.source.id,
        });
        return;
      }

      // Phase 3: Write the SEO change via the dashboard route. Direct connections proxy to the
      // WordPress REST API; tunnel connections queue a command the plugin applies on its next poll.
      setFixState({ phase: "writing" });
      const result = await apiSend<Record<string, unknown>>(
        "POST",
        `/api/sources/${encodeURIComponent(resolveData.source.id)}/seo`,
        { url: writeUrl, changes: plan.changes, kind: plan.kind },
      );

      // Tunnel writes return { queued: true, commandId } and are applied asynchronously by the
      // plugin — poll for the real receipt so "Applied" means it actually landed, not just queued.
      const commandId = typeof result.commandId === "string" ? result.commandId : null;
      let receipt: Record<string, unknown> = result;
      let note: string | undefined;
      if (result.queued && commandId) {
        const outcome = await pollTunnelCommand(commandId);
        if (outcome?.status === "failed" || (outcome?.receipt as { status?: string } | null)?.status === "error") {
          const msg = (outcome?.receipt as { message?: string } | null)?.message ?? "The WordPress plugin could not apply the change.";
          setFixState({ phase: "error", message: msg });
          return;
        }
        if (outcome?.status === "completed" && outcome.receipt) {
          receipt = { ...outcome.receipt, queued: false };
          note = noindexNote(outcome.receipt);
        } else {
          // Timed out waiting for the plugin — leave it queued, but say so honestly.
          note = "The plugin hasn't reported back yet — it may still be applying. Re-check in a few seconds.";
        }
      }
      setFixState({ phase: "success", receipt, note });

      // Persist it, so the badge survives a refresh instead of the card offering Fix & Apply
      // again as if nothing had happened. Fire-and-forget: the site write already landed.
      void applied.record({
        ruleId: r.issueRuleId,
        pageId: r.pageId,
        instanceKey: r.instanceKey,
        url: writeUrl,
        changes: plan.changes,
        sourceId: resolveData.source.id,
        queued: Boolean(result.queued),
        commandId: typeof result.commandId === "string" ? result.commandId : null,
      });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.status === 401
            ? "Your session expired — sign in again, then retry Fix & Apply."
            : err.message
          : err instanceof Error
            ? err.message
            : "Connection check failed";
      setFixState({ phase: "error", message });
    }
  }

  const confidenceTone = r.confidence >= 0.8 ? "ok" : r.confidence >= 0.5 ? "warn" : "danger";
  // Fix & Apply needs both a URL to target and a category that maps onto a writable connector
  // field. Computed once so the button condition and the click handler can never disagree.
  const applyChanges = useMemo(() => (r.url ? changesForRecommendation(r) : null), [r]);

  return (
    <article className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] via-card to-card shadow-[var(--shadow-card)] transition-shadow duration-150 hover:shadow-[var(--shadow-popover)]">
      {/* gradient accent strip — the visual cue that this is an AI card */}
      <div className="h-1 w-full bg-gradient-to-r from-primary via-data-violet to-data-orange" aria-hidden="true" />

      <div className="space-y-3.5 p-4">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
            <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
            AI Recommendation
          </span>
          <div className="flex items-center gap-1.5">
            {r.isGscEnriched && r.gscKeyword ? (
              <Badge tone="ok">
                <TrendingUp size={11} strokeWidth={2.5} className="mr-1 inline-block" aria-hidden="true" />
                GSC & OpenSERP Enriched
              </Badge>
            ) : null}
            {r.needsHumanInput ? (
              <Badge tone="warn">
                <AlertTriangle size={11} strokeWidth={2} className="mr-1 inline-block" aria-hidden="true" />
                Needs your input
              </Badge>
            ) : (
              <Badge tone={confidenceTone}>{Math.round(r.confidence * 100)}% confidence</Badge>
            )}
          </div>
        </div>

        {/* GSC & OpenSERP Intelligence Insight Badge */}
        {r.isGscEnriched && r.gscKeyword && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <Search size={13} className="text-emerald-500 shrink-0" />
              <span className="font-semibold text-foreground">
                Target Ranking Query: <span className="text-emerald-400">&quot;{r.gscKeyword}&quot;</span>
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {r.gscImpressions !== null && r.gscImpressions !== undefined && <span>{r.gscImpressions.toLocaleString()} impressions</span>}
              {r.gscClicks !== null && r.gscClicks !== undefined && (
                <>
                  <span>•</span>
                  <span>{r.gscClicks} clicks</span>
                </>
              )}
              {r.competitorBenchmarkTitles && r.competitorBenchmarkTitles.length > 0 && (
                <>
                  <span>•</span>
                  <span className="text-primary font-medium">{r.competitorBenchmarkTitles.length} competitors analyzed</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* page-wise: which page this suggestion is for */}
        {r.url && (
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-1.5 rounded-control border border-border bg-card px-2.5 py-1.5 text-xs text-secondary transition-colors duration-100 hover:border-primary/40 hover:text-primary"
          >
            <Globe size={12} className="shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{r.url}</span>
            <ArrowRight size={12} className="ml-auto shrink-0 text-faint transition-transform duration-100 group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
        )}

        <p className="text-sm leading-relaxed text-foreground">{r.whatIsWrong}</p>

        {r.needsHumanInput ? (
          <div className="rounded-xl border border-warn/30 bg-warn-bg/60 px-3.5 py-3 text-xs text-warn">
            <p className="font-semibold">This one needs a human decision — the AI didn&apos;t guess.</p>
            <p className="mt-1 text-secondary">{r.needsHumanInputReason}</p>
          </div>
        ) : (
          <>
            {r.currentValue && (
              <div className="space-y-1">
                <SectionLabel icon={<span className="h-1.5 w-1.5 rounded-full bg-faint" aria-hidden="true" />} tone="current">
                  Current
                </SectionLabel>
                <code className="block overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-elevated px-3 py-2 text-xs leading-relaxed text-secondary">
                  {decodeHtmlEntities(r.currentValue)}
                </code>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <SectionLabel icon={<Check size={11} strokeWidth={3} aria-hidden="true" />} tone="recommended">
                  Recommended
                </SectionLabel>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={handleCopy} className="h-6 px-2 text-[11px] gap-1">
                    {copied ? (
                      <>
                        <Check size={12} className="text-ok" aria-hidden="true" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={12} aria-hidden="true" /> Copy
                      </>
                    )}
                  </Button>

                  {/* ── Fix & Apply button ── */}
                  {applyChanges !== null && (
                    <FixAndApplyButton state={fixState} onApply={handleFixAndApply} />
                  )}
                </div>
              </div>
              {/* the fix is the hero — green-tinted highlight box so it pops off the card */}
              <div className="overflow-hidden rounded-xl border border-ok/25 bg-ok-bg/40 px-3 py-2.5">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-foreground">{decodeHtmlEntities(r.recommendedValue)}</pre>
              </div>
            </div>

            {r.whyThisValue && (
              <div className="space-y-1">
                <SectionLabel icon={<Lightbulb size={11} strokeWidth={2} aria-hidden="true" />} tone="why">
                  Why
                </SectionLabel>
                <p className="whitespace-pre-line text-xs leading-relaxed text-secondary">{r.whyThisValue}</p>
              </div>
            )}

            {r.basedOn.length > 0 && (
              <div className="space-y-1">
                <SectionLabel icon={<ListChecks size={11} strokeWidth={2} aria-hidden="true" />} tone="basedOn">
                  Based on
                </SectionLabel>
                <dl className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  {r.basedOn.map((b, i) => (
                    <div key={i} className="flex items-baseline gap-1">
                      <dt className="font-mono text-faint">{b.field}:</dt>
                      <dd className="text-secondary">{b.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {r.howToApply && (() => {
              const { lines, numbered } = splitHowToApply(r.howToApply);
              return (
                <div className="space-y-1">
                  <SectionLabel icon={<Wrench size={11} strokeWidth={2} aria-hidden="true" />} tone="howToApply">
                    How to apply
                  </SectionLabel>
                  {numbered ? (
                    <ol className="space-y-1.5 text-xs leading-relaxed text-secondary">
                      {lines.map((line, i) => {
                        const m = /^\d+[.)]\s*(.*)$/.exec(line);
                        return (
                          <li key={i} className="flex gap-2">
                            <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-warn/15 text-[10px] font-bold text-warn" aria-hidden="true">
                              {i + 1}
                            </span>
                            <span>{m ? m[1] : line}</span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="whitespace-pre-line text-xs leading-relaxed text-secondary">{r.howToApply}</p>
                  )}
                </div>
              );
            })()}

            {/* ── Fix & Apply status feedback ── */}
            {fixState.phase === "needs-connect" && (
              <div className="rounded-xl border border-warn/30 bg-warn-bg/60 px-3.5 py-3 text-xs">
                <p className="font-semibold text-warn flex items-center gap-1.5">
                  <Plug size={13} aria-hidden="true" /> Site not connected
                </p>
                <p className="mt-1 text-secondary">
                  {fixState.sourceName
                    ? `"${fixState.sourceName}" is not connected. `
                    : "No source is connected for this URL. "}
                  Connect it on the{' '}
                  <a href="/sources" className="text-primary underline underline-offset-2 hover:opacity-80">Sources</a>{' '}
                  page first, then come back and click Fix &amp; Apply again.
                </p>
              </div>
            )}

            {fixState.phase === "success" && (
              <div className="rounded-xl border border-ok/30 bg-ok-bg/60 px-3.5 py-3 text-xs">
                <p className="font-semibold text-ok flex items-center gap-1.5">
                  <CheckCircle2 size={13} aria-hidden="true" /> {(fixState.receipt as Record<string, unknown>)?.queued ? "Command queued" : "Changes applied"}
                </p>
                <p className="mt-1 text-secondary">
                  {(fixState.receipt as Record<string, unknown>)?.queued
                    ? `The fix is queued — the WordPress plugin applies it within ~10 seconds.`
                    : `The plugin applied the change and confirmed it on the connected site.`}
                </p>
                {fixState.note && <p className="mt-1.5 text-[11px] text-warn">{fixState.note}</p>}
              </div>
            )}

            {fixState.phase === "applied" && (
              <div className="rounded-xl border border-ok/25 bg-ok-bg/40 px-3.5 py-3 text-xs">
                <p className="font-semibold text-ok flex items-center gap-1.5">
                  <CheckCircle2 size={13} aria-hidden="true" /> Applied {formatAppliedAt(fixState.appliedAt)}
                </p>
                <p className="mt-1 text-secondary">
                  {Object.entries(fixState.changes).map(([field, value]) => (
                    <span key={field} className="mr-2 inline-block">
                      <span className="font-mono text-faint">{field}:</span> {value}
                    </span>
                  ))}
                </p>
                <p className="mt-1.5 text-faint">
                  The issue above still reads as failing because it comes from the last crawl, not from the live site.
                  Re-crawl to confirm the fix landed.
                </p>
              </div>
            )}

            {fixState.phase === "error" && (
              <div className="rounded-xl border border-danger/30 bg-danger-bg/60 px-3.5 py-3 text-xs">
                <p className="font-semibold text-danger flex items-center gap-1.5">
                  <XCircle size={13} aria-hidden="true" /> Fix failed
                </p>
                <p className="mt-1 text-secondary">{fixState.message}</p>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

// ── Fix & Apply button sub-component ──────────────────────────────────────

function FixAndApplyButton({ state, onApply }: { state: FixState; onApply: () => void }) {
  if (state.phase === "success") {
    return (
      <span className="inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-[11px] font-medium text-ok">
        <CheckCircle2 size={11} aria-hidden="true" /> Applied
      </span>
    );
  }

  // Applied in an earlier session. Offer a quieter re-apply rather than hiding the action: the
  // page can be edited back in WordPress after the fact, and then this value needs pushing again.
  if (state.phase === "applied") {
    return (
      <Button variant="ghost" size="sm" onClick={onApply} className="h-6 px-2 text-[11px] gap-1 text-ok hover:text-ok">
        <RotateCcw size={11} aria-hidden="true" /> Re-apply
      </Button>
    );
  }

  if (state.phase === "needs-connect") {
    return (
      <a
        href="/sources"
        className="inline-flex items-center gap-1 rounded-control border border-warn/40 bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn transition-colors hover:bg-warn/10"
      >
        <Plug size={11} aria-hidden="true" /> Connect site
      </a>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onApply}
      disabled={state.phase === "resolving" || state.phase === "writing"}
      className="h-6 px-2 text-[11px] gap-1"
    >
      {state.phase === "resolving" || state.phase === "writing" ? (
        <Loader2 size={11} className="animate-spin" aria-hidden="true" />
      ) : (
        <Send size={11} aria-hidden="true" />
      )}
      {state.phase === "resolving" ? "Checking…" : state.phase === "writing" ? "Applying…" : "Fix & Apply"}
    </Button>
  );
}

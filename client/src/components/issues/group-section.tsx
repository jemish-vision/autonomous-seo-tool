import { useState } from "react";
import { cn } from "@/lib/cn";
import { FindingRow } from "./finding-row";
import type { RuleGroupLite } from "@/lib/issues-view-helpers";
import type { RuleAutomationSummary, FixPlanItem } from "@/lib/data-issue-extras";
import type { AiRecommendation } from "@/lib/ai-recommend/types";
import type { FindingReport } from "@/lib/types";

export const slug = (s: string) => `g-${String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

interface Props {
  name: string;
  list: RuleGroupLite[];
  runId: string;
  pageIdToUrl: Map<string, string>;
  automationByRule: Map<string, RuleAutomationSummary>;
  findingsByRule: Map<string, FindingReport>;
  fixPlanByRule: Map<string, FixPlanItem[]>;
  fixPlanAvailable: boolean;
  aiRecommendationsByRule: Map<string, AiRecommendation[]>;
  mutePending: (ruleId: string) => boolean;
  onMuteToggle: (ruleId: string) => void;
  onOpenFixPlan: (ruleId: string) => void;
  defaultOpen: boolean;
}

/** A requirement area, with its own severity tally, collapsible so the areas you are not
 *  working on fold away entirely. Ported from the reference poc's GroupSection. */
export function GroupSection({
  name,
  list,
  runId,
  pageIdToUrl,
  automationByRule,
  findingsByRule,
  fixPlanByRule,
  fixPlanAvailable,
  aiRecommendationsByRule,
  mutePending,
  onMuteToggle,
  onOpenFixPlan,
  defaultOpen,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const firing = list.filter((r) => r.items.length > 0);
  const n = (sev: string) => firing.filter((r) => r.severity === sev).length;

  return (
    <section id={slug(name)} className="scroll-mt-20 overflow-hidden rounded-card border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left outline-none transition-colors duration-100 hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span
          className={cn("shrink-0 text-faint transition-transform duration-150", open && "rotate-90")}
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </span>
        <span className="text-sm font-semibold text-foreground">{name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {n("error") > 0 && (
            <span className="rounded-pill bg-danger-bg px-2 py-0.5 text-[11px] font-bold tabular-nums text-danger" title="critical rules">
              {n("error")}
            </span>
          )}
          {n("warning") > 0 && (
            <span className="rounded-pill bg-warn-bg px-2 py-0.5 text-[11px] font-bold tabular-nums text-warn" title="warning rules">
              {n("warning")}
            </span>
          )}
          {n("notice") > 0 && (
            <span className="rounded-pill bg-data-blue/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-data-blue" title="notice rules">
              {n("notice")}
            </span>
          )}
          {firing.length === 0 && (
            <span className="rounded-pill bg-ok-bg px-2 py-0.5 text-[11px] font-medium text-ok">✓ all passing</span>
          )}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-faint">
          {list.length} rule{list.length > 1 ? "s" : ""}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          {list.map((g) => (
            <FindingRow
              key={g.ruleId}
              group={g}
              runId={runId}
              pageIdToUrl={pageIdToUrl}
              automation={automationByRule.get(g.ruleId) ?? null}
              finding={findingsByRule.get(g.ruleId) ?? null}
              fixPlanItems={fixPlanByRule.get(g.ruleId) ?? []}
              fixPlanAvailable={fixPlanAvailable}
              aiRecommendations={aiRecommendationsByRule.get(g.ruleId) ?? []}
              muted={false}
              mutePending={mutePending(g.ruleId)}
              onMuteToggle={onMuteToggle}
              onOpenFixPlan={onOpenFixPlan}
            />
          ))}
        </div>
      )}
    </section>
  );
}

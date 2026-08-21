import { Badge } from "@/components/ui/badge";
import type { AutomationLevel } from "@/lib/data-issue-extras";
import type { FindingReport } from "@/lib/types";

const AUTOMATION_LABEL: Record<AutomationLevel, string> = {
  "auto-safe": "Auto-safe",
  "auto-with-review": "Auto, needs review",
  "human-only": "Human-only",
};
const AUTOMATION_TONE: Record<AutomationLevel, "ok" | "warn" | "neutral"> = {
  "auto-safe": "ok",
  "auto-with-review": "warn",
  "human-only": "neutral",
};

/** "Not classified" when automation-report.json hasn't been generated for this run — never a
 *  guessed level (see lib/data-issue-extras.ts). */
export function AutomationBadge({ level }: { level: AutomationLevel | null }) {
  if (!level) return <Badge tone="neutral">Not classified</Badge>;
  return <Badge tone={AUTOMATION_TONE[level]}>{AUTOMATION_LABEL[level]}</Badge>;
}

export function EffortBadge({ level }: { level: "low" | "medium" | "high" | null }) {
  if (!level) return <Badge tone="neutral">Effort —</Badge>;
  return <Badge tone={level === "low" ? "ok" : level === "medium" ? "warn" : "danger"}>Effort: {level}</Badge>;
}

export function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null) return <Badge tone="neutral">Confidence —</Badge>;
  return <Badge tone="neutral">{Math.round(value * 100)}% confidence</Badge>;
}

/** The real composite: priority = round(100 x severityWeight x reach x importance x confidence),
 *  computed server-side in src/analysis/priority/priority.ts and read here as-is — every factor
 *  behind the number is shown so the ranking is never a magic number. `finding` is null when this
 *  run's issues.json predates the priority slice (old stored run); that's shown honestly rather
 *  than approximated. */
export function PriorityFactors({ finding }: { finding: FindingReport | null }) {
  if (!finding || !finding.priorityFactors) {
    return <p className="text-xs text-faint">Priority score not available — this run predates the priority engine.</p>;
  }
  const f = finding.priorityFactors;
  return (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <div>
        <dt className="inline text-faint">Priority </dt>
        <dd className="inline text-sm font-semibold text-foreground">{finding.priority}</dd>
        <dd className="inline text-faint"> /100</dd>
      </div>
      <div>
        <dt className="inline text-faint">Severity </dt>
        <dd className="inline font-medium text-foreground">{Math.round(f.severity * 100)}%</dd>
      </div>
      <div>
        <dt className="inline text-faint">Reach </dt>
        <dd className="inline font-medium text-foreground">{Math.round(f.reach * 100)}% of pages</dd>
      </div>
      <div>
        <dt className="inline text-faint">Page importance </dt>
        <dd className="inline font-medium text-foreground">{Math.round(f.importance * 100)}%</dd>
      </div>
      <div>
        <dt className="inline text-faint">Confidence </dt>
        <dd className="inline font-medium text-foreground">{Math.round(f.confidence * 100)}%</dd>
      </div>
    </dl>
  );
}

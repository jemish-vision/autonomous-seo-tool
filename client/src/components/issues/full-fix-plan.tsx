import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FixPlan } from "@/lib/data-issue-extras";

interface Props {
  plan: FixPlan;
  runId: string;
  onClose: () => void;
}

/** Every auto-safe finding turned into the actual change, per URL, ready to review and ship.
 *  It states plainly that nothing has been applied — a panel that reads as "done" when it is
 *  really "proposed" would be the single worst thing this screen could do. */
export function FullFixPlan({ plan, runId, onClose }: Props) {
  const download = () => {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fix-plan-${runId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!plan.totalChanges) {
    return (
      <div className="rounded-card border border-dashed border-border-strong bg-card px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Fix plan</h3>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="mt-2 text-xs text-secondary">
          Nothing on this site is classified <strong className="font-semibold text-foreground">auto-safe</strong>, so there is no
          plan to generate. Every finding here needs either a review or a judgment call.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Fix plan{" "}
          <span className="font-normal text-faint">
            {plan.totalChanges} change{plan.totalChanges === 1 ? "" : "s"} across {plan.rules.length} rule
            {plan.rules.length === 1 ? "" : "s"}
          </span>
        </h3>
        <span className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={download}>
            Download JSON
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </span>
      </div>
      <p className="mt-2 text-xs text-secondary">
        <Badge tone="warn" className="mr-1.5">
          not applied
        </Badge>
        {plan.note}
      </p>
      <div className="mt-3 space-y-2">
        {plan.items.map((it, i) => (
          <div key={`${it.rule}-${it.url}-${i}`} className="rounded-control border border-border bg-subtle px-3 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="rounded-pill bg-elevated px-1.5 py-0.5 font-medium text-foreground">{it.action}</span>
              <strong className="font-medium text-foreground">{it.issue}</strong>
              {it.where && <span className="text-[11px] text-faint">{it.where}</span>}
            </div>
            {it.url && <p className="mt-1 truncate text-faint">{it.url}</p>}
            <code className="mt-1 block whitespace-pre-wrap rounded-control bg-card px-2 py-1.5 text-[11px] leading-relaxed text-secondary">
              {Array.isArray(it.change) ? it.change.join("\n") : it.change}
            </code>
            {it.note && <p className="mt-1 text-[11px] text-faint">{it.note}</p>}
          </div>
        ))}
      </div>
      {plan.totalChanges > plan.items.length && (
        <p className="mt-2 text-[11px] text-faint">
          Showing the first {plan.items.length}. Download the JSON for all {plan.totalChanges}.
        </p>
      )}
    </div>
  );
}

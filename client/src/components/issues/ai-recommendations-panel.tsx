import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { AiRecommendNowButton } from "@/components/ai-recommend-now-button";
import { AiRecommendationCard } from "./ai-recommendation-card";
import type { AiRecommendation } from "@/lib/ai-recommend/types";

interface Props {
  open: boolean;
  onClose: () => void;
  ruleId: string | null;
  items: AiRecommendation[];
  /** True once ai-recommendations.json exists for this run at all — distinct from "generated,
   *  but zero items matched this rule" (items.length === 0 while available is true). */
  available: boolean;
  runId: string;
}

/** Sibling of FixPlanPanel (same SlideOver + card-list pattern) for AI-generated content
 *  recommendations — titles, meta descriptions, headings, alt text, social tags, duplicate
 *  content, structured data, canonical conflicts, internal-link anchors. Nothing is applied
 *  without a human: a card only offers Fix & Apply when its category maps onto a writable
 *  connector field, and the write happens only on an explicit click. */
export function AiRecommendationsPanel({ open, onClose, ruleId, items, available, runId }: Props) {
  function downloadJson() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-recommendations-${runId}-${ruleId ?? "all"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <SlideOver open={open} onClose={onClose} title={ruleId ? `AI Suggestions · ${ruleId}` : "AI Suggestions"} widthClassName="w-[560px]">
      {!available || items.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-faint">
            {!available
              ? "AI suggestions haven't been generated for this run yet."
              : "No AI suggestion has been generated for this rule yet — it may not have been reached in the last generation batch, or this rule isn't in the supported set yet."}
          </p>
          {ruleId && <AiRecommendNowButton runId={runId} ruleId={ruleId} label="Generate AI suggestions for this rule" />}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-faint">
              AI-generated, page-specific fix content. Always reviewed by a human — <strong className="text-foreground">nothing is written to your site until you click Fix &amp; Apply</strong>.
            </p>
            <Button size="sm" variant="outline" onClick={downloadJson}>
              Download JSON ({items.length})
            </Button>
          </div>
          {ruleId && <AiRecommendNowButton runId={runId} ruleId={ruleId} label="Regenerate" variant="outline" />}
          <div className="space-y-3">
            {items.map((r, i) => (
              <AiRecommendationCard key={`${r.pageId ?? "site"}-${r.instanceKey ?? i}`} recommendation={r} />
            ))}
          </div>
        </div>
      )}
    </SlideOver>
  );
}

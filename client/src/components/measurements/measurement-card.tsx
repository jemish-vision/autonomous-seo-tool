import { useState } from "react";
import { CircleSlash2, Info, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { MeasurementCardVM } from "@/lib/measurements-view";

interface Props {
  card: MeasurementCardVM;
  onViewPages?: (id: string, label: string) => void;
}

export function MeasurementCard({ card, onViewPages }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const partial = card.available && card.sampleSize !== null && card.totalPages !== null && card.sampleSize < card.totalPages;
  const explainerText = card.available ? card.explainer : card.unavailableReason ?? card.explainer;

  return (
    <Card
      hoverLift={card.available}
      className={cn(
        "relative flex flex-col justify-between p-3.5 rounded-xl border transition-all duration-150",
        showTooltip ? "z-40" : "z-0 hover:z-30",
        card.available
          ? "border-border bg-card hover:border-border-strong"
          : "border-dashed border-border-strong/70 bg-subtle/50 shadow-none",
      )}
    >
      {/* Top Header: Label & Tooltip Info Icon */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <p className="truncate text-xs font-semibold text-secondary" title={card.label}>
          {card.label}
        </p>

        <div className="relative shrink-0 flex items-center">
          <button
            type="button"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onFocus={() => setShowTooltip(true)}
            onBlur={() => setShowTooltip(false)}
            onClick={() => setShowTooltip((s) => !s)}
            className="text-faint hover:text-foreground transition-colors p-0.5 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label={`Description for ${card.label}`}
          >
            {!card.available ? (
              <CircleSlash2 size={13} strokeWidth={2} className="text-warn" aria-hidden="true" />
            ) : (
              <Info size={13} strokeWidth={2} aria-hidden="true" />
            )}
          </button>

          {/* Hover Tooltip Popup */}
          {showTooltip && (
            <div
              role="tooltip"
              className="absolute right-0 top-6 z-[100] w-64 rounded-xl border border-border-strong bg-elevated p-3 text-xs text-foreground shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 pointer-events-none"
            >
              <p className="font-semibold text-foreground mb-1">{card.label}</p>
              <p className="text-secondary leading-relaxed">{explainerText}</p>
              {partial && (
                <p className="mt-2 text-[11px] text-faint border-t border-border/50 pt-1.5">
                  Sample: {card.sampleSize!.toLocaleString()} of {card.totalPages!.toLocaleString()} pages analyzed.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Metric Value */}
      <div className="my-1.5">
        {card.available ? (
          <div className="text-xl font-bold tracking-tight tabular-nums text-foreground">
            {card.display ?? card.value ?? "—"}
          </div>
        ) : (
          <div className="text-xs font-medium text-faint">Not available</div>
        )}
      </div>

      {/* Footer / Action */}
      <div className="min-h-[20px] flex items-center justify-between text-[11px]">
        {card.available && onViewPages ? (
          <button
            type="button"
            onClick={() => onViewPages(card.id, card.label)}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-primary rounded"
          >
            <span>Matching pages</span>
            <ArrowUpRight size={11} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : partial ? (
          <span className="text-[11px] text-faint truncate">
            {card.sampleSize} / {card.totalPages} pages
          </span>
        ) : (
          <span />
        )}
      </div>
    </Card>
  );
}

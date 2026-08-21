import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CategoryScore } from "@/lib/types";

const DEFAULT_CATEGORIES: CategoryScore[] = [
  { name: "Indexability", categoryKey: "indexability", weight: 30, score: 100 },
  { name: "Content", categoryKey: "content", weight: 25, score: 100 },
  { name: "Links", categoryKey: "links", weight: 15, score: 100 },
  { name: "Media & Markup", categoryKey: "media", weight: 15, score: 100 },
  { name: "Performance & Security", categoryKey: "performance", weight: 15, score: 100 },
];

function scoreTone(score: number): "ok" | "warn" | "danger" {
  if (score >= 80) return "ok";
  if (score >= 60) return "warn";
  return "danger";
}

function progressBgClass(score: number): string {
  if (score >= 80) return "bg-data-green";
  if (score >= 60) return "bg-warn";
  return "bg-danger";
}

export function CategoryBreakdown({ categories }: { categories?: CategoryScore[] }) {
  const items = categories && categories.length > 0 ? categories : DEFAULT_CATEGORIES;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary">
          Category Health Breakdown
        </h3>
        <span className="text-xs text-faint">Weighted Scoring</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((cat) => {
          const tone = scoreTone(cat.score);
          const barColor = progressBgClass(cat.score);

          return (
            <div key={cat.categoryKey || cat.name} className="space-y-1.5 rounded-control bg-subtle/50 p-2.5 border border-border/50">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground truncate max-w-[120px]" title={cat.name}>
                  {cat.name}
                </span>
                <Badge tone={tone}>{cat.score}/100</Badge>
              </div>

              {/* Progress Bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                <div
                  className={`h-full transition-all duration-300 ${barColor}`}
                  style={{ width: `${Math.max(0, Math.min(100, cat.score))}%` }}
                />
              </div>

              <div className="flex justify-between text-[10px] text-faint">
                <span>Weight: {cat.weight}%</span>
                <span>{cat.score >= 80 ? "Healthy" : cat.score >= 60 ? "Attention" : "Critical"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

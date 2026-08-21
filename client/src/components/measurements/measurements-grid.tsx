import { useMemo, useState } from "react";
import { MeasurementCard } from "./measurement-card";
import { MatchingPagesPanel } from "./matching-pages-panel";
import { categorySort, type MeasurementsViewModel } from "@/lib/measurements-view";

interface Props {
  runId: string;
  data: MeasurementsViewModel;
  drilldownSupportedIds: string[];
}

export function MeasurementsGrid({ runId, data, drilldownSupportedIds }: Props) {
  const [panel, setPanel] = useState<{ id: string; label: string } | null>(null);

  // Drill-down works on either measurements shape: overview.tsx already narrows the incoming ids to
  // the cards actually present + available this run (v2 or legacy), and each id resolves to the same
  // matching-page set the card counts (server DRILLDOWN_MATCHERS). Gating on `shape === "v2"` here
  // would wrongly disable the legacy-shape drill-downs the endpoint returns today.
  const supported = useMemo(() => new Set(drilldownSupportedIds), [drilldownSupportedIds]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, typeof data.cards>();
    for (const card of data.cards) {
      const list = byCategory.get(card.category) ?? [];
      list.push(card);
      byCategory.set(card.category, list);
    }
    return [...byCategory.entries()].sort((a, b) => categorySort(a[0], b[0]));
  }, [data]);

  return (
    <div className="space-y-6">
      {grouped.map(([category, cards]) => (
        <section key={category} className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary">{category}</h3>
            <span className="text-xs text-faint">{cards.length} metrics</span>
          </div>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 sm:gap-3">
            {cards.map((card) => (
              <MeasurementCard
                key={card.id}
                card={card}
                onViewPages={supported.has(card.id) ? (id, label) => setPanel({ id, label }) : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      <MatchingPagesPanel
        runId={runId}
        open={panel !== null}
        measurementId={panel?.id ?? null}
        measurementLabel={panel?.label ?? null}
        onClose={() => setPanel(null)}
      />
    </div>
  );
}

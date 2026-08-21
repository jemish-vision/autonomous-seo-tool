import { Card } from "@/components/ui/card";

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[11px] font-semibold uppercase tracking-wide text-faint">{children}</h2>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-faint">{children}</p>;
}

/** Matches MediaPanel's convention exactly: `field === undefined` means the crawler build that
 *  produced this run predates this extraction — distinct from "captured, found nothing". */
export function NotCaptured({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-faint">{children}</p>;
}

export function SectionCard({ id, title, count, children }: { id: string; title: string; count?: string; children: React.ReactNode }) {
  return (
    <Card id={id}>
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>{title}</SectionTitle>
        {count !== undefined && <span className="text-xs tabular-nums text-faint">{count}</span>}
      </div>
      {children}
    </Card>
  );
}

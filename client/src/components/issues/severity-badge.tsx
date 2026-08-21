import { Badge } from "@/components/ui/badge";
// Client-safe severityTone (lib/issues-view-helpers.ts), not lib/data-issues.ts's — that file
// imports node:fs/promises, and this badge is now reachable from a "use client" tree (issues-client.tsx).
import { severityTone } from "@/lib/issues-view-helpers";
import type { IssueSeverity } from "@/lib/types";

const LABEL: Record<IssueSeverity, string> = { error: "Error", warning: "Warning", notice: "Notice" };

export function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  return <Badge tone={severityTone(severity)}>{LABEL[severity]}</Badge>;
}

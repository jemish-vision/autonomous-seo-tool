/** This tool generates plans. It never applies them — no apply path, no write-back, no API
 * call to a customer's CMS. `applied` is always the literal `false`, stated explicitly so a
 * plan that looks applied but isn't can never be mistaken for one that is. */

export interface FixPlanItem {
  rule: string;
  /** The issue's own message, for context without re-joining against issues.json. */
  issue: string;
  url: string | null;
  pageId: string | null;
  action: string;
  where: string;
  /** A single instruction, or one line per affected element (mixed-content, img dimensions). */
  change: string | string[];
  note: string;
}

export interface FixPlanSkip {
  rule: string;
  url: string | null;
  reason: string;
}

export interface FixPlan {
  runId: string;
  generatedAt: string;
  applied: false;
  note: string;
  rules: { id: string; findings: number }[];
  totalChanges: number;
  items: FixPlanItem[];
  /** Auto-safe findings this run had that could NOT be turned into a concrete change (e.g. an
   * image the crawl's size-probe never measured) — never silently dropped. */
  skipped: FixPlanSkip[];
}

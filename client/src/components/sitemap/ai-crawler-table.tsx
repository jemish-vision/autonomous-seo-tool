import { Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TableContainer, TableHead, Th, Tr, Td } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { VerdictBadge, verdictLabel } from "./verdict-badge";
import type { AiAccessRow } from "@/lib/data-sitefiles";

/** Plain-language "who operates it" copy — our own reference text, not sourced from the crawler.
 *  Every one of the 13 agents src/events... err data-sitefiles.ts's AI_CRAWLER_AGENTS must appear
 *  here so a new/renamed agent can never silently fall back to a blank operator cell. */
const OPERATOR: Record<string, string> = {
  GPTBot: "OpenAI — trains OpenAI's models on site content.",
  "OAI-SearchBot": "OpenAI — powers ChatGPT's live web-search citations.",
  "ChatGPT-User": "OpenAI — fetches a page live when a ChatGPT user asks it to browse or open a link.",
  ClaudeBot: "Anthropic — crawls to train Claude models.",
  "anthropic-ai": "Anthropic — an older/alternate Anthropic crawler identity.",
  PerplexityBot: "Perplexity — powers Perplexity's AI search answers.",
  CCBot: "Common Crawl — a public web archive many AI labs train on.",
  Bytespider: "ByteDance (TikTok) — crawls for ByteDance's AI/search products.",
  "cohere-ai": "Cohere — trains Cohere's language models.",
  "Google-Extended": "Google — opts a site in/out of Gemini & Vertex AI training, separate from normal Search indexing.",
  "Google-CloudVertexBot": "Google — fetches pages on behalf of Vertex AI Search customers.",
  "Google-Agent": "Google — an AI agent acting on a user's behalf inside a Google product.",
  "Google-NotebookLM": "Google — fetches a page when a user adds it as a NotebookLM source.",
};

export interface AiCrawlerTableProps {
  rows: AiAccessRow[];
  sourceLines: Map<string, number | null>; // agent -> robots.txt line number
  robotsAvailable: boolean;
}

export function AiCrawlerHeadline({ rows }: { rows: AiAccessRow[] }) {
  const counts = { allowed: 0, "partly-blocked": 0, blocked: 0, "ignores-robots": 0, unknown: 0 } as Record<string, number>;
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Bot size={16} strokeWidth={1.75} aria-hidden="true" />
        {rows.length} AI crawlers checked
      </div>
      {/* All four brief-mandated buckets always shown, even at 0 — collapsing to a single
          "blocked: N" figure is the exact dishonesty this screen exists to correct (a seeded site
          can read "blocked: 0" while hiding 10 partly-blocked agents unless every bucket is visible). */}
      <p className="text-sm text-secondary">
        <span className="font-medium text-ok">{counts.allowed} allowed</span>
        {" · "}
        <span className="font-medium text-danger">{counts.blocked} blocked</span>
        {" · "}
        <span className="font-medium text-warn">{counts["partly-blocked"]} partly blocked</span>
        {" · "}
        <span className="font-medium text-data-violet">{counts["ignores-robots"]} ignores robots.txt</span>
        {counts.unknown > 0 && (
          <>
            {" · "}
            <span className="font-medium text-faint">{counts.unknown} unknown (robots.txt unavailable)</span>
          </>
        )}
      </p>
      <p className="text-xs text-faint">
        &quot;Ignores robots.txt&quot; needs observed bot behavior, not robots.txt text — this simplified parser never populates it from parsing alone (see note below the table).
      </p>
    </Card>
  );
}

export function AiCrawlerTable({ rows, sourceLines, robotsAvailable }: AiCrawlerTableProps) {
  if (!robotsAvailable) {
    return <EmptyState icon={Bot} title="No robots.txt for this run" description="The AI-crawler access table needs robots.txt to evaluate — this run has none recorded." />;
  }

  return (
    <TableContainer>
      <TableHead>
        <Th>Agent</Th>
        <Th>Operator</Th>
        <Th>Verdict</Th>
        <Th>Matched rule</Th>
        <Th>Source line</Th>
      </TableHead>
      <tbody>
        {rows.map((r) => {
          const rule = r.verdict === "blocked" ? r.disallowRules[0] : r.verdict === "partly-blocked" ? r.disallowRules[0] : r.allowRules[0] ?? null;
          const line = sourceLines.get(r.agent) ?? null;
          return (
            <Tr key={r.agent}>
              <Td className="font-medium normal-case">{r.agent}</Td>
              <Td className="max-w-xs normal-case text-secondary">{OPERATOR[r.agent] ?? "Operator unknown — not in our reference list."}</Td>
              <Td>
                <VerdictBadge verdict={r.verdict} />
              </Td>
              <Td className="normal-case text-secondary">
                {r.matchedGroup === "(no matching group)" ? (
                  <span className="text-faint">no matching group</span>
                ) : (
                  <>
                    <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">User-agent: {r.matchedGroup}</code>
                    {rule && (
                      <>
                        {" "}
                        <code className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px]">
                          {r.verdict === "allowed" && r.allowRules[0] ? "Allow" : "Disallow"}: {rule}
                        </code>
                      </>
                    )}
                  </>
                )}
              </Td>
              <Td>{line !== null ? <span className="tabular-nums text-secondary">line {line}</span> : <span className="text-faint">—</span>}</Td>
            </Tr>
          );
        })}
      </tbody>
    </TableContainer>
  );
}

export { verdictLabel };

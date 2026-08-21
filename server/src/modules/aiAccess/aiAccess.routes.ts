/**
 * AI-crawler access table — the 13-agent verdict grid (GPTBot, ClaudeBot, PerplexityBot, ...) the
 * old app computed live from robots.txt (lib/data-sitefiles.ts buildAiAccessTable). Here it is read
 * from the AiCrawlerVerdict table when the sync populated it; the client hook (@/api/sitemap)
 * expects { rows: AiAccessRow[], parseStatus }.
 *
 *   GET /api/crawls/:runId/site-files/ai-access  ->  { rows: AiAccessRow[], parseStatus, note }
 *
 * When no verdict rows exist (unknown run, or a run whose robots wasn't captured / sync didn't
 * write verdicts) an empty verdicts shape is returned (never 404/500): the 13 named agents each
 * with an "unknown" verdict, so the table still renders every bucket.
 */
import { Router } from "express";
import { asyncHandler } from "../../middleware/error.js";
import { prisma } from "../../db/prisma.js";
import { isSafeId } from "../../lib/apiShared.js";

export const aiAccessRouter = Router();

type AiAccessVerdict = "allowed" | "partly-blocked" | "blocked" | "ignores-robots" | "unknown";

interface AiAccessRow {
  agent: string;
  verdict: AiAccessVerdict;
  matchedGroup: string;
  disallowRules: string[];
  allowRules: string[];
}

/** The 13 named AI crawlers, in the display order the DB assigns via displayOrder. Kept as a local
 *  const so the empty-state row list always surfaces all four buckets (mirrors lib/data-sitefiles). */
const AI_CRAWLER_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "CCBot",
  "Bytespider",
  "cohere-ai",
  "Google-Extended",
  "Google-CloudVertexBot",
  "Google-Agent",
  "Google-NotebookLM",
] as const;

function verdictToLower(access: string): AiAccessVerdict {
  if (access === "ALLOWED") return "allowed";
  if (access === "BLOCKED") return "blocked";
  if (access === "PARTLY_BLOCKED") return "partly-blocked";
  if (access === "IGNORES_ROBOTS") return "ignores-robots";
  return "unknown";
}

function emptyRows(): AiAccessRow[] {
  return AI_CRAWLER_AGENTS.map((agent) => ({
    agent,
    verdict: "unknown",
    matchedGroup: "(robots.txt unavailable)",
    disallowRules: [],
    allowRules: [],
  }));
}

aiAccessRouter.get(
  "/:runId/site-files/ai-access",
  asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!isSafeId(runId)) {
      res.status(422).json({ error: "Invalid runId" });
      return;
    }

    const crawl = await prisma.crawl.findFirst({ where: { slug: runId, deletedAt: null }, select: { id: true } });
    const verdicts = crawl
      ? await prisma.aiCrawlerVerdict.findMany({ where: { crawlId: crawl.id }, orderBy: { displayOrder: "asc" } })
      : [];

    if (verdicts.length === 0) {
      res.json({
        rows: emptyRows(),
        parseStatus: "unavailable",
        note: "No AI-crawler verdicts are persisted for this run (robots.txt not captured, or the sync did not write verdicts).",
      });
      return;
    }

    const rows: AiAccessRow[] = verdicts.map((v) => ({
      agent: v.agent,
      verdict: verdictToLower(v.access),
      matchedGroup: v.matchedGroup ?? "(no matching group)",
      disallowRules: v.disallowed,
      allowRules: [],
    }));

    res.json({
      rows,
      parseStatus: "ok",
      note: "Verdicts read from the AiCrawlerVerdict table. 'allowRules' is not persisted separately; the 'ignores-robots' bucket requires observed bot behavior.",
    });
  }),
);

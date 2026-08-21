/**
 * Client type shim for the old server-only `lib/data-sitefiles.ts`. The robots parsing + AI-crawler
 * access table are computed server-side and returned by the API. Keeps ONLY the shared TYPES
 * (plus the static agent list, which is constant data safe on the client).
 *
 * TODO(api): use @/api/sitemap (GET /api/crawls/:id/site-files/ai-access) for the AiAccessRow[] payload.
 */
export const AI_CRAWLER_AGENTS = [
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

export type AiAccessVerdict = "allowed" | "partly-blocked" | "blocked" | "ignores-robots" | "unknown";

export interface AiAccessRow {
  agent: string;
  verdict: AiAccessVerdict;
  matchedGroup: string;
  disallowRules: string[];
  allowRules: string[];
}

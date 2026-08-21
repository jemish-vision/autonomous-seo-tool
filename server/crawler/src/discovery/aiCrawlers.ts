/**
 * The 13 named AI-crawler agents worth reporting, and a reporting-only robots.txt group parser
 * that exists purely to explain *why* each one gets its verdict.
 *
 * `robots-parser` (the RFC 9309 enforcement dependency used in robots.ts) decides what this
 * crawler itself may fetch, and stays the enforcement path — nothing here replaces it. But its
 * public API has no way to say which User-agent group matched a query or cite a source line,
 * which is exactly the evidence this table needs, so a small dedicated parser lives here instead.
 *
 * This parser is intentionally simpler than full RFC 9309 precedence (no longest-match specificity
 * between an Allow and a Disallow) — good enough to cite the group and line that produced a
 * verdict, not a second enforcement engine.
 */
import type { AiCrawlerAccess, AiCrawlerRule, AiCrawlerSourceRule } from "../models/types";

/** One `User-agent:` block: the agent tokens it names (with their source lines) and its rules. */
interface RobotsGroup {
  agents: string[];
  agentLines: number[];
  rules: AiCrawlerSourceRule[];
}

/**
 * Parse robots.txt into User-agent groups, tracking the 1-based source line of every directive.
 *
 * Consecutive `User-agent` lines share one set of rules, which is why agents are collected until
 * the first rule line rather than one group per line. Anything after a `#` is a comment.
 */
export function parseRobotsGroupsForReporting(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let readingAgents = false;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]!.split("#")[0]!.trim();
    if (!line) continue;
    const at = line.indexOf(":");
    if (at === -1) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();

    if (field === "user-agent") {
      if (!current || !readingAgents) {
        current = { agents: [], agentLines: [], rules: [] };
        groups.push(current);
        readingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      current.agentLines.push(lineNo);
      continue;
    }
    if (!current) continue;
    readingAgents = false;
    if (field === "disallow") current.rules.push({ directive: "Disallow", value, line: lineNo });
    else if (field === "allow") current.rules.push({ directive: "Allow", value, line: lineNo });
  }
  return groups;
}

/**
 * The AI agents worth naming, and whether robots.txt can actually stop them. A user-triggered
 * fetcher acts for a person who asked for that page, so it does not consult robots.txt at all —
 * calling one "blocked" would be wrong, and "allowed" would imply a permission nobody asked for.
 */
const AI_CRAWLERS: ReadonlyArray<{ agent: string; who: string; obeys: boolean }> = [
  { agent: "GPTBot", who: "OpenAI — crawls web content to train and improve GPT models.", obeys: true },
  { agent: "OAI-SearchBot", who: "OpenAI — crawls pages to power ChatGPT's search results.", obeys: true },
  {
    agent: "ChatGPT-User",
    who: "OpenAI — fetches a page live when a user asks ChatGPT to browse or open a link.",
    obeys: false,
  },
  { agent: "ClaudeBot", who: "Anthropic — crawls the web for Claude's web search and browsing features.", obeys: true },
  { agent: "anthropic-ai", who: "Anthropic — crawls web content for training Claude models.", obeys: true },
  { agent: "PerplexityBot", who: "Perplexity — crawls the web to power Perplexity's AI answer engine.", obeys: true },
  {
    agent: "CCBot",
    who: "Common Crawl — crawls the web to build the free, open Common Crawl dataset many AI labs train on.",
    obeys: true,
  },
  { agent: "Bytespider", who: "ByteDance — crawls web content for TikTok's AI and recommendation systems.", obeys: true },
  { agent: "cohere-ai", who: "Cohere — crawls web content for training and grounding its language models.", obeys: true },
  {
    agent: "Google-Extended",
    who: "Google — a separate opt-out for Gemini model training and grounding, independent of Search indexing.",
    obeys: true,
  },
  {
    agent: "Google-CloudVertexBot",
    who: "Google — crawls on behalf of customers building agents on Vertex AI Agent Builder.",
    obeys: true,
  },
  {
    agent: "Google-Agent",
    who: "Google — fetches pages on behalf of a person using an agentic Google AI browsing feature.",
    obeys: false,
  },
  {
    agent: "Google-NotebookLM",
    who: "Google — fetches a specific URL a user added as a source in NotebookLM.",
    obeys: false,
  },
];

interface AccessVerdict {
  access: AiCrawlerAccess;
  matchedGroup: string;
  matchedGroupLine: number | null;
  matchedRules: AiCrawlerSourceRule[];
}

/**
 * What robots.txt says about one agent. A named group wins over `*` outright — the most specific
 * match applies and the wildcard group is never merged into it.
 */
function accessFor(groups: RobotsGroup[], agent: string): AccessVerdict {
  const wanted = agent.toLowerCase();
  const named = groups.find((g) => g.agents.includes(wanted));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  const group = named ?? wildcard;

  if (!group) return { access: "allowed", matchedGroup: "none", matchedGroupLine: null, matchedRules: [] };

  const matchedToken = named ? wanted : "*";
  const matchedGroup = named ? agent : "*";
  const tokenIndex = group.agents.indexOf(matchedToken);
  const matchedGroupLine = tokenIndex >= 0 ? (group.agentLines[tokenIndex] ?? null) : null;

  const disallowRules = group.rules.filter((r) => r.directive === "Disallow");
  const allowRules = group.rules.filter((r) => r.directive === "Allow");
  // `Disallow:` with nothing after it means "nothing is disallowed" — the conventional way to say
  // allow-all — so an empty value never counts as a blocking rule.
  const meaningfulDisallow = disallowRules.filter((r) => r.value !== "");
  const blocksRoot = meaningfulDisallow.some((r) => r.value === "/" || r.value === "/*");

  if (blocksRoot && allowRules.length === 0) {
    return { access: "blocked", matchedGroup, matchedGroupLine, matchedRules: meaningfulDisallow };
  }
  if (meaningfulDisallow.length > 0) {
    return { access: "partly blocked", matchedGroup, matchedGroupLine, matchedRules: meaningfulDisallow };
  }
  // Allowed — still cite an empty `Disallow:` line when the group has one, so the verdict stays
  // checkable against the source rather than looking like the group was never matched at all.
  return { access: "allowed", matchedGroup, matchedGroupLine, matchedRules: disallowRules };
}

/**
 * Build the 13-agent access table from robots.txt's raw text. `null`/empty text (robots.txt
 * absent, empty, or unfetchable) means allow-all for every obeying agent — the same convention
 * `fetchRobots`'s own isAllowed() already uses.
 */
export function buildAiCrawlerTable(robotsText: string | null): AiCrawlerRule[] {
  const groups = robotsText ? parseRobotsGroupsForReporting(robotsText) : [];
  return AI_CRAWLERS.map(({ agent, who, obeys }) => {
    const verdict = accessFor(groups, agent);
    return {
      agent,
      who,
      access: obeys ? verdict.access : "ignores robots.txt",
      matchedGroup: verdict.matchedGroup,
      matchedGroupLine: verdict.matchedGroupLine,
      matchedRules: verdict.matchedRules,
    };
  });
}

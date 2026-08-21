/**
 * Client+server-safe (pure string parsing). Finds the 1-indexed source line in raw robots.txt
 * content that produced a given AI-crawler verdict, for the "matched rule with its source line
 * number" requirement. lib/data-sitefiles.ts's AiAccessRow has no line-number field — this
 * re-scans the same raw content independently (verdict logic is NOT duplicated here, only line
 * lookup for an already-computed verdict) rather than editing that shared lib file while a sibling
 * agent may be mid-edit on the same API surface.
 */

interface ParsedLine {
  lineNumber: number; // 1-indexed
  field: "user-agent" | "allow" | "disallow" | null;
  value: string;
}

function parseLines(content: string): ParsedLine[] {
  const raw = content.split(/\r?\n/);
  return raw.map((line, i) => {
    const stripped = line.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(stripped);
    if (!m) return { lineNumber: i + 1, field: null, value: "" };
    const field = m[1].toLowerCase();
    if (field === "user-agent" || field === "allow" || field === "disallow") {
      return { lineNumber: i + 1, field, value: m[2].trim() };
    }
    return { lineNumber: i + 1, field: null, value: "" };
  });
}

/** Finds the line declaring `User-agent: <token>` for one of the group's agent tokens, then the
 *  first matching allow/disallow line after it (before the next user-agent line). Returns null
 *  when the content doesn't parse into a locatable line — an honest "—" beats a wrong guess. */
export function findRuleSourceLine(content: string, matchedGroup: string, rulePath: string | null, ruleType: "allow" | "disallow" | null): number | null {
  const lines = parseLines(content);
  const tokens = matchedGroup.split(",").map((t) => t.trim().toLowerCase());

  let uaLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.field === "user-agent" && tokens.includes(l.value.toLowerCase())) {
      uaLineIndex = i;
      break;
    }
  }
  if (uaLineIndex === -1) return null;
  if (!rulePath || !ruleType) return lines[uaLineIndex].lineNumber;

  for (let i = uaLineIndex + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.field === "user-agent") break; // next group starts — stop searching this one
    if (l.field === ruleType && l.value === rulePath) return l.lineNumber;
  }
  return lines[uaLineIndex].lineNumber;
}

export function findGroupHeaderLine(content: string, matchedGroup: string): number | null {
  const lines = parseLines(content);
  const tokens = matchedGroup.split(",").map((t) => t.trim().toLowerCase());
  const hit = lines.find((l) => l.field === "user-agent" && tokens.includes(l.value.toLowerCase()));
  return hit?.lineNumber ?? null;
}

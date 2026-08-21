/**
 * Pure parsing helpers for the WordPress CLI — kept out of cli.ts so the CLI
 * module stays a pure executable (it runs main() at import time) and these
 * stay unit-testable.
 */

/** Parse "field=value" assignments; values starting with { or [ are JSON. */
export function parseAssignments(args: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const arg of args) {
    const idx = arg.indexOf("=");
    if (idx <= 0) {
      throw new Error(`expected field=value, got "${arg}"`);
    }
    const field = arg.slice(0, idx).trim();
    const raw = arg.slice(idx + 1);
    if (field === "") {
      throw new Error(`expected a non-empty field name, got "${arg}"`);
    }
    const first = raw.trimStart()[0];
    if (first === "{" || first === "[") {
      try {
        out[field] = JSON.parse(raw) as unknown;
      } catch {
        throw new Error(`field "${field}" looks like JSON but does not parse: ${raw}`);
      }
    } else {
      out[field] = raw;
    }
  }
  return out;
}
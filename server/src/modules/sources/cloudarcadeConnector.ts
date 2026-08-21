/**
 * CloudArcade direct-MySQL connector — the "ATM Games" source kind.
 *
 * CloudArcade (the HTML5 games CMS behind atmhtml5games.com) has no REST plugin like the WordPress
 * connector, so Fix & Apply writes SEO fields STRAIGHT into its MySQL database. Everything here is
 * pure and self-contained: given the DB credentials stored on the source and a crawled page URL, it
 *   1. resolves the URL to a concrete row (by slug, across games / posts / pages / categories),
 *   2. maps the platform-neutral `changes` (title / description / h1 / og_*) onto CloudArcade's
 *      storage (dedicated columns + the `extra_fields` JSON blob), and
 *   3. applies the UPDATE, returning a reversible receipt (before/after per field).
 *
 * Verified against a real atmh_atmnewmain dump:
 *   games      : extra_fields JSON { meta_title, meta_desc }, display title = games.title
 *   posts      : extra_fields JSON { meta_title, meta_desc }, display title = posts.title
 *   pages      : title column; meta desc → extra_fields.meta_desc
 *   categories : meta_description column; meta title → extra_fields.meta_title
 *
 * The connection is opened per request and closed in a finally — no long-lived pool, so a source
 * with bad credentials can never wedge the server.
 */
import mysql from "mysql2/promise";

export interface CloudArcadeCredentials {
  dbHost: string;
  dbPort: string | number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

/** The four content tables Fix & Apply can target, and how their URL prefix identifies them. */
type TargetTable = "games" | "posts" | "pages" | "categories" | "custom_posts";

export interface ResolvedTarget {
  table: TargetTable;
  id: number;
  slug: string;
}

export interface FieldChange {
  before: unknown;
  after: unknown;
}

export interface CloudArcadeReceipt {
  resource: { type: TargetTable; id: number; slug: string };
  changes: Record<string, FieldChange>;
}

export interface CloudArcadeCapabilities {
  games: number;
  posts: number;
  pages: number;
  categories: number;
}

// ── Credentials ─────────────────────────────────────────────────────────────────────────────────

/** Pull DB credentials off the stored source.credentials, or null when they are not all present. */
export function readCloudArcadeCredentials(creds: Record<string, string>): CloudArcadeCredentials | null {
  const dbHost = creds.dbHost?.trim();
  const dbName = creds.dbName?.trim();
  const dbUser = creds.dbUser?.trim();
  if (!dbHost || !dbName || !dbUser) return null;
  return {
    dbHost,
    dbPort: creds.dbPort?.trim() || "3306",
    dbName,
    dbUser,
    // Password may legitimately be empty (local XAMPP root).
    dbPassword: creds.dbPassword ?? "",
  };
}

function connectionConfig(c: CloudArcadeCredentials): mysql.ConnectionOptions {
  return {
    host: c.dbHost,
    port: Number(c.dbPort) || 3306,
    database: c.dbName,
    user: c.dbUser,
    password: c.dbPassword,
    // Fail fast rather than hang the request when the DB is unreachable.
    connectTimeout: 8000,
    multipleStatements: false,
  };
}

// ── URL → row resolution ──────────────────────────────────────────────────────────────────────

/** First path segment → table hint. `/games/foo/` and `/game/foo` both mean the games table. */
const PREFIX_TABLE: Record<string, TargetTable> = {
  game: "games",
  games: "games",
  post: "posts",
  posts: "posts",
  page: "pages",
  pages: "pages",
  category: "categories",
  categories: "categories",
  t: "categories",
  custom_posts: "custom_posts",
};

/** Order to try when the URL prefix gives no hint (bare `/slug/`). Games first — the bulk of URLs. */
const FALLBACK_ORDER: TargetTable[] = ["games", "posts", "pages", "categories", "custom_posts"];

interface ParsedPath {
  slug: string;
  hinted: TargetTable | null;
}

/** Extract the slug (last non-empty segment) and any table hint from the first segment. */
export function parseUrlPath(rawUrl: string): ParsedPath | null {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    // Allow a bare path too.
    pathname = rawUrl;
  }
  const segments = pathname.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null; // homepage — nothing to target
  const slug = decodeURIComponent(segments[segments.length - 1]!);
  const first = segments[0]!.toLowerCase();
  const hinted = segments.length > 1 ? (PREFIX_TABLE[first] ?? null) : null;
  return { slug, hinted };
}

/** Find the row for a slug — honour the URL's table hint first, then fall back across all tables. */
async function resolveTarget(conn: mysql.Connection, parsed: ParsedPath): Promise<ResolvedTarget | null> {
  const tryOrder: TargetTable[] = parsed.hinted
    ? [parsed.hinted, ...FALLBACK_ORDER.filter((t) => t !== parsed.hinted)]
    : FALLBACK_ORDER;

  for (const table of tryOrder) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id FROM \`${table}\` WHERE slug = ? LIMIT 1`,
      [parsed.slug],
    );
    if (rows.length > 0) {
      return { table, id: Number(rows[0]!.id), slug: parsed.slug };
    }
  }
  return null;
}

// ── extra_fields JSON helpers ───────────────────────────────────────────────────────────────────

function parseExtraFields(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── Change mapping ──────────────────────────────────────────────────────────────────────────────

/**
 * How each platform-neutral change key lands per table. `col` writes a dedicated column; `ef` writes
 * a key inside the extra_fields JSON. Anything not listed for a table is written to extra_fields
 * under its own key (best-effort, e.g. og_title) so nothing is silently dropped.
 */
type Placement = { kind: "col"; column: string } | { kind: "ef"; key: string };

function placementFor(table: TargetTable, changeKey: string): Placement {
  const efMetaTitle: Placement = { kind: "ef", key: "meta_title" };
  const efMetaDesc: Placement = { kind: "ef", key: "meta_desc" };

  switch (changeKey) {
    case "title": // SEO/meta title
      if (table === "pages") return { kind: "col", column: "title" };
      return efMetaTitle;
    case "description": // meta description
      if (table === "categories") return { kind: "col", column: "meta_description" };
      return efMetaDesc;
    case "h1": // display heading → the row's own title column (games/posts/pages/custom_posts/categories all have one)
      return { kind: "col", column: table === "categories" ? "name" : "title" };
    default:
      // og_title, og_description, twitter_title, ... — keep them, in extra_fields under their key.
      return { kind: "ef", key: changeKey };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────────────────────────

/** Open a connection, verify it, and report table counts as capabilities. Throws on failure. */
export async function cloudArcadeConnect(creds: CloudArcadeCredentials): Promise<CloudArcadeCapabilities> {
  const conn = await mysql.createConnection(connectionConfig(creds));
  try {
    const counts: CloudArcadeCapabilities = { games: 0, posts: 0, pages: 0, categories: 0 };
    for (const table of ["games", "posts", "pages", "categories"] as const) {
      try {
        const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``);
        counts[table] = Number(rows[0]!.n) || 0;
      } catch {
        // A missing table (e.g. truncated import) is not fatal for a connection check — report 0.
        counts[table] = 0;
      }
    }
    return counts;
  } finally {
    await conn.end();
  }
}

/**
 * Apply a set of SEO changes to the CloudArcade row behind `url`. Returns a reversible receipt.
 * Throws with a clear message when the URL cannot be resolved or the changes are empty.
 */
export async function cloudArcadeApply(
  creds: CloudArcadeCredentials,
  url: string,
  changes: Record<string, string>,
): Promise<CloudArcadeReceipt> {
  const entries = Object.entries(changes).filter(([, v]) => typeof v === "string");
  if (entries.length === 0) throw new Error("No changes to apply.");

  const parsed = parseUrlPath(url);
  if (!parsed) throw new Error(`Cannot map "${url}" to a page — it looks like the site homepage.`);

  const conn = await mysql.createConnection(connectionConfig(creds));
  try {
    const target = await resolveTarget(conn, parsed);
    if (!target) {
      throw new Error(`No CloudArcade row found for slug "${parsed.slug}" (tried games, posts, pages, categories).`);
    }

    // Load the current row so we can record before-values and merge extra_fields.
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM \`${target.table}\` WHERE id = ? LIMIT 1`,
      [target.id],
    );
    if (rows.length === 0) throw new Error(`Row ${target.id} vanished from ${target.table}.`);
    const row = rows[0]!;

    const hasExtraFields = "extra_fields" in row;
    const extra = hasExtraFields ? parseExtraFields(row.extra_fields) : {};

    const receiptChanges: Record<string, FieldChange> = {};
    const columnUpdates: Record<string, string> = {};
    let extraTouched = false;

    for (const [key, value] of entries) {
      const placement = placementFor(target.table, key);
      if (placement.kind === "col") {
        // Only write a column that actually exists on this table.
        if (!(placement.column in row)) {
          // Fall back to extra_fields so the value is not lost.
          const before = extra[key];
          extra[key] = value;
          extraTouched = true;
          receiptChanges[`extra_fields.${key}`] = { before: before ?? null, after: value };
          continue;
        }
        receiptChanges[placement.column] = { before: row[placement.column] ?? null, after: value };
        columnUpdates[placement.column] = value;
      } else {
        if (!hasExtraFields) {
          // No extra_fields column on this table — skip rather than corrupt an unknown column.
          receiptChanges[placement.key] = { before: null, after: value };
          continue;
        }
        const before = extra[placement.key];
        extra[placement.key] = value;
        extraTouched = true;
        receiptChanges[`extra_fields.${placement.key}`] = { before: before ?? null, after: value };
      }
    }

    // Build the UPDATE. extra_fields is written as one merged JSON string.
    const setClauses: string[] = [];
    const params: (string | number)[] = [];
    for (const [column, value] of Object.entries(columnUpdates)) {
      setClauses.push(`\`${column}\` = ?`);
      params.push(value);
    }
    if (extraTouched) {
      setClauses.push("`extra_fields` = ?");
      params.push(JSON.stringify(extra));
    }

    if (setClauses.length === 0) {
      throw new Error("None of the requested changes map onto a writable field for this page type.");
    }

    params.push(target.id);
    await conn.query(`UPDATE \`${target.table}\` SET ${setClauses.join(", ")} WHERE id = ?`, params);

    return {
      resource: { type: target.table, id: target.id, slug: target.slug },
      changes: receiptChanges,
    };
  } finally {
    await conn.end();
  }
}

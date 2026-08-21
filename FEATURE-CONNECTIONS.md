# Feature: Multi-connection Sources + Active connection + ATM Games (CloudArcade direct-DB) Fix & Apply

## Goal
`/sources` supports MULTIPLE connections. One is marked **Active**. Fix & Apply ALWAYS uses the
Active connection (never URL-random). First supported connection kind for direct-DB writes:
**ATM Games** = CloudArcade CMS on local MySQL (`atmh_atmnewmain`), site `http://www.atmhtml5games.com/`.

## Decisions (locked)
- ATM Games apply path = **direct MySQL write** (no PHP plugin). Server connects to the CloudArcade DB.
- Fix & Apply uses the user's **Active** source (replaces URL-origin resolve on the card).
- New source kind: `"cloudarcade"`.

## CloudArcade DB mapping (verified against atmh_atmnewmain)
- Match crawled URL → row by **slug** (last non-empty path segment).
- Type by first path segment: `games`/`game`→`games`, `post`/`posts`→`posts`, `page`/`pages`→`pages`,
  `category`/`categories`/`t`→`categories`, `custom_posts`→`custom_posts`; else try games→posts→pages.
- SEO storage:
  - `games`  : `extra_fields` JSON keys `meta_title`, `meta_desc`. Display title = `games.title`.
  - `posts`  : `extra_fields` JSON keys `meta_title`, `meta_desc`. Display title = `posts.title`.
  - `pages`  : `title` column; meta desc → `extra_fields.meta_desc`.
  - `categories`: `meta_description` column; meta title → `extra_fields.meta_title`.
- SEO change → column mapping (from apply-plan `changes`):
  - `title`        → SEO/meta title  (games/posts/categories: extra_fields.meta_title ; pages: title col)
  - `description`  → meta description (games/posts: extra_fields.meta_desc ; categories: meta_description col ; pages: extra_fields.meta_desc)
  - `h1`           → display `title` column (games/posts/pages) — first-impl
  - `og_title`/`og_description`/`twitter_*` → stored into extra_fields keys as-is (best effort)
- All writes reversible: capture BEFORE value in receipt.

## API contract (server)
- Credentials for cloudarcade: `{ dbHost, dbPort, dbName, dbUser, dbPassword }`; `siteUrl` = site origin.
- `POST /api/sources` — accepts kind `cloudarcade`.
- `GET  /api/sources` — each SourceConfig gains `active: boolean`.
- `GET  /api/sources/active` → `{ active: SourceConfig | null }`.
- `POST /api/sources/:id/activate` → sets this source active, all others (this user) inactive.
  Returns `{ ok: true, sources: SourceConfig[] }`.
- `POST /api/sources/:id/connect` (cloudarcade) → open MySQL, `SELECT 1` + table counts →
  `{ ok, status:{state:"connected",...}, capabilities:{ games, posts, pages, categories } }`.
- `POST /api/sources/:id/seo` (cloudarcade) → body `{ url, changes, kind }`. Direct MySQL update.
  Returns `{ success:true, applied:true, resource:{type,id,slug}, changes:{field:{before,after}}, queued:false }`.

## Client behavior
- Add Connection modal gains an **ATM Games (CloudArcade)** platform with DB fields
  (host, port=3306, database, user, password).
- Sources table shows an **Active** control (radio) — selecting one calls `/activate`; only one active.
- Fix & Apply card: replace `POST /api/sources/resolve` with `GET /api/sources/active`.
  - no active → needs-connect state, message "No active connection — pick one on Sources".
  - active present → write via `POST /api/sources/{active.id}/seo` with `{ url, changes, kind }`.
  - cloudarcade returns synchronous receipt (queued:false) → success state immediately.

## File ownership (no overlap)
- SERVER (main Claude): `server/src/modules/sources/cloudarcadeConnector.ts` (new),
  `server/src/modules/sources/sources.routes.ts`, `server/scripts/sources-active-migration.sql` (new),
  `server/package.json` (+mysql2).
- CLIENT (agent): `client/src/lib/types-sources.ts`, `client/src/api/sources.ts`,
  `client/src/components/sources/add-source-form.tsx`, `client/src/components/sources/source-table.tsx`,
  `client/src/components/sources/sources-client.tsx`, `client/src/components/issues/ai-recommendation-card.tsx`.

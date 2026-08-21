# SEO Platform — Vite React + Express (Supabase-only)

A rebuild of the Next.js `seo-dashboard` as **two independent npm projects**, reading **only** from
Supabase (Postgres + Storage) — no filesystem data source.

```
seo-platform/
  server/   Express + Prisma + Supabase        API on http://localhost:4000
  client/   Vite + React 19 + Tailwind v4       UI  on http://localhost:5173
```

They are **not** a monorepo/workspace — two separate `package.json`, installed and run independently.

## Run it

Two terminals:

```bash
# terminal 1 — API
cd server
npm install
npm run prisma:generate      # generates the Prisma client into src/db/generated
npm run dev                  # http://localhost:4000  (GET /api/ready to check DB)

# terminal 2 — UI
cd client
npm install
npm run dev                  # http://localhost:5173  (Vite proxies /api -> :4000)
```

Sign in with a Supabase user (same Supabase project as the old app). The API's `/api/ready`
returns `{ ready: true, db: "up" }` when Postgres is reachable.

## Architecture

- **Auth.** Browser holds the Supabase session (`client/src/lib/supabase.ts`). Every API call
  attaches `Authorization: Bearer <jwt>` (`client/src/lib/api.ts`). The API verifies the token
  server-side (`server/src/middleware/auth.ts`) — the Express equivalent of the old `proxy.ts`
  default-deny gate. Public routes: `/api/health`, `/api/ready`, `/api/version`, GSC callback.
- **Data.** The API reuses the crawler platform's Prisma query layer, **vendored** into
  `server/src/db/` (copied from `packages/db`). Modules under `server/src/modules/**` wrap those
  query functions as REST endpoints. No `node:fs` reads.
- **UI.** React Query hooks (`client/src/api/**`) fetch from the API. Route components
  (`client/src/routes/**`) mirror the old `app/**/page.tsx`. All visual components were copied
  verbatim from the old app (`client/src/components/**`) and mechanically ported from Next.js
  primitives to react-router — **the design is unchanged**.
- **Design.** `client/src/globals.css` is the old app's CSS verbatim (Tailwind v4 `@theme inline`
  tokens), so every color, radius, and utility is identical.

See `MIGRATION-BRIEF.md` for the exact conventions and port rules.

## Parity gaps (Supabase-only, known)

The crawler→Supabase sync currently writes a **lossy projection** of the on-disk crawl JSON. Until
that sync is extended, these surfaces render "Not captured" / empty on a Supabase-only read (they
degrade gracefully — no crash):

- **Page detail:** `headMeta` (OG/Twitter + SERP preview), `favicons`, `structure` (document
  outline), `fonts`, `charset`, `headBoundary`, `baseHref`; video poster/mime/provider;
  `structuredData.parseError`.
- **Blobs:** screenshots + raw-HTML replay (need Supabase Storage upload confirmed for every run).
- **Issues:** AI recommendations, automation report, fix plan (JSON-only surfaces with no DB read
  path yet); finding `priority/confidence/effort/why` default when a run was imported via the
  reductive path; `issue.threshold`, site `scope` badge, `categories`, `grade`.

Closing these = extend `packages/db` mapping (`mapLegacyPage`) + `readStore` + `importIssues` to
persist/reconstruct the rich fields (the Prisma schema already reserves JSONB columns:
`Page.headDetail/metaDetail/contentDetail/assetsDetail`). Tracked as a follow-on task.

## Security note

The old dashboard shipped a **service-role** Supabase key to the browser as its "anon" key. This
port keeps the same key for auth parity (`client/.env` `VITE_SUPABASE_ANON_KEY`) so login works
against the existing project — **replace it with the real anon/publishable key** before any real
deployment. The service-role key must never be in a browser bundle. The server keeps its own
service-role key in `server/.env` (never exposed to the client).

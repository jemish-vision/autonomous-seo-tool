# Feature Parity — Old app → New app

Tracks parity between the OLD app (`../autonomous-seo-platform/poc/seo-dashboard`, Next.js) and this
NEW app (`seo-platform`, Express + Vite/React + Supabase).

**The pattern:** the NEW app is a faithful **read-only Supabase rewrite**. Every *display* view was
ported almost 1:1 (nav + shell are byte-identical). The gaps were nearly all *write / live / action*
paths — several of which the ported client still called, so buttons 404'd until fixed.

Status legend: `[x]` done · `[~]` in progress · `[ ]` open · `[deferred]` blocked on an external
dependency (the `seo-crawler-poc` worker, not in this repo).

---

## Tier 1 — core flows (DONE)

- [x] **GSC live layer** — ported OAuth/token/crypto/client/inspect/sync/date-range into
  `server/src/modules/gsc/lib/`. Added `connect`, public `callback`, `link`/unlink, `sync`, `inspect`,
  `crawl-reason` (honest 501). `server/src/modules/gsc/gsc.routes.ts`
- [x] **GSC `metrics.range`** restored — the client date picker no longer throws.
- [x] **GSC live `properties`** listing (property discovery) + **revoke-on-disconnect**.
- [x] **Page replay / `/pages/:id/preview`** — route registered, inline `PageReplay` wired, blob paths
  fixed to authed `/api/crawls/:runId/pages/:pageId/{replay,screenshot,raw}` with signed-URL handling.
- [x] **Crawl-lifecycle honesty** — `server/src/modules/crawlLifecycle/crawlLifecycle.routes.ts`
  returns clear 501s for `cancel`/`rerun`/`reanalyze`/`progress`/`events`; client stops hammering dead
  endpoints (Stop disabled w/ tooltip, progress poller halts, activity stream shows honest empty state).
- [x] **`analyze-now` button** shows an honest "requires crawler worker" message instead of `HTTP 404`.

## Tier 2 — whole features absent (DONE)

- [x] **Exports** (CSV/JSON/NDJSON generate + list + status + download) — `server/src/modules/exports/`,
  `public.exports` table, Supabase-storage-backed files.
- [x] **Saved comparisons** (persisted diffs + competitor mode) — `server/src/modules/comparisons/`,
  `public.comparisons` table. (Live diff already existed in `compare` module.)
- [x] **Fix plan** — replace the empty stub in `server/src/modules/fixPlan/` with the deterministic
  per-URL change list derived from the analysis report.
- [x] **Applied-fixes recording** — `server/src/modules/appliedFixes/` GET + POST, `public.applied_fixes`
  table (persist that a fix was applied so it survives refresh/regenerate).
- [x] **Automation classification** — replace the zeros-stub in `server/src/modules/automation/` with the
  per-rule auto-safe classification from the report.

## Tier 2 — WordPress pairing / tunnel (DONE)

- [x] **Tunnel tables** — `public.tunnel_pairings`, `public.tunnel_connections`, `public.tunnel_commands`.
- [x] **Plugin-facing endpoints** (public, token-authed): `verify`, `heartbeat`, `result`.
- [x] **Dashboard endpoints** (session-authed): `pair`, `sites`.
- [x] **Sources rewire** — `connect` + `seo` tunnel branches join by `source_id` (kills the old
  `md5(siteUrl)` split-brain) instead of returning 501.
- [x] **Pairing UI** — `add-source-form.tsx`: WordPress → pairing code (default), with a "use credentials
  instead" fallback that keeps the working direct connector.

## Tier 3 — data & behavioral regressions (MOSTLY DONE)

- [x] **PageRank / internal-link graph** — `GET /api/crawls/:runId/graph` (`graph` module, power-iteration
  ported from old `buildGraph`) + `pagerank`/`inlinks`/`outlinks` on explorer rows; column sorts;
  page-detail header fills.
- [x] **Issues previous-run delta** — `GET /api/crawls/:runId/previous-rule-counts` resolves the prior
  analyzed same-site run; `issues.tsx` passes real `previousRuleCounts`.
- [x] **AI-supported-rule markers** — `issues.tsx` passes real `supportedRuleIds()`.
- [x] **Measurements drill-down** — `GET /api/crawls/:runId/measurements/:metricId/pages`; Overview grid
  metrics clickable (also fixed a stale `shape === "v2"` gate that suppressed drill-down).
- [x] **Exports wired to UI** — server-backed Export buttons on the pages explorer (dataset `pages`) and
  issues page (dataset `issues`, CSV/JSON menu).
- [x] **Mutes `healthScore` recompute** — real mute-aware score recomputed in-repo from stored
  `Finding` data (`server/src/lib/healthScore.ts`, ported from the crawler's `score.ts`); no worker
  needed. Honest `null` only when a run has no findings.
- [x] **AI recs read** now returns `generated: boolean` (backed by the new `crawls.aiRecsGeneratedAt`
  marker column) so the UI distinguishes never-generated from generated-zero. Column applied to Supabase.
- [x] **`artifacts/status`** endpoint (`GET /api/artifacts/status` → `{ configured, reason? }`) + wired
  into `PageReplay`'s storage notice.
- [x] **Delete a run** — `DELETE /api/crawls/:runId` (single cascade delete; all child FKs verified
  `onDelete: Cascade`).
- [ ] **AI recs generate** still drops `businessContext` / previous-merge / intelligence context.
- [ ] **GSC disconnect** now revokes (done Tier 1); remaining: richer live property permission surfacing.
- [ ] Minor leftovers: exports/AI-recs `sync` HTTP endpoints, rules-run skipped/errored manifest,
  raw-HTML `hasRawHtml` derivation edge cases.

## Crawl execution — DONE (worker vendored into the backend)

The `seo-crawler-poc` worker is now **vendored at `server/crawler/`** and spawned as a child process
by the backend. Verified end-to-end: `POST /api/crawls` crawled example.com → auto-analyzed → synced
to Supabase (`healthScore 72.7`, pages + 15 findings), and `DELETE` removed it cleanly.

- [x] **Run a crawl** — `POST /api/crawls` spawns the vendored worker (`node --import tsx crawler/src/index.ts`),
  creates a `RUNNING` Crawl row, and on exit runs analyze → `syncRunToPostgres` → finalizes the row.
- [x] **Status poll** — `GET /api/crawls/:runId` extended to the `CrawlStatusResponse` superset (`state`,
  `reportReady`, `exitCode`, `log`, `note`) so the New-Crawl page's poll loop terminates.
- [x] **Cancel** (process-tree kill: `taskkill /T /F` win / `kill -pid` posix), **rerun**, **reanalyze**,
  **progress** (page-file counters), **queue** (RUNNING rows surface automatically).
- [x] **Live events** — `GET /:runId/events` SSE tails `events.ndjson`. Works with a bearer/`AUTH_REQUIRED=false`;
  in-browser `EventSource` can't send a bearer, so live activity needs a token-in-query or public-mount tweak
  (progress polling is the primary, fully-working mechanism). ← only open sub-item.
- [x] Config: `CRAWLER_PROJECT_DIR`, `CRAWLER_STORAGE_DIR`, `CRAWL_EXECUTION_ENABLED` (env, all optional).
- [deferred] **GSC `crawl-reason`** (queue crawler for excluded URLs) — still an honest 501.

**Prereq:** the vendored `server/crawler` has its deps + Chromium installed (`npm install` +
`npx playwright install chromium`). Crawls run **one at a time** (single-crawl lock).

---

## Runtime validation (against real seeded crawls)

**Re-runnable:** `cd server && npm run smoke` (or `SMOKE_PORT=4210 npm run smoke`). Boots the server
fresh with auth off on a throwaway port, fetches a real runId to tighten read-route asserts, probes
every route against an expected-status class, prints a PASS/FAIL table, tears the server down, and
exits nonzero on any failure (CI-friendly). Script: `server/scripts/smoke-test.mts`. Current: 26/26.


Booted the server fresh (auth off) and exercised the new routes against real data (`ui-20260821-091615`
wpdemo, `ui-20260821-122635` visioninfotech):

- **All routers mount + respond** — public routes (`tunnel/verify`→400/404, `gsc/callback`→302) bypass
  auth; protected routes gate/execute correctly; honest 501 stubs fire; missing routes → 404. Server
  boots with zero import/mount errors.
- **PageRank/graph** — real descending pageranks with inlinks/outlinks; explorer rows carry the fields.
- **Previous-run delta** — returns a real per-rule count map from the prior same-site run.
- **Measurements drill-down** — returns the real matching-page list per metric.
- **Mutes healthScore recompute** — **matches the crawler's stored score**: 56.3 = 56.3 (wpdemo);
  67.2 vs 67.4 (1047-page run, −0.2 rounding). Mute-aware (score moves as rules are muted), reversible.
- **delete-a-run / artifacts-status** — respond correctly (404 on missing run; configured=true).

Not runtime-verified (need an auth token / real WP plugin / Google creds): exports file output, saved
comparisons, applied-fixes/fix-plan writes, the tunnel end-to-end pairing handshake, GSC OAuth, and the
AI-recs `generated` flag after a real generation. These are typecheck-clean and mount correctly.

Open edge: muting a rule that never fired in a run returns a response without `healthScore` (harden
later; the UI only offers rules that actually fired). Also a −0.2 recompute delta on very large runs.

> The dev server on port 4000 during this session was **stale** (pre-dated these mounts) — restart it
> (`npm run dev` in `server/`) to serve the new routes to the browser.

## How to apply the DB migrations

Each feature ships an idempotent SQL migration + a runner mirroring
`server/scripts/apply-sources-migration.mts`. From `server/`:

```
npx tsx scripts/apply-exports-migration.mts
npx tsx scripts/apply-comparisons-migration.mts
npx tsx scripts/apply-applied-fixes-migration.mts
npx tsx scripts/apply-tunnel-migration.mts
npx tsx scripts/apply-airecs-column.mts   # adds crawls.aiRecsGeneratedAt (schema-first column, applied via targeted ALTER)
```

> Note: `prisma db push` is NOT safe here — the raw-SQL tables above are not in `schema.prisma`, so a
> full push would try to drop them. Schema-managed additive changes go through a targeted `ALTER` (see
> `apply-airecs-column.mts`) instead.

Runners are check-then-apply (safe to re-run); they use `DIRECT_URL` (session mode) for DDL.

**Status:** all four migrations have been applied to the project's Supabase (tables `exports`,
`comparisons`, `applied_fixes`, `tunnel_pairings`, `tunnel_connections`, `tunnel_commands` — each with
RLS enabled + 4 owner policies). Re-running the runners is a no-op ("ALREADY EXISTS").

-- Saved comparisons for the dashboard. The OLD Next.js app persisted comparisons as JSON files
-- under storage/comparisons/ (see lib/data-comparisons.ts). This Supabase-only app stores them as
-- rows so a comparison saved on one machine is visible from any machine signed in with the same
-- account.
--
-- A comparison is a run-over-run diff OR a competitor aggregate between two crawl runs. The full
-- computed payload (a CrawlDiff and/or competitor aggregate) is stored in `result` JSONB; the
-- detail endpoint slices it by section (summary|pages|issues|measurements).
--
-- Scope: per Supabase user (user_id = auth.uid()). RLS enforces that a user can only read/write
-- their own comparisons. Idempotent so it can be re-run safely.
--
-- NOTE (Express port): our backend talks to Supabase with the SERVICE-ROLE key, which BYPASSES RLS.
-- Every query in server/src/modules/comparisons scopes by user_id = req.userId in code. These RLS
-- policies remain as defense-in-depth.

CREATE TABLE IF NOT EXISTS public.comparisons (
    id                TEXT PRIMARY KEY,
    user_id           UUID NOT NULL DEFAULT auth.uid(),
    site_id           TEXT,
    base_crawl_id     TEXT,
    against_crawl_id  TEXT,
    mode              TEXT,
    result            JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comparisons_user_id_idx ON public.comparisons (user_id);
CREATE INDEX IF NOT EXISTS comparisons_site_id_idx ON public.comparisons (site_id);

ALTER TABLE public.comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comparisons_select_own ON public.comparisons;
CREATE POLICY comparisons_select_own ON public.comparisons
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS comparisons_insert_own ON public.comparisons;
CREATE POLICY comparisons_insert_own ON public.comparisons
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS comparisons_update_own ON public.comparisons;
CREATE POLICY comparisons_update_own ON public.comparisons
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS comparisons_delete_own ON public.comparisons;
CREATE POLICY comparisons_delete_own ON public.comparisons
    FOR DELETE USING (auth.uid() = user_id);

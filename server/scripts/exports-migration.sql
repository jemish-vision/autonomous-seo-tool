-- Dataset exports persistence for the dashboard (CSV / JSON / NDJSON exports of a crawl run's
-- pages / issues / links / media / failures / sitemap / fix-plan datasets).
--
-- Restores the old Next.js app's exports feature, which computed exports synchronously and wrote
-- them to storage/exports/ on disk. This Supabase-only app persists the export FILE to the private
-- Supabase Storage "exports" bucket (see BUCKETS in db/src/storage/supabaseStorage.ts) and records
-- one metadata row per export here in public.exports.
--
-- Scope: per Supabase user (user_id = auth.uid()). RLS enforces that a user can only read/write
-- their own export rows. Idempotent so it can be re-run safely.
--
-- NOTE (Express port): our backend talks to Supabase with the SERVICE-ROLE key, which BYPASSES RLS.
-- Every query in server/src/modules/exports scopes by user_id = req.userId in code. These RLS
-- policies remain as defense-in-depth (and for any request-scoped anon client).

CREATE TABLE IF NOT EXISTS public.exports (
    id            TEXT PRIMARY KEY,
    user_id       UUID NOT NULL DEFAULT auth.uid(),
    crawl_id      TEXT NOT NULL,
    dataset       TEXT,
    format        TEXT,
    status        TEXT NOT NULL DEFAULT 'completed',
    storage_path  TEXT,
    row_count     INTEGER,
    byte_size     BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exports_user_id_idx ON public.exports (user_id);
CREATE INDEX IF NOT EXISTS exports_crawl_id_idx ON public.exports (crawl_id);

ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exports_select_own ON public.exports;
CREATE POLICY exports_select_own ON public.exports
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS exports_insert_own ON public.exports;
CREATE POLICY exports_insert_own ON public.exports
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS exports_update_own ON public.exports;
CREATE POLICY exports_update_own ON public.exports
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS exports_delete_own ON public.exports;
CREATE POLICY exports_delete_own ON public.exports
    FOR DELETE USING (auth.uid() = user_id);

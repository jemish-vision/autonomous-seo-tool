-- Sources persistence for the dashboard, moved from storage/sources.json (filesystem)
-- into Supabase so a source connected on one machine is visible from any machine
-- signed in with the same account.
--
-- Scope: per Supabase user (user_id = auth.uid()). RLS enforces that a user can
-- only read/write their own sources. Same-email logins on different PCs share the
-- same auth.uid(), so they see the same rows.
--
-- credentials/status/capabilities are JSONB to mirror the flat-file shapes the app
-- already used (see lib/types-sources.ts). Idempotent so it can be re-run safely.
--
-- NOTE (Express port): our backend talks to Supabase with the SERVICE-ROLE key, which
-- BYPASSES RLS. Every query in server/src/modules/sources scopes by user_id = req.userId
-- in code. These RLS policies remain as defense-in-depth (and for the old Next.js app which
-- used the request-scoped anon client).

CREATE TABLE IF NOT EXISTS public.sources (
    id            TEXT PRIMARY KEY,
    user_id       UUID NOT NULL DEFAULT auth.uid(),
    kind          TEXT NOT NULL,
    name          TEXT NOT NULL,
    site_url      TEXT NOT NULL,
    credentials   JSONB NOT NULL DEFAULT '{}'::jsonb,
    status        JSONB,
    capabilities  JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sources_user_id_idx ON public.sources (user_id);

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sources_select_own ON public.sources;
CREATE POLICY sources_select_own ON public.sources
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sources_insert_own ON public.sources;
CREATE POLICY sources_insert_own ON public.sources
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS sources_update_own ON public.sources;
CREATE POLICY sources_update_own ON public.sources
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS sources_delete_own ON public.sources;
CREATE POLICY sources_delete_own ON public.sources
    FOR DELETE USING (auth.uid() = user_id);

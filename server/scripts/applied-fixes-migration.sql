-- Applied-fixes persistence for the dashboard. Records which AI recommendations were actually
-- written to a customer's site for a crawl run, so an "Applied" badge survives a page refresh AND
-- a later Regenerate (which rewrites the recommendation set wholesale). Replaces the old app's
-- storage/runs/<runId>/applied-fixes.json (lib/data-applied-fixes.ts).
--
-- Scope: per Supabase user (user_id = auth.uid()). RLS enforces that a user can only read/write
-- their own applied-fix records. Same-email logins on different PCs share the same auth.uid(), so
-- they see the same rows.
--
-- The row breaks out rule_id / page_url / field for indexing and querying; the full client
-- AppliedFix payload (pageId, instanceKey, changes, sourceId, queued, commandId) is stored in the
-- `detail` JSONB. Idempotent so it can be re-run safely.
--
-- NOTE (Express port): our backend talks to Supabase with the SERVICE-ROLE key, which BYPASSES
-- RLS. Every query in server/src/modules/appliedFixes scopes by user_id = req.userId in code. These
-- RLS policies remain as defense-in-depth.

CREATE TABLE IF NOT EXISTS public.applied_fixes (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL DEFAULT auth.uid(),
    crawl_id    TEXT NOT NULL,
    rule_id     TEXT,
    page_url    TEXT,
    field       TEXT,
    detail      JSONB,
    applied_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS applied_fixes_user_id_idx ON public.applied_fixes (user_id);
CREATE INDEX IF NOT EXISTS applied_fixes_crawl_id_idx ON public.applied_fixes (crawl_id);

ALTER TABLE public.applied_fixes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS applied_fixes_select_own ON public.applied_fixes;
CREATE POLICY applied_fixes_select_own ON public.applied_fixes
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS applied_fixes_insert_own ON public.applied_fixes;
CREATE POLICY applied_fixes_insert_own ON public.applied_fixes
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS applied_fixes_update_own ON public.applied_fixes;
CREATE POLICY applied_fixes_update_own ON public.applied_fixes
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS applied_fixes_delete_own ON public.applied_fixes;
CREATE POLICY applied_fixes_delete_own ON public.applied_fixes
    FOR DELETE USING (auth.uid() = user_id);

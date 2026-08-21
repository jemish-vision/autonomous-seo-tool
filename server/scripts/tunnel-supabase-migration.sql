-- WordPress tunnel/pairing subsystem persistence (ported from the old app's on-disk JSON to Supabase).
-- Per-user (user_id = auth.uid()); RLS defense-in-depth. Service-role backend scopes by user_id in code.
-- Plugin-facing verify/heartbeat/result run service-role with NO session and match by secret code/token/site_id.

CREATE TABLE IF NOT EXISTS public.tunnel_pairings (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL DEFAULT auth.uid(),
    code        TEXT NOT NULL UNIQUE,
    source_id   TEXT,
    site_url    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS tunnel_pairings_user_id_idx ON public.tunnel_pairings (user_id);
CREATE INDEX IF NOT EXISTS tunnel_pairings_code_idx ON public.tunnel_pairings (code);
ALTER TABLE public.tunnel_pairings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tunnel_pairings_select_own ON public.tunnel_pairings;
CREATE POLICY tunnel_pairings_select_own ON public.tunnel_pairings FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS tunnel_pairings_insert_own ON public.tunnel_pairings;
CREATE POLICY tunnel_pairings_insert_own ON public.tunnel_pairings FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS tunnel_pairings_update_own ON public.tunnel_pairings;
CREATE POLICY tunnel_pairings_update_own ON public.tunnel_pairings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS tunnel_pairings_delete_own ON public.tunnel_pairings;
CREATE POLICY tunnel_pairings_delete_own ON public.tunnel_pairings FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.tunnel_connections (
    id                    TEXT PRIMARY KEY,
    user_id               UUID NOT NULL,
    source_id             TEXT,
    kind                  TEXT NOT NULL DEFAULT 'wordpress',
    site_url              TEXT NOT NULL,
    name                  TEXT NOT NULL,
    token_hash            TEXT NOT NULL,
    paired_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat        TIMESTAMPTZ,
    status                TEXT NOT NULL DEFAULT 'online',
    site_info             JSONB NOT NULL DEFAULT '{}'::jsonb,
    writable_capabilities JSONB
);
CREATE INDEX IF NOT EXISTS tunnel_connections_user_id_idx ON public.tunnel_connections (user_id);
CREATE INDEX IF NOT EXISTS tunnel_connections_source_id_idx ON public.tunnel_connections (source_id);
ALTER TABLE public.tunnel_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tunnel_connections_select_own ON public.tunnel_connections;
CREATE POLICY tunnel_connections_select_own ON public.tunnel_connections FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS tunnel_connections_insert_own ON public.tunnel_connections;
CREATE POLICY tunnel_connections_insert_own ON public.tunnel_connections FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS tunnel_connections_update_own ON public.tunnel_connections;
CREATE POLICY tunnel_connections_update_own ON public.tunnel_connections FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS tunnel_connections_delete_own ON public.tunnel_connections;
CREATE POLICY tunnel_connections_delete_own ON public.tunnel_connections FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.tunnel_commands (
    id           TEXT PRIMARY KEY,
    user_id      UUID NOT NULL,
    site_id      TEXT NOT NULL,
    source_id    TEXT,
    action       TEXT NOT NULL,
    target       JSONB NOT NULL,
    changes      JSONB NOT NULL,
    provider     TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    receipt      JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    sent_at      TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tunnel_commands_user_id_idx ON public.tunnel_commands (user_id);
CREATE INDEX IF NOT EXISTS tunnel_commands_site_id_idx ON public.tunnel_commands (site_id);
ALTER TABLE public.tunnel_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tunnel_commands_select_own ON public.tunnel_commands;
CREATE POLICY tunnel_commands_select_own ON public.tunnel_commands FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS tunnel_commands_insert_own ON public.tunnel_commands;
CREATE POLICY tunnel_commands_insert_own ON public.tunnel_commands FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS tunnel_commands_update_own ON public.tunnel_commands;
CREATE POLICY tunnel_commands_update_own ON public.tunnel_commands FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS tunnel_commands_delete_own ON public.tunnel_commands;
CREATE POLICY tunnel_commands_delete_own ON public.tunnel_commands FOR DELETE USING (auth.uid() = user_id);

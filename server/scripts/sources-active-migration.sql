-- Add an `active` flag to public.sources so a user can mark ONE connection as the target that
-- Fix & Apply always writes through (see FEATURE-CONNECTIONS.md). Single-active is enforced in
-- application code (server/src/modules/sources activate endpoint), not by a DB constraint, so
-- re-activating simply flips the previous one off. Idempotent.

ALTER TABLE public.sources
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT false;

-- Fast lookup of "this user's active source".
CREATE INDEX IF NOT EXISTS sources_active_idx ON public.sources (user_id, active);

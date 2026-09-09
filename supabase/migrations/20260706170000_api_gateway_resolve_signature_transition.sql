-- PostgreSQL cannot CREATE OR REPLACE a function when its OUT/table return
-- columns change.  The following historical migration adds two return columns
-- to api_gateway_resolve_api_key(text), so remove the old signature first.
-- The next migration recreates it atomically during the same replay sequence.
drop function if exists public.api_gateway_resolve_api_key(text);

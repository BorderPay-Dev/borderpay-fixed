-- 20260518_webauthn_credentials
--
-- Server-verified WebAuthn (platform authenticator / passkey).
--
-- The previous biometric flow was UX-only: it generated a challenge
-- client-side, never verified the signature on the assertion, and used
-- the result purely to gate a refresh_token stored in localStorage. This
-- migration introduces the schema for the proper four-call WebAuthn dance:
--   • webauthn-register-options  (server-issued challenge)
--   • webauthn-register-verify   (CBOR-decode attestation, persist cred)
--   • webauthn-auth-options      (server-issued challenge for known cred)
--   • webauthn-auth-verify       (verify signature + counter monotonicity)
--
-- All cryptographic work happens in the four edge functions via
-- @simplewebauthn/server@10.0.0 (Deno-compatible via esm.sh).
--
-- Applied via Supabase MCP on 2026-05-18 as
-- `webauthn_credentials_and_challenges`.

create table if not exists public.webauthn_credentials (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  credential_id   text        not null,                              -- base64url
  public_key      text        not null,                              -- base64url COSE
  counter         bigint      not null default 0,
  transports      text[]      not null default '{}'::text[],
  device_type     text,                                              -- 'platform' | 'cross-platform'
  backed_up       boolean     not null default false,
  nickname        text,                                              -- user-facing label
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  unique (credential_id)
);

create index if not exists webauthn_credentials_user_idx
  on public.webauthn_credentials (user_id);

alter table public.webauthn_credentials enable row level security;

drop policy if exists webauthn_owner_read   on public.webauthn_credentials;
create policy webauthn_owner_read   on public.webauthn_credentials
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists webauthn_owner_delete on public.webauthn_credentials;
create policy webauthn_owner_delete on public.webauthn_credentials
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists webauthn_service_role on public.webauthn_credentials;
create policy webauthn_service_role on public.webauthn_credentials
  for all to service_role using (true) with check (true);

-- Short-lived server-issued nonces.
create table if not exists public.webauthn_challenges (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        references auth.users(id) on delete cascade,
  -- For registration the user_id is set; for auth-by-credential-id the
  -- user_id may be null at issue and resolved when the assertion is
  -- verified (resident-key / "discoverable credential" flows).
  challenge       text        not null,                              -- base64url
  purpose         text        not null check (purpose in ('register','authenticate')),
  rp_id           text        not null,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists webauthn_challenges_expires_idx
  on public.webauthn_challenges (expires_at)
 where consumed_at is null;

alter table public.webauthn_challenges enable row level security;
drop policy if exists webauthn_chal_service_role on public.webauthn_challenges;
create policy webauthn_chal_service_role on public.webauthn_challenges
  for all to service_role using (true) with check (true);

-- Reap expired / consumed challenges. Called from a daily pg_cron job.
create or replace function public.reap_expired_webauthn_challenges()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.webauthn_challenges
   where created_at < now() - interval '1 day';
$$;

comment on table public.webauthn_credentials is
  'Platform-authenticator credentials enrolled per user. Counter monotonically increases per RFC 8809; rollback indicates a cloned authenticator (webauthn-auth-verify returns 409 counter_regression).';
comment on table public.webauthn_challenges is
  'Server-issued WebAuthn challenges. Single-use, 5-minute TTL, consumed on verify.';

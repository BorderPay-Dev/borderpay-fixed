-- 20260520_totp_secret_b64_rpcs
--
-- Repairs the TOTP encrypted-secret round-trip between setup-2fa and
-- verify-2fa.
--
-- Root cause (round-7 CTO finding):
--   setup-2fa was calling `.from('user_security').upsert({
--     two_factor_secret_encrypted: Array.from(cipher), ... })`.
--   PostgREST JSON-serialised that JS number array as `[139,71,166,...]`
--   and the Postgres bytea text-input path stored the ASCII BYTES of
--   that string (i.e. `0x5b 0x31 0x33 0x39 0x2c 0x37 0x31 ...`),
--   not the actual cipher bytes. On read, verify-2fa wrapped the
--   returned `\x...` hex string with `new Uint8Array(string)` which
--   produces zero-length garbage.
--   Net effect: 2FA enrollment + verification could never work via
--   the encrypted column. Confirmed in live: 1 affected row,
--   2FA enrolled-with-encrypted = 0 (round-4 reset already cleared
--   `two_factor_enabled` for that row).
--
-- Fix:
--   Wrap the bytea boundary on the Postgres side so the edge function
--   never has to think about bytea text encoding. The new RPCs accept
--   and return BASE64 text — supabase-js handles text cleanly and
--   PostgreSQL handles bytea cleanly.
--
-- Idempotent: CREATE OR REPLACE for functions; the data cleanup
-- targets only rows with `two_factor_enabled = false` (none of which
-- have a usable encrypted blob), so it is a no-op for any user who
-- has successfully enrolled (none currently — see post-condition).

-- ─── 1. set_totp_secret_encrypted_b64 ──────────────────────────────────
-- Upserts the encrypted secret for `p_user_id` from a base64 string.
-- The function decodes base64 → bytea inside Postgres so the wire
-- format is always plain text. `p_enc_version` defaults to 1 so the
-- caller does not have to pass it during the v1 rollout.
create or replace function public.set_totp_secret_encrypted_b64(
  p_user_id     uuid,
  p_b64         text,
  p_enc_version smallint default 1
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_b64 is null or length(p_b64) = 0 then
    raise exception 'p_b64 is required (non-empty base64 string)';
  end if;

  insert into public.user_security (
    user_id, two_factor_secret_encrypted, two_factor_enc_version,
    two_factor_secret, created_at, updated_at
  ) values (
    p_user_id, decode(p_b64, 'base64'), p_enc_version,
    null, now(), now()
  )
  on conflict (user_id) do update
    set two_factor_secret_encrypted = excluded.two_factor_secret_encrypted,
        two_factor_enc_version      = excluded.two_factor_enc_version,
        two_factor_secret           = null,        -- belt-and-braces clear plaintext
        updated_at                  = now();
end;
$$;

-- ─── 2. get_totp_secret_encrypted_b64 ──────────────────────────────────
-- Returns the encrypted secret for `p_user_id` as a base64 string, or
-- null if no encrypted secret is set. Avoids bytea↔JSON corruption.
create or replace function public.get_totp_secret_encrypted_b64(
  p_user_id uuid
) returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(two_factor_secret_encrypted, 'base64')
    from public.user_security
   where user_id = p_user_id
     and two_factor_secret_encrypted is not null;
$$;

-- ─── 3. Permissions ────────────────────────────────────────────────────
-- Both edge functions use the service-role client, which already has
-- all privileges. The grants here are belt-and-braces so a future
-- accidental switch to the anon/authenticated client surfaces a 401
-- on the RPC, not a silent failure. Authenticated users may NOT
-- invoke these directly; the edge functions enforce the user-scope.
revoke all on function public.set_totp_secret_encrypted_b64(uuid, text, smallint) from public;
revoke all on function public.get_totp_secret_encrypted_b64(uuid)                  from public;
grant  execute on function public.set_totp_secret_encrypted_b64(uuid, text, smallint) to service_role;
grant  execute on function public.get_totp_secret_encrypted_b64(uuid)                  to service_role;

-- ─── 4. Cleanup of pre-fix bogus blobs ─────────────────────────────────
-- Live carries one row where `two_factor_secret_encrypted` is the
-- ASCII text of a JSON number array (e.g. `[139,71,...]`), which can
-- never decrypt under any key. The corresponding row has
-- `two_factor_enabled = false` (round-4 reset already handled the
-- enabled-but-broken case). Clear the blob so a future setup-2fa
-- call starts from a clean slate.
update public.user_security
   set two_factor_secret_encrypted = null,
       two_factor_enc_version      = null,
       updated_at                  = now()
 where two_factor_secret_encrypted is not null
   and two_factor_enabled = false;

-- ─── 5. Post-condition assertions ──────────────────────────────────────
-- Guard against the failure mode this migration exists to prevent.
do $$
declare
  v_enabled_without_encrypted int;
  v_set_signature             text;
  v_get_signature             text;
begin
  -- 5.1 No user is left in the "enabled but no encrypted" stranded state.
  select count(*) into v_enabled_without_encrypted
    from public.user_security
   where two_factor_enabled = true
     and two_factor_secret_encrypted is null;
  if v_enabled_without_encrypted <> 0 then
    raise exception
      'totp_b64_rpcs: % rows have two_factor_enabled=true but no encrypted secret',
      v_enabled_without_encrypted;
  end if;

  -- 5.2 Both RPCs exist with the expected signatures.
  select pg_get_function_identity_arguments('public.set_totp_secret_encrypted_b64'::regproc)
    into v_set_signature;
  if v_set_signature <> 'p_user_id uuid, p_b64 text, p_enc_version smallint' then
    raise exception
      'totp_b64_rpcs: set_totp_secret_encrypted_b64 has wrong signature: %', v_set_signature;
  end if;

  select pg_get_function_identity_arguments('public.get_totp_secret_encrypted_b64'::regproc)
    into v_get_signature;
  if v_get_signature <> 'p_user_id uuid' then
    raise exception
      'totp_b64_rpcs: get_totp_secret_encrypted_b64 has wrong signature: %', v_get_signature;
  end if;
end $$;

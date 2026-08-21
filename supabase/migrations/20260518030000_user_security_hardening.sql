-- 20260518_user_security_hardening
--
-- Security hardening of public.user_security:
--   • TOTP secret encrypted at rest (AES-256-GCM in setup-2fa/verify-2fa)
--     — adds two_factor_secret_encrypted (bytea) + two_factor_enc_version
--   • PIN PBKDF2-SHA256 100k iterations + 32-byte random salt
--     — adds pin_hash_v2 (text) + pin_failed_attempts + pin_locked_until
--       + pin_updated_at
--   • Reset misleading boolean flags from the previous client-side flow
--     (11 rows had pin_set=true with no actual hash, 5 had
--     two_factor_enabled=true with no actual secret)
--
-- Applied via Supabase MCP on 2026-05-18 as
-- `user_security_encrypt_totp_pin_attempts_reset_flags`. Committed here
-- so the schema is reproducible from source.
--
-- Migration policy on existing data:
--   • The previous client-side flow NEVER persisted secrets/hashes
--     server-side, so there is no plaintext data to migrate. The reset
--     statement clears the misleading boolean flags so users see the
--     correct "not set" state and enroll through the new server-backed
--     flows. No user is locked out — they just need to re-enroll.

-- 1) TOTP encryption-at-rest columns.
alter table public.user_security
  add column if not exists two_factor_secret_encrypted bytea,
  add column if not exists two_factor_enc_version      smallint default 1;

-- 2) PIN PBKDF2 + attempt tracking.
--    pin_hash_v2 holds: "v2$" || base64(salt) || "$" || base64(pbkdf2(pin, salt))
--    Iteration count is fixed at 100_000 (SHA-256) in setup-pin / verify-pin.
--    The existing pin_hash column (single-round SHA-256) is kept for
--    backward compat; verify-pin reads either and lazy-upgrades to v2 on
--    successful verify so users get the stronger hash without re-entry.
alter table public.user_security
  add column if not exists pin_hash_v2         text,
  add column if not exists pin_failed_attempts smallint    not null default 0,
  add column if not exists pin_locked_until    timestamptz,
  add column if not exists pin_updated_at      timestamptz not null default now();

-- 3) Reset misleading boolean flags. Required because the previous
--    client-side flow flipped pin_set / two_factor_enabled to true
--    without ever persisting the hash/secret server-side.
update public.user_security
   set pin_set            = false,
       two_factor_enabled = false
 where (pin_set            = true and pin_hash    is null and pin_hash_v2 is null)
    or (two_factor_enabled = true and two_factor_secret is null and two_factor_secret_encrypted is null);

-- 4) Helper indexes.
create index if not exists user_security_pin_locked_until_idx
  on public.user_security (pin_locked_until)
 where pin_locked_until is not null;

comment on column public.user_security.two_factor_secret_encrypted is
  'AES-256-GCM ciphertext of TOTP secret: 12-byte IV || ciphertext || 16-byte tag. Key derived from TOTP_ENCRYPTION_KEY env in setup-2fa/verify-2fa. setup-2fa fails closed (HTTP 500) if the env is missing.';
comment on column public.user_security.pin_hash_v2 is
  'PIN PBKDF2-SHA256 (100k iters, 32-byte random salt). Format: v2$base64(salt)$base64(hash).';
comment on column public.user_security.pin_failed_attempts is
  'Number of consecutive failed verify-pin attempts. Reset to 0 on success or after pin_locked_until expires.';
comment on column public.user_security.pin_locked_until is
  'Timestamp until which verify-pin returns 423 locked. Set by verify-pin after 5 consecutive failures (15 min lockout).';

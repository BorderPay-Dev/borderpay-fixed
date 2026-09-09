-- 20260518_2fa_reset_unencrypted_plaintext
--
-- Follow-up to 20260518_user_security_hardening.sql.
--
-- Original migration only flipped `two_factor_enabled=false` when BOTH the
-- legacy plaintext column AND the new encrypted column were null. That
-- leaves a stranded population: users with `two_factor_enabled=true` and
-- a legacy plaintext `two_factor_secret` but no encrypted blob. After
-- verify-2fa was switched to decrypt-only (round 2, fail-closed), those
-- users can no longer pass the 2FA gate — their TOTP code is rejected
-- regardless of correctness because the function never reads the
-- plaintext column.
--
-- Policy decision (per CTO round-3 review):
--
--   We do NOT silently encrypt legacy plaintext secrets in-place. That
--   path would require either (a) a transient memory-only encryption
--   pass with TOTP_ENCRYPTION_KEY, which is risky to script, or (b) a
--   one-time grace window where verify-2fa accepts plaintext, which
--   re-opens the vector we just closed. Both are worse than asking the
--   affected users to re-enroll.
--
--   This migration resets `two_factor_enabled=false` for every row
--   where `two_factor_secret_encrypted IS NULL`. The user's UI state
--   becomes "2FA not enabled"; they enroll cleanly through setup-2fa
--   which writes ONLY the encrypted blob. The plaintext column is left
--   in place for the audit trail; a later migration can null it once
--   verify-2fa is confirmed to have zero plaintext readers (it already
--   does today after the round-2 fail-closed deploy).
--
-- Post-condition (asserted at migration end):
--   `select count(*) from public.user_security
--      where two_factor_enabled = true
--        and two_factor_secret_encrypted is null` = 0

update public.user_security
   set two_factor_enabled = false,
       updated_at         = now()
 where two_factor_enabled = true
   and two_factor_secret_encrypted is null;

-- Hard assertion: if any stranded rows remain, the migration fails and the
-- transaction rolls back. Catches the case where someone added more
-- legacy rows between this migration and its predecessor.
do $$
declare
  v_stranded int;
begin
  select count(*) into v_stranded
    from public.user_security
   where two_factor_enabled = true
     and two_factor_secret_encrypted is null;
  if v_stranded <> 0 then
    raise exception '2FA reset post-condition failed: % rows still enabled without encrypted secret', v_stranded;
  end if;
end $$;

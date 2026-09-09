-- ════════════════════════════════════════════════════════════════════════════
-- BorderPay Africa — Fix 12 RLS ERROR-level issues
-- ════════════════════════════════════════════════════════════════════════════
--
-- The Supabase security advisor flagged 12 RLS policies as ERROR-level because
-- they reference `auth.jwt() -> user_metadata -> role`. The `user_metadata`
-- claim is EDITABLE by end users via supabase.auth.updateUser({ data: ... }),
-- which means any authenticated user can grant themselves admin by setting
-- their own role to 'admin' — a critical privilege escalation vulnerability.
--
-- FIX: Replace all 12 policies with a SECURITY DEFINER function that checks
-- the `admin_users` table directly. This is the Supabase-recommended pattern.
--
-- Affected policies (all 12):
--   1. user_profiles.admin_read_all_profiles
--   2. user_profiles.admin_update_profiles
--   3. wallets.admin_read_all_wallets
--   4. cards.admin_read_all_cards
--   5. cards.admin_update_all_cards
--   6. accounts.admin_read_all_accounts
--   7. transactions.admin_read_all_transactions
--   8. stablecoin_transactions.admin_read_all_stablecoin_tx
--   9. kyc_verifications.admin_read_all_kyc
--  10. kyc_verifications.admin_update_kyc
--  11. notifications.admin_read_all_notifications
--  12. notifications.admin_manage_notifications
-- ════════════════════════════════════════════════════════════════════════════

-- ── Step 1: Create secure admin-check function ──────────────────────────────
-- SECURITY DEFINER bypasses RLS so the function itself can read admin_users
-- regardless of the calling user's RLS context. We set a fixed search_path
-- to also resolve the function_search_path_mutable warning.

CREATE OR REPLACE FUNCTION public.is_borderpay_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = (SELECT auth.uid())
  );
$$;

-- Lock down execute to authenticated users only (and service_role)
REVOKE ALL ON FUNCTION public.is_borderpay_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_borderpay_admin() TO authenticated, service_role;

COMMENT ON FUNCTION public.is_borderpay_admin() IS
  'Returns true if the calling user exists in public.admin_users. Safe for RLS policies because it uses SECURITY DEFINER and checks a server-controlled table (not user_metadata).';

-- ── Step 2: Drop the 12 unsafe policies ─────────────────────────────────────

DROP POLICY IF EXISTS "admin_read_all_profiles"   ON public.user_profiles;
DROP POLICY IF EXISTS "admin_update_profiles"     ON public.user_profiles;
DROP POLICY IF EXISTS "admin_read_all_wallets"    ON public.wallets;
DROP POLICY IF EXISTS "admin_read_all_cards"      ON public.cards;
DROP POLICY IF EXISTS "admin_update_all_cards"    ON public.cards;
DROP POLICY IF EXISTS "admin_read_all_accounts"   ON public.accounts;
DROP POLICY IF EXISTS "admin_read_all_transactions" ON public.transactions;
DROP POLICY IF EXISTS "admin_read_all_stablecoin_tx" ON public.stablecoin_transactions;
DROP POLICY IF EXISTS "admin_read_all_kyc"        ON public.kyc_verifications;
DROP POLICY IF EXISTS "admin_update_kyc"          ON public.kyc_verifications;
DROP POLICY IF EXISTS "admin_read_all_notifications" ON public.notifications;
DROP POLICY IF EXISTS "admin_manage_notifications"   ON public.notifications;

-- ── Step 3: Recreate all 12 policies using the secure function ──────────────

-- user_profiles
CREATE POLICY "admin_read_all_profiles"
  ON public.user_profiles FOR SELECT
  TO authenticated
  USING (public.is_borderpay_admin());

CREATE POLICY "admin_update_profiles"
  ON public.user_profiles FOR UPDATE
  TO authenticated
  USING (public.is_borderpay_admin())
  WITH CHECK (public.is_borderpay_admin());

-- wallets
CREATE POLICY "admin_read_all_wallets"
  ON public.wallets FOR SELECT
  TO authenticated
  USING (public.is_borderpay_admin());

-- cards
CREATE POLICY "admin_read_all_cards"
  ON public.cards FOR SELECT
  TO authenticated
  USING (public.is_borderpay_admin());

CREATE POLICY "admin_update_all_cards"
  ON public.cards FOR UPDATE
  TO authenticated
  USING (public.is_borderpay_admin())
  WITH CHECK (public.is_borderpay_admin());

-- accounts
CREATE POLICY "admin_read_all_accounts"
  ON public.accounts FOR SELECT
  TO authenticated
  USING (public.is_borderpay_admin());

-- transactions
CREATE POLICY "admin_read_all_transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (public.is_borderpay_admin());

-- stablecoin_transactions
CREATE POLICY "admin_read_all_stablecoin_tx"
  ON public.stablecoin_transactions FOR SELECT
  TO authenticated
  USING (public.is_borderpay_admin());

-- kyc_verifications
CREATE POLICY "admin_read_all_kyc"
  ON public.kyc_verifications FOR SELECT
  TO authenticated
  USING (public.is_borderpay_admin());

CREATE POLICY "admin_update_kyc"
  ON public.kyc_verifications FOR UPDATE
  TO authenticated
  USING (public.is_borderpay_admin())
  WITH CHECK (public.is_borderpay_admin());

-- notifications
CREATE POLICY "admin_read_all_notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (public.is_borderpay_admin());

CREATE POLICY "admin_manage_notifications"
  ON public.notifications FOR ALL
  TO authenticated
  USING (public.is_borderpay_admin())
  WITH CHECK (public.is_borderpay_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (run manually after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Confirm no public RLS policy still references user_metadata:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public' AND qual LIKE '%user_metadata%';
--    -- Expected: 0 rows
--
-- 2. Confirm the 12 admin policies exist and reference is_borderpay_admin:
--    SELECT tablename, policyname, qual FROM pg_policies
--    WHERE schemaname='public' AND policyname LIKE 'admin_%'
--    ORDER BY tablename, policyname;
--    -- Expected: 12 rows, all with qual referencing is_borderpay_admin
-- ════════════════════════════════════════════════════════════════════════════

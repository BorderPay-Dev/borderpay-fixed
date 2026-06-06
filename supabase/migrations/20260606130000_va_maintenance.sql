-- Virtual-account maintenance fees (#3) — SOURCE ONLY, NOT YET APPLIED.
--
-- After activation, each ACTIVE virtual account incurs a monthly maintenance
-- fee ($2.00 USD per account, no markup — the raw provider cost) debited
-- directly from the user's USD wallet balance at the start of the month. If the
-- balance can't cover it, the account is flagged `maintenance_overdue` and
-- OUTBOUND money movement is blocked (in bridge-transfer) until topped up.
-- Inbound/top-ups stay open so the user can clear the balance.
--
-- A monthly cron (not wired here) calls charge_va_maintenance(user_id) for each
-- activated user. Applying this migration is a separate, explicitly-gated step.
-- NOTE: confirm the exact VA + balance table/column names against live schema
-- before applying.

-- 1) Overdue flag + bookkeeping on user_profiles.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS maintenance_overdue        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_last_charged_at timestamptz;

-- 2) Maintenance charge ledger (one row per user per monthly period).
CREATE TABLE IF NOT EXISTS public.va_maintenance_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  period_month    date NOT NULL,                 -- first day of the charged month
  active_accounts integer NOT NULL DEFAULT 0,
  amount_usd_minor integer NOT NULL DEFAULT 0,   -- cents
  status          text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('paid', 'unpaid')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_month)
);
ALTER TABLE public.va_maintenance_charges ENABLE ROW LEVEL SECURITY;

-- 3) Charge RPC. Computes active-VA maintenance, attempts a USD wallet debit,
--    sets/clears maintenance_overdue, and records the ledger row. $2.00/account.
CREATE OR REPLACE FUNCTION public.charge_va_maintenance(p_user_id uuid)
RETURNS TABLE (charged boolean, amount_usd_minor integer, overdue boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active   integer := 0;
  v_fee      integer := 0;       -- cents
  v_balance  integer := 0;       -- cents (USD VA available balance)
  v_period   date := date_trunc('month', now())::date;
  v_paid     boolean := false;
BEGIN
  -- Active virtual accounts for this user.
  SELECT COUNT(*) INTO v_active
    FROM public.bridge_virtual_accounts
   WHERE user_id = p_user_id AND status = 'active';

  v_fee := v_active * 200;  -- $2.00 per active account, no markup

  IF v_fee = 0 THEN
    UPDATE public.user_profiles
       SET maintenance_overdue = false, maintenance_last_charged_at = now()
     WHERE id = p_user_id;
    RETURN QUERY SELECT false, 0, false;
    RETURN;
  END IF;

  -- Available USD wallet balance (minor units).
  SELECT COALESCE(SUM(available_balance_minor), 0) INTO v_balance
    FROM public.bridge_virtual_account_balances
   WHERE user_id = p_user_id AND currency = 'USD';

  IF v_balance >= v_fee THEN
    -- Debit the USD balance (oldest/first USD account row).
    UPDATE public.bridge_virtual_account_balances
       SET available_balance_minor = available_balance_minor - v_fee
     WHERE id = (
       SELECT id FROM public.bridge_virtual_account_balances
        WHERE user_id = p_user_id AND currency = 'USD'
        ORDER BY available_balance_minor DESC
        LIMIT 1
     );
    v_paid := true;
  END IF;

  INSERT INTO public.va_maintenance_charges (user_id, period_month, active_accounts, amount_usd_minor, status)
  VALUES (p_user_id, v_period, v_active, v_fee, CASE WHEN v_paid THEN 'paid' ELSE 'unpaid' END)
  ON CONFLICT (user_id, period_month)
  DO UPDATE SET active_accounts = EXCLUDED.active_accounts,
                amount_usd_minor = EXCLUDED.amount_usd_minor,
                status = EXCLUDED.status;

  UPDATE public.user_profiles
     SET maintenance_overdue = NOT v_paid,
         maintenance_last_charged_at = now()
   WHERE id = p_user_id;

  RETURN QUERY SELECT v_paid, v_fee, (NOT v_paid);
END
$$;

REVOKE ALL ON FUNCTION public.charge_va_maintenance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.charge_va_maintenance(uuid) TO service_role;

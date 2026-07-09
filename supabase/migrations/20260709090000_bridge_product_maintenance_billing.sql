-- Bridge product maintenance billing.
--
-- Additive replacement for the earlier VA-only maintenance RPC. This function
-- charges active product inventory, not user approval state:
--   • Virtual accounts: USD/EUR/GBP = $2.00 each, MXN = $1.50, BRL/COP = $1.80
--   • Stablecoin wallets: USDC/USDT = $0.25 each
--
-- Transaction fees remain separate:
--   • VA receiving/on-ramp developer fee = 2.5%
--   • Crypto-to-crypto payout = $1.00 flat + 0.25% orchestration
--   • USDT support = 0.10% of USDT transaction amount
--
-- This migration does not create a cron and does not block transfers. Ops can
-- run charge_bridge_product_maintenance(user_id) from the monthly job on/around
-- the 3rd after validating balances and reconciliation reports.

CREATE TABLE IF NOT EXISTS public.bridge_product_maintenance_charges (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_month          date NOT NULL,
  virtual_account_count integer NOT NULL DEFAULT 0,
  wallet_count          integer NOT NULL DEFAULT 0,
  amount_usd_minor      integer NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('paid', 'unpaid')),
  line_items            jsonb NOT NULL DEFAULT '[]'::jsonb,
  charged_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_month)
);

ALTER TABLE public.bridge_product_maintenance_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bpmc_owner_read ON public.bridge_product_maintenance_charges;
CREATE POLICY bpmc_owner_read ON public.bridge_product_maintenance_charges
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS bpmc_admin_read ON public.bridge_product_maintenance_charges;
CREATE POLICY bpmc_admin_read ON public.bridge_product_maintenance_charges
  FOR SELECT TO authenticated
  USING (public.is_borderpay_admin());

DROP POLICY IF EXISTS bpmc_service_role ON public.bridge_product_maintenance_charges;
CREATE POLICY bpmc_service_role ON public.bridge_product_maintenance_charges
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_bpmc_updated ON public.bridge_product_maintenance_charges;
CREATE TRIGGER trg_bpmc_updated
  BEFORE UPDATE ON public.bridge_product_maintenance_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.charge_bridge_product_maintenance(p_user_id uuid)
RETURNS TABLE (
  charged boolean,
  amount_usd_minor integer,
  virtual_account_count integer,
  wallet_count integer,
  overdue boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period        date := date_trunc('month', now())::date;
  v_existing      public.bridge_product_maintenance_charges%rowtype;
  v_va_count      integer := 0;
  v_wallet_count  integer := 0;
  v_va_minor      integer := 0;
  v_wallet_minor  integer := 0;
  v_amount        integer := 0;
  v_balance       public.bridge_virtual_account_balances%rowtype;
  v_paid          boolean := false;
  v_line_items    jsonb := '[]'::jsonb;
  v_event_id      text;
  v_balance_after bigint;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'charge_bridge_product_maintenance: p_user_id is required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.bridge_product_maintenance_charges
   WHERE user_id = p_user_id
     AND period_month = v_period;

  IF FOUND AND v_existing.status = 'paid' THEN
    RETURN QUERY SELECT
      false,
      v_existing.amount_usd_minor,
      v_existing.virtual_account_count,
      v_existing.wallet_count,
      false;
    RETURN;
  END IF;

  SELECT COUNT(*),
         COALESCE(SUM(
           CASE upper(currency)
             WHEN 'MXN' THEN 150
             WHEN 'BRL' THEN 180
             WHEN 'COP' THEN 180
             ELSE 200
           END
         ), 0)::integer
    INTO v_va_count, v_va_minor
    FROM public.bridge_virtual_accounts
   WHERE status = 'active'
     AND (user_id = p_user_id OR business_user_id = p_user_id);

  SELECT COUNT(*),
         (COUNT(*) * 25)::integer
    INTO v_wallet_count, v_wallet_minor
    FROM public.bridge_wallets
   WHERE status = 'active'
     AND upper(currency) IN ('USDC', 'USDT')
     AND (user_id = p_user_id OR business_user_id = p_user_id);

  v_amount := v_va_minor + v_wallet_minor;
  v_line_items := jsonb_build_array(
    jsonb_build_object(
      'product', 'virtual_account',
      'count', v_va_count,
      'amount_usd_minor', v_va_minor
    ),
    jsonb_build_object(
      'product', 'stablecoin_wallet',
      'count', v_wallet_count,
      'unit_amount_usd_minor', 25,
      'amount_usd_minor', v_wallet_minor
    )
  );

  IF v_amount = 0 THEN
    INSERT INTO public.bridge_product_maintenance_charges (
      user_id, period_month, virtual_account_count, wallet_count,
      amount_usd_minor, status, line_items, charged_at
    )
    VALUES (p_user_id, v_period, 0, 0, 0, 'paid', v_line_items, now())
    ON CONFLICT (user_id, period_month)
    DO UPDATE SET virtual_account_count = EXCLUDED.virtual_account_count,
                  wallet_count = EXCLUDED.wallet_count,
                  amount_usd_minor = EXCLUDED.amount_usd_minor,
                  status = EXCLUDED.status,
                  line_items = EXCLUDED.line_items,
                  charged_at = EXCLUDED.charged_at;

    UPDATE public.user_profiles
       SET maintenance_overdue = false,
           maintenance_last_charged_at = now()
     WHERE id = p_user_id;

    RETURN QUERY SELECT false, 0, 0, 0, false;
    RETURN;
  END IF;

  SELECT *
    INTO v_balance
    FROM public.bridge_virtual_account_balances
   WHERE currency = 'USD'
     AND (user_id = p_user_id OR business_user_id = p_user_id)
   ORDER BY available_balance_minor DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND AND v_balance.available_balance_minor >= v_amount THEN
    UPDATE public.bridge_virtual_account_balances
       SET available_balance_minor = available_balance_minor - v_amount,
           updated_at = now()
     WHERE id = v_balance.id
     RETURNING available_balance_minor INTO v_balance_after;

    v_event_id := 'bridge_product_maintenance:' || v_period::text || ':' || p_user_id::text;
    INSERT INTO public.bridge_balance_ledger (
      event_id, entity_type, entity_id, user_id, business_user_id,
      currency, amount_minor, direction, balance_after_minor, metadata
    )
    VALUES (
      v_event_id,
      'wallet',
      'bridge_product_maintenance',
      v_balance.user_id,
      v_balance.business_user_id,
      'USD',
      v_amount,
      'debit',
      v_balance_after,
      jsonb_build_object(
        'period_month', v_period,
        'line_items', v_line_items,
        'reason', 'monthly_bridge_product_maintenance'
      )
    )
    ON CONFLICT (event_id) DO NOTHING;

    v_paid := true;
  END IF;

  INSERT INTO public.bridge_product_maintenance_charges (
    user_id, period_month, virtual_account_count, wallet_count,
    amount_usd_minor, status, line_items, charged_at
  )
  VALUES (
    p_user_id, v_period, v_va_count, v_wallet_count,
    v_amount, CASE WHEN v_paid THEN 'paid' ELSE 'unpaid' END,
    v_line_items, CASE WHEN v_paid THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id, period_month)
  DO UPDATE SET virtual_account_count = EXCLUDED.virtual_account_count,
                wallet_count = EXCLUDED.wallet_count,
                amount_usd_minor = EXCLUDED.amount_usd_minor,
                status = EXCLUDED.status,
                line_items = EXCLUDED.line_items,
                charged_at = EXCLUDED.charged_at;

  UPDATE public.user_profiles
     SET maintenance_overdue = NOT v_paid,
         maintenance_last_charged_at = now()
   WHERE id = p_user_id;

  RETURN QUERY SELECT v_paid, v_amount, v_va_count, v_wallet_count, (NOT v_paid);
END
$$;

REVOKE ALL ON FUNCTION public.charge_bridge_product_maintenance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_bridge_product_maintenance(uuid) TO service_role;

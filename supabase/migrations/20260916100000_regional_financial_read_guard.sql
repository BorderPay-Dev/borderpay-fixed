-- Use the same authoritative region as the wallet asset policies.
-- Preserve the release control and fresh EEA wallet-access requirement.
CREATE OR REPLACE FUNCTION public.can_read_bridge_financial_data(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_enforcement_enabled boolean := false;
  v_customer_id text;
  v_approved boolean := false;
  v_region text;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN false;
  END IF;
  IF public.is_borderpay_admin() THEN RETURN true; END IF;

  SELECT enforcement_enabled INTO v_enforcement_enabled
  FROM public.bridge_eea_sca_runtime_control
  WHERE singleton = true;

  IF NOT coalesce(v_enforcement_enabled, false) THEN RETURN true; END IF;

  SELECT
    CASE WHEN up.account_type = 'business'
      THEN coalesce(bp.bridge_customer_id, up.bridge_customer_id)
      ELSE up.bridge_customer_id END,
    CASE WHEN up.account_type = 'business'
      THEN lower(coalesce(bp.bridge_kyb_status, '')) = 'approved'
      ELSE lower(coalesce(up.bridge_kyc_status, '')) = 'approved' END
  INTO v_customer_id, v_approved
  FROM public.user_profiles up
  LEFT JOIN public.business_profiles bp ON bp.user_id = up.id
  WHERE up.id = p_user_id;

  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT v_approved THEN RETURN true; END IF;
  IF nullif(btrim(v_customer_id), '') IS NULL THEN RETURN false; END IF;

  v_region := public.borderpay_wallet_region(p_user_id);
  IF v_region = 'non_eea' THEN RETURN true; END IF;
  IF v_region = 'eea' THEN
    RETURN coalesce(public.has_fresh_sca_wallet_access(p_user_id), false);
  END IF;
  RETURN false;
END;
$function$;

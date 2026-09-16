CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.invoke_wallet_scope_refresh()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_token text;
  v_payload text;
  v_role text;
  v_request_id bigint;
BEGIN
  -- Reuse a server-held credential; never return it in SQL results.
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $query$
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name IN ('borderpay_wallet_scope_service_key',
                     'service_role_key', 'supabase_service_role_key')
      ORDER BY CASE WHEN name = 'borderpay_wallet_scope_service_key' THEN 0 ELSE 1 END
      LIMIT 1
    $query$ INTO v_token;
  END IF;
  v_token := coalesce(nullif(btrim(v_token), ''),
    nullif(current_setting('app.process_pending_events_jwt', true), ''));
  IF v_token IS NULL AND to_regprocedure('public.app_config_get(text)') IS NOT NULL THEN
    v_token := nullif(public.app_config_get('worker_auth_token'), '');
  END IF;
  BEGIN
    v_payload := split_part(coalesce(v_token, ''), '.', 2);
    v_role := (convert_from(decode(
      translate(v_payload, '-_', '+/') || repeat('=', (4 - length(v_payload) % 4) % 4),
      'base64'), 'UTF8')::jsonb)->>'role';
  EXCEPTION WHEN OTHERS THEN v_role := NULL;
  END;
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'No service-role credential configured for refresh. Add this project service-role JWT to Supabase Vault as borderpay_wallet_scope_service_key, then rerun.';
  END IF;

  SELECT net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/refresh-wallet-scopes',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.invoke_wallet_scope_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_wallet_scope_refresh() TO service_role;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'borderpay-wallet-scope-refresh') THEN
    PERFORM cron.unschedule('borderpay-wallet-scope-refresh');
  END IF;
  PERFORM cron.schedule('borderpay-wallet-scope-refresh', '* * * * *',
    'SELECT public.invoke_wallet_scope_refresh();');
END;
$schedule$;

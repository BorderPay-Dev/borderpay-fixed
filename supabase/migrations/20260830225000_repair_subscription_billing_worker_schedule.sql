-- Restore the database callback used by the subscription billing schedules.
-- The billing tables and charge function exist in production, but this callback
-- was absent, leaving pg_cron unable to reach the Edge Function.

create or replace function public.invoke_subscription_billing_worker(p_mode text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $invoke_subscription_worker$
declare
  v_url text := coalesce(
    nullif(current_setting('app.subscription_billing_worker_url', true), ''),
    nullif(public.app_config_get('subscription_billing_worker_url'), '')
  );
  v_token text := coalesce(
    nullif(current_setting('app.subscription_billing_worker_token', true), ''),
    nullif(public.app_config_get('worker_auth_token'), '')
  );
begin
  if p_mode not in ('bill_due', 'grace', 'emails', 'events') then
    raise exception 'Unsupported subscription worker mode: %', p_mode;
  end if;

  if v_url is null or v_token is null then
    raise exception 'Subscription billing worker is not configured';
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 120000
  );
end;
$invoke_subscription_worker$;

revoke all on function public.invoke_subscription_billing_worker(text)
  from public, anon, authenticated;
grant execute on function public.invoke_subscription_billing_worker(text)
  to service_role;

do $reschedule_subscription_billing$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname in (
      'subscription-billing-daily',
      'subscription-grace-daily',
      'subscription-delivery-drain',
      'subscription-webhook-drain'
    )
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'subscription-billing-daily',
    '10 0 * * *',
    $job$select public.invoke_subscription_billing_worker('bill_due');$job$
  );
  perform cron.schedule(
    'subscription-grace-daily',
    '25 0 * * *',
    $job$select public.invoke_subscription_billing_worker('grace');$job$
  );
  perform cron.schedule(
    'subscription-delivery-drain',
    '*/5 * * * *',
    $job$select public.invoke_subscription_billing_worker('emails');$job$
  );
  perform cron.schedule(
    'subscription-webhook-drain',
    '*/5 * * * *',
    $job$select public.invoke_subscription_billing_worker('events');$job$
  );
end;
$reschedule_subscription_billing$;

notify pgrst, 'reload schema';

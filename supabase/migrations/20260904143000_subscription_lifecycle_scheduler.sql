-- Restore the production subscription lifecycle scheduler. The bearer token
-- is resolved inside Postgres at execution time and is never embedded here.
begin;

do $unschedule_existing$
declare
  job record;
begin
  for job in
    select jobid
    from cron.job
    where jobname in (
      'subscription-billing-daily',
      'subscription-grace-daily',
      'subscription-delivery-drain',
      'subscription-webhook-drain'
    )
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end;
$unschedule_existing$;

select cron.schedule(
  'subscription-billing-daily',
  '10 0 * * *',
  $job$select net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/subscription-billing-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || public.app_config_get('worker_auth_token')
    ),
    body := '{"mode":"bill_due"}'::jsonb,
    timeout_milliseconds := 120000
  );$job$
);

select cron.schedule(
  'subscription-grace-daily',
  '25 0 * * *',
  $job$select net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/subscription-billing-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || public.app_config_get('worker_auth_token')
    ),
    body := '{"mode":"grace"}'::jsonb,
    timeout_milliseconds := 120000
  );$job$
);

select cron.schedule(
  'subscription-delivery-drain',
  '*/5 * * * *',
  $job$select net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/subscription-billing-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || public.app_config_get('worker_auth_token')
    ),
    body := '{"mode":"emails"}'::jsonb,
    timeout_milliseconds := 120000
  );$job$
);

select cron.schedule(
  'subscription-webhook-drain',
  '*/5 * * * *',
  $job$select net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/subscription-billing-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || public.app_config_get('worker_auth_token')
    ),
    body := '{"mode":"events"}'::jsonb,
    timeout_milliseconds := 120000
  );$job$
);

commit;

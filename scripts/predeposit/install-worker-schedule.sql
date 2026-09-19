-- Run after the worker endpoint and matching Vault/Edge credential are installed.
-- This schedules queue processing, not payments. It does not enable the invoice gate.
do $$
begin
 if not exists(select 1 from cron.job where jobname='borderpay-predeposit-worker') then
  perform cron.schedule('borderpay-predeposit-worker','* * * * *','select public.invoke_predeposit_worker();');
 end if;
end;$$;
select jobname,schedule,active from cron.job where jobname='borderpay-predeposit-worker';

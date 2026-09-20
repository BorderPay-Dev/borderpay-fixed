begin;
create or replace function public.predeposit_ai_config() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'endpoint',(select decrypted_secret from vault.decrypted_secrets where name='borderpay_predeposit_ai_endpoint' limit 1),
 'apiKey',(select decrypted_secret from vault.decrypted_secrets where name='borderpay_predeposit_ai_key' limit 1),
 'deployment',(select decrypted_secret from vault.decrypted_secrets where name='borderpay_predeposit_ai_deployment' limit 1),
 'apiVersion',coalesce((select decrypted_secret from vault.decrypted_secrets where name='borderpay_predeposit_ai_api_version' limit 1),'2024-10-21'),
 'requestProfile',coalesce((select decrypted_secret from vault.decrypted_secrets where name='borderpay_predeposit_ai_request_profile' limit 1),'standard'));
$$;
revoke all on function public.predeposit_ai_config() from public,anon,authenticated;
grant execute on function public.predeposit_ai_config() to service_role;
commit;

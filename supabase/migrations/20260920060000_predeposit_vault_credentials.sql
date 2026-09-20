begin;
create function public.authorize_predeposit_worker(p_token text) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare expected text;
begin
 if p_token is null or length(p_token)<32 or length(p_token)>128 then return false;end if;
 select decrypted_secret into expected from vault.decrypted_secrets where name='borderpay_predeposit_worker_token' limit 1;
 if expected is null or length(expected)<32 then return false;end if;
 return sha256(convert_to(expected,'UTF8'))=sha256(convert_to(p_token,'UTF8'));
end;$$;
create function public.predeposit_ocr_config() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'endpoint',(select decrypted_secret from vault.decrypted_secrets where name='borderpay_document_intelligence_endpoint' limit 1),
 'apiKey',(select decrypted_secret from vault.decrypted_secrets where name='borderpay_document_intelligence_key' limit 1)
 )
$$;
revoke all on function public.authorize_predeposit_worker(text),public.predeposit_ocr_config() from public,anon,authenticated;
grant execute on function public.authorize_predeposit_worker(text),public.predeposit_ocr_config() to service_role;
commit;

begin;
create or replace function public.predeposit_ocr_config() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare provider text;prefix text;
begin
 select decrypted_secret into provider from vault.decrypted_secrets where name='borderpay_predeposit_ocr_provider' limit 1;
 provider:=coalesce(nullif(btrim(provider),''),'document_intelligence');
 if provider not in ('document_intelligence','content_understanding') then raise exception 'Invalid OCR provider configuration';end if;
 prefix:=case when provider='content_understanding' then 'borderpay_content_understanding_' else 'borderpay_document_intelligence_' end;
 return jsonb_build_object('provider',provider,
  'endpoint',(select decrypted_secret from vault.decrypted_secrets where name=prefix||'endpoint' limit 1),
  'apiKey',(select decrypted_secret from vault.decrypted_secrets where name=prefix||'key' limit 1));
end;$$;
revoke all on function public.predeposit_ocr_config() from public,anon,authenticated;
grant execute on function public.predeposit_ocr_config() to service_role;
commit;

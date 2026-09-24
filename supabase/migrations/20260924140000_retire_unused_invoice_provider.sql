-- Remove the retired provider from new invoice submissions. Existing records are retained.
begin;
CREATE OR REPLACE FUNCTION public.submit_predeposit_draft(p_owner uuid, p_draft uuid, p_version integer, p_invoice jsonb, p_context jsonb, p_sha text, p_buyer_hash text, p_documents jsonb, p_provider text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d public.predeposit_drafts%rowtype;i public.predeposit_invoices%rowtype;doc jsonb;
begin
 select * into d from public.predeposit_drafts where id=p_draft and owner_user_id=p_owner for update;
 if not found or d.version<>p_version then raise exception 'Draft changed; reload before submitting';end if;
 select * into i from public.predeposit_invoices where owner_user_id=p_owner and invoice_number=d.invoice_number and revision=d.version;
 if found then return to_jsonb(i);end if;
 if p_provider not in ('bridge','borderless') then raise exception 'Unsupported provider';end if;
 if (p_invoice->>'revision')::integer<>d.version then raise exception 'Invoice revision does not match draft';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_buyer_hash||(p_invoice->>'currency'),0));
 p_context:=jsonb_set(p_context,'{history}',(
 select jsonb_build_object('available',true,'buyer_invoice_count_30d',count(*),'same_currency_total_minor_30d',coalesce(sum(total_minor),0))
 from (select distinct on(invoice_number) total_minor from public.predeposit_invoices
 where owner_user_id=p_owner and buyer_identity_hash=p_buyer_hash and currency=p_invoice->>'currency'
 and created_at>now()-interval '30 days' and invoice_number<>d.invoice_number and status<>'rejected'
 order by invoice_number,revision desc) histories));
 insert into public.predeposit_invoices(id,draft_id,owner_user_id,invoice_number,revision,currency,total_minor,buyer_identity_hash,payload,payload_sha256,policy_version,review_context,provider_key)
 values((p_invoice->>'id')::uuid,d.id,p_owner,d.invoice_number,d.version,p_invoice->>'currency',(p_context->>'total_minor')::bigint,p_buyer_hash,p_invoice,p_sha,'borderpay-predeposit-2.4.0',p_context,p_provider) returning * into i;
 for doc in select value from jsonb_array_elements(p_documents) loop
  if not exists(select 1 from public.predeposit_assets a where a.id=(doc->>'id')::uuid and a.owner_user_id=p_owner and a.sha256=doc->>'sha256' and a.storage_path=doc->>'storage_path' and a.kind=doc->>'kind' and a.scan_status<>'rejected') then raise exception 'Evidence ownership or hash mismatch';end if;
  insert into public.predeposit_documents(invoice_id,owner_user_id,kind,storage_path,sha256,mime_type,size_bytes)
  values(i.id,p_owner,doc->>'kind',doc->>'storage_path',doc->>'sha256',doc->>'mime_type',(doc->>'size_bytes')::integer);
 end loop;
 return to_jsonb(i);
end;$function$

commit;

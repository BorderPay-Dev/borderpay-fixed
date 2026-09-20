begin;
-- The optional hub reviews paperwork; it does not make deposit-clearance decisions.
do $$
begin
 if not exists(select 1 from public.predeposit_policy where singleton=true and mode='observe')
 then raise exception 'Automatic document review requires the optional observe-mode hub'; end if;
end;
$$;
alter table public.predeposit_policy add constraint predeposit_document_scope_observe_only
 check(coalesce(config->>'review_scope','') <> 'document_checks' or mode='observe');
update public.predeposit_policy
set config=jsonb_set(jsonb_set(config,'{review_mode}','"automatic"'::jsonb),'{review_scope}','"document_checks"'::jsonb),
    updated_at=now()
where singleton=true;
commit;

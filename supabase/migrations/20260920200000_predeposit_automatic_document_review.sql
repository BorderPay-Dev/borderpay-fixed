begin;
-- Optional paperwork review only. Never gate existing receiving-account access.
do $$
begin
 if not exists(select 1 from public.predeposit_policy where singleton=true)
 then raise exception 'Invoice review policy is missing'; end if;
end;
$$;
update public.predeposit_policy
set config=jsonb_set(config,'{review_mode}','"automatic"'::jsonb),
    updated_at=now()
where singleton=true;
commit;

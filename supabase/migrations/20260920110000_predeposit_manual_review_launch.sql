begin;
-- Explicit launch mode, independent of whether an AI screening result passes.
alter table public.predeposit_policy add constraint predeposit_review_mode_valid
 check(config->>'review_mode' is null or config->>'review_mode' in ('manual','automatic'));
update public.predeposit_policy set config=jsonb_set(config,'{review_mode}','"manual"'::jsonb),updated_at=now() where singleton;
create function public.predeposit_require_operator_approval()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.decision='approved' and coalesce((select config->>'review_mode' from public.predeposit_policy where singleton),'manual')<>'automatic' then
  if new.actor_type<>'compliance' or new.actor_user_id is null or not exists(
   select 1 from public.admin_users where user_id=new.actor_user_id and upper(role::text) in ('ADMIN_SUPER','SUPER_ADMIN','ADMIN','COMPLIANCE','ADMIN_COMPLIANCE')
  ) then raise exception 'Manual review mode requires approval by an authorized compliance operator';end if;
 end if;
 return new;
end;$$;
create trigger predeposit_review_mode_guard before insert on public.predeposit_reviews for each row execute function public.predeposit_require_operator_approval();
revoke all on function public.predeposit_require_operator_approval() from public,anon,authenticated;
commit;

-- Every approved business participates in the maintenance cycle for the
-- calendar month in which KYB approval is recorded. This migration does not
-- collect funds, create payment links, or send email; the authenticated
-- billing worker performs those idempotent provider operations.
begin;

create or replace function public.subscription_current_month_end(p_date date)
returns date
language sql
immutable
strict
as $$
  select (date_trunc('month', p_date::timestamp) + interval '1 month - 1 day')::date
$$;

create or replace function public.sync_approved_business_maintenance_subscriptions(
  p_billing_period date default public.subscription_current_month_end(current_date),
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $sync_approved_business_maintenance_subscriptions$
declare
  r record;
  eligible_count integer := 0;
  created_count integer := 0;
  pulled_forward_count integer := 0;
  skipped_count integer := 0;
  existed boolean;
  prior_date date;
begin
  if p_billing_period <> public.subscription_current_month_end(p_billing_period) then
    raise exception 'Billing period must be the final day of its calendar month';
  end if;

  for r in
    select up.id
    from public.user_profiles up
    join public.business_profiles bp on bp.user_id = up.id
    join auth.users au on au.id = up.id and au.deleted_at is null
    where lower(coalesce(up.account_type::text, '')) = 'business'
      and lower(coalesce(up.kyc_status::text, '')) = 'verified'
      and lower(coalesce(bp.bridge_kyb_status::text, '')) in ('approved', 'verified')
      and lower(coalesce(up.account_status::text, 'active')) not in (
        'paused', 'frozen', 'offboarded', 'rejected', 'closed', 'deleted', 'suspended'
      )
      and lower(coalesce(up.bridge_account_status::text, 'active')) not in (
        'paused', 'frozen', 'offboarded', 'rejected', 'closed', 'deleted', 'suspended'
      )
    order by up.id
  loop
    eligible_count := eligible_count + 1;
    select true, next_billing_date
      into existed, prior_date
      from public.subscriptions
      where user_id = r.id;

    if p_dry_run then
      if not coalesce(existed, false) then
        created_count := created_count + 1;
      elsif prior_date > p_billing_period then
        pulled_forward_count := pulled_forward_count + 1;
      else
        skipped_count := skipped_count + 1;
      end if;
      existed := false;
      prior_date := null;
      continue;
    end if;

    perform public.ensure_internal_subscription(r.id, p_billing_period, false);

    if not coalesce(existed, false) then
      created_count := created_count + 1;
    else
      update public.subscriptions
      set next_billing_date = p_billing_period,
          updated_at = now()
      where user_id = r.id
        and account_type = 'business'
        and status = 'active'
        and last_billed_at is null
        and next_billing_date > p_billing_period;
      if found then
        pulled_forward_count := pulled_forward_count + 1;
      else
        skipped_count := skipped_count + 1;
      end if;
    end if;

    existed := false;
    prior_date := null;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'billing_period', p_billing_period,
    'eligible', eligible_count,
    'created', created_count,
    'pulled_forward', pulled_forward_count,
    'unchanged', skipped_count
  );
end;
$sync_approved_business_maintenance_subscriptions$;

revoke all on function public.sync_approved_business_maintenance_subscriptions(date,boolean)
  from public, anon, authenticated;
grant execute on function public.sync_approved_business_maintenance_subscriptions(date,boolean)
  to service_role;

-- Preserve individual legacy behavior. A business becomes billable in its
-- approval month, including approval on the final day of that month.
create or replace function public.on_subscription_verification_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $on_subscription_verification_change$
begin
  if tg_table_name = 'user_profiles' then
    if lower(coalesce(new.kyc_status::text, '')) = 'verified'
       and (tg_op = 'INSERT' or lower(coalesce(old.kyc_status::text, '')) <> 'verified') then
      if new.account_type::text = 'individual' then
        perform public.ensure_internal_subscription(
          new.id,
          public.subscription_next_month_end(current_date),
          true
        );
      elsif new.account_type::text = 'business' and exists (
        select 1 from public.business_profiles bp
        where bp.user_id = new.id
          and lower(coalesce(bp.bridge_kyb_status::text, '')) in ('approved', 'verified')
      ) then
        perform public.ensure_internal_subscription(
          new.id,
          public.subscription_current_month_end(current_date),
          true
        );
      end if;
    end if;
  elsif tg_table_name = 'business_profiles' then
    if lower(coalesce(new.bridge_kyb_status::text, '')) in ('approved', 'verified')
       and (tg_op = 'INSERT' or lower(coalesce(old.bridge_kyb_status::text, '')) not in ('approved', 'verified'))
       and exists (
         select 1 from public.user_profiles up
         where up.id = new.user_id
           and lower(coalesce(up.account_type::text, '')) = 'business'
           and lower(coalesce(up.kyc_status::text, '')) = 'verified'
           and lower(coalesce(up.account_status::text, 'active')) not in (
             'paused', 'frozen', 'offboarded', 'rejected', 'closed', 'deleted', 'suspended'
           )
           and lower(coalesce(up.bridge_account_status::text, 'active')) not in (
             'paused', 'frozen', 'offboarded', 'rejected', 'closed', 'deleted', 'suspended'
           )
       ) then
      perform public.ensure_internal_subscription(
        new.user_id,
        public.subscription_current_month_end(current_date),
        true
      );
    end if;
  end if;
  return new;
end;
$on_subscription_verification_change$;

commit;

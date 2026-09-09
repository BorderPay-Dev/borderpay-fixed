-- Queue the September 2026 price-change notice only for active, verified
-- Business accounts. Delivery remains rate-limited by the existing worker.

do $safety$
declare
  v_eligible bigint;
begin
  select count(*) into v_eligible
  from public.subscriptions s
  join public.user_profiles up on up.id = s.user_id
  join public.business_profiles bp on bp.user_id = s.user_id
  where s.status = 'active'
    and s.account_type = 'business'
    and up.account_type::text = 'business'
    and lower(coalesce(up.kyc_status::text, '')) = 'verified'
    and lower(coalesce(bp.bridge_kyb_status, '')) in ('approved', 'verified')
    and nullif(trim(coalesce(up.email, '')), '') is not null;

  if v_eligible > 1000 then
    raise exception 'Refusing to queue unexpected Business announcement population: %', v_eligible;
  end if;
end;
$safety$;

insert into public.subscription_email_jobs(
  user_id,
  template,
  recipient,
  props,
  idempotency_key
)
select
  s.user_id,
  'business.subscription_maintenance_announcement',
  lower(trim(up.email)),
  jsonb_build_object(
    'customer_name', coalesce(bp.company_name, up.full_name),
    'effective_date', 'September 1, 2026',
    'billing_start_date', case
      when s.next_billing_date < date '2026-09-01'
        then public.subscription_next_month_end(s.next_billing_date)
      else s.next_billing_date
    end
  ),
  'subscription:business_fee_change:2026-09-01:' || s.user_id::text
from public.subscriptions s
join public.user_profiles up on up.id = s.user_id
join public.business_profiles bp on bp.user_id = s.user_id
where s.status = 'active'
  and s.account_type = 'business'
  and up.account_type::text = 'business'
  and lower(coalesce(up.kyc_status::text, '')) = 'verified'
  and lower(coalesce(bp.bridge_kyb_status, '')) in ('approved', 'verified')
  and nullif(trim(coalesce(up.email, '')), '') is not null
on conflict (idempotency_key) do nothing;

do $assertions$
begin
  if exists (
    select 1
    from public.subscription_email_jobs j
    left join public.user_profiles up on up.id = j.user_id
    left join public.business_profiles bp on bp.user_id = j.user_id
    where j.idempotency_key like 'subscription:business_fee_change:2026-09-01:%'
      and (
        j.template <> 'business.subscription_maintenance_announcement'
        or up.account_type::text <> 'business'
        or lower(coalesce(up.kyc_status::text, '')) <> 'verified'
        or lower(coalesce(bp.bridge_kyb_status, '')) not in ('approved', 'verified')
      )
  ) then
    raise exception 'Business fee announcement recipient boundary violated';
  end if;
end;
$assertions$;

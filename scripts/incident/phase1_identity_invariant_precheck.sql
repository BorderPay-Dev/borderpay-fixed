-- PHASE 1 PRECHECK (READ-ONLY)
-- Purpose: classify approved entities missing bridge_customer_id.
-- Safe: read-only.

-- 1) High-level blocker counts
select 'user_profiles' as table_name,
       count(*) filter (where bridge_kyc_status = 'approved') as approved_total,
       count(*) filter (where bridge_kyc_status = 'approved' and bridge_customer_id is null) as approved_without_customer
from public.user_profiles
union all
select 'business_profiles',
       count(*) filter (where bridge_kyb_status = 'approved'),
       count(*) filter (where bridge_kyb_status = 'approved' and bridge_customer_id is null)
from public.business_profiles;

-- 2) Candidate rows (individual)
select up.id as user_id,
       up.email,
       up.full_name,
       up.bridge_kyc_status,
       up.bridge_kyc_link_id,
       up.bridge_kyc_completed_at,
       up.updated_at
from public.user_profiles up
where up.bridge_kyc_status = 'approved'
  and up.bridge_customer_id is null
order by up.updated_at desc nulls last;

-- 3) Candidate rows (business)
select bp.user_id,
       bp.company_name,
       bp.bridge_kyb_status,
       bp.bridge_kyb_link_id,
       bp.bridge_kyb_completed_at,
       bp.updated_at
from public.business_profiles bp
where bp.bridge_kyb_status = 'approved'
  and bp.bridge_customer_id is null
order by bp.updated_at desc nulls last;

-- 4) Ownership ambiguity (must be zero before and after)
with ids as (
  select bridge_customer_id from public.user_profiles where bridge_customer_id is not null
  union all
  select bridge_customer_id from public.business_profiles where bridge_customer_id is not null
),
dup as (
  select bridge_customer_id, count(*) as n
  from ids
  group by bridge_customer_id
  having count(*) > 1
)
select count(*) as duplicate_bridge_customer_ids from dup;

-- 5) Cross-table mismatch for business users (must be zero)
with overlap as (
  select up.id as user_id, up.bridge_customer_id as up_customer, bp.bridge_customer_id as bp_customer
  from public.user_profiles up
  join public.business_profiles bp on bp.user_id = up.id
  where up.account_type = 'business'
    and coalesce(up.bridge_customer_id, '') <> coalesce(bp.bridge_customer_id, '')
)
select count(*) as business_profile_customer_mismatch from overlap;


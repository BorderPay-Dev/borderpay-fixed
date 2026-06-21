-- PHASE 1 REPAIR TEMPLATE (DO NOT RUN BLINDLY)
-- Purpose: manual, operator-approved correction of approved rows missing bridge_customer_id.
-- This file is intentionally a template with placeholders and explicit stop points.

-- =============================================================================
-- STEP A: PREPARE BACKUP SNAPSHOT (MUST RUN FIRST)
-- =============================================================================
-- Export these result sets externally (CSV/JSON) before any write:
--
-- select * from public.user_profiles
-- where bridge_kyc_status='approved' and bridge_customer_id is null;
--
-- select * from public.business_profiles
-- where bridge_kyb_status='approved' and bridge_customer_id is null;
--
-- STOP: operator confirmation required.

begin;

-- =============================================================================
-- STEP B: DETERMINISTIC BACKFILL ONLY
-- =============================================================================
-- Replace placeholders with verified mappings from evidence.
-- Never infer customer IDs by heuristics that can collide.

-- Example (individual):
-- update public.user_profiles
--    set bridge_customer_id = 'cust_xxx',
--        updated_at = now()
--  where id = 'user_uuid'
--    and bridge_kyc_status = 'approved'
--    and bridge_customer_id is null;

-- Example (business):
-- update public.business_profiles
--    set bridge_customer_id = 'cust_xxx',
--        updated_at = now()
--  where user_id = 'user_uuid'
--    and bridge_kyb_status = 'approved'
--    and bridge_customer_id is null;
--
-- Optional sync for business record mirror in user_profiles:
-- update public.user_profiles
--    set bridge_customer_id = 'cust_xxx',
--        updated_at = now()
--  where id = 'user_uuid'
--    and account_type='business'
--    and bridge_customer_id is null;

-- STOP: run verification queries before commit.

-- =============================================================================
-- STEP C: FAIL-SAFE DOWNGRADE FOR NON-DETERMINISTIC ROWS
-- =============================================================================
-- Use only if approved row still has no deterministic customer mapping.
-- Safer to block (pending) than risk wrong customer linkage.

-- Individual fallback:
-- update public.user_profiles
--    set bridge_kyc_status = 'pending',
--        kyc_status = 'pending',
--        updated_at = now()
--  where id in (/* unresolved individual user ids */)
--    and bridge_kyc_status = 'approved'
--    and bridge_customer_id is null;

-- Business fallback:
-- update public.business_profiles
--    set bridge_kyb_status = 'pending',
--        updated_at = now()
--  where user_id in (/* unresolved business user ids */)
--    and bridge_kyb_status = 'approved'
--    and bridge_customer_id is null;

-- STOP: run verification queries before commit.

-- =============================================================================
-- STEP D: POST-CHECKS (MUST BE ZERO/ZERO)
-- =============================================================================
-- select 'user_profiles' as table_name,
--        count(*) filter (where bridge_kyc_status='approved' and bridge_customer_id is null) as approved_without_customer
-- from public.user_profiles
-- union all
-- select 'business_profiles',
--        count(*) filter (where bridge_kyb_status='approved' and bridge_customer_id is null)
-- from public.business_profiles;

-- with ids as (
--   select bridge_customer_id from public.user_profiles where bridge_customer_id is not null
--   union all
--   select bridge_customer_id from public.business_profiles where bridge_customer_id is not null
-- )
-- select count(*) as duplicate_bridge_customer_ids
-- from (
--   select bridge_customer_id
--   from ids
--   group by bridge_customer_id
--   having count(*) > 1
-- ) d;

-- If checks pass:
-- commit;
--
-- If checks fail:
-- rollback;

rollback;


# PHASE1_PRECHECK_REPORT

Date: 2026-06-20  
Mode: Read-only precheck (no production mutation)  
Scope: Step 0 only - determine deterministic repairability for approved entities missing `bridge_customer_id`.

## Row counts

1. Affected approved-without-customer rows

- `user_profiles` approved without `bridge_customer_id`: **2**
- `business_profiles` approved without `bridge_customer_id`: **1**
- Total affected profile rows: **3**
- Unique internal user IDs affected: **2**

2. Classification counts

- Category A (deterministic mapping, safe auto-repair): **0**
- Category B (multiple candidate mappings): **0**
- Category C (no deterministic Bridge customer mapping): **3**

## Validation checks

- Duplicate ownership count (`bridge_customer_id` mapped to multiple owners): **0**
- Conflicting ownership count (single internal owner mapped to multiple `bridge_customer_id`): **0**
- Orphan Bridge customers (webhook-observed customer IDs not mapped locally): **7**  
  IDs:
  - `cust_ops_audit`
  - `cust_ops_life`
  - `cust_ops_sync_ok`
  - `d2bfcf17-1f2f-45a7-b13a-0022455a2751`
  - `de412f3c-53c3-4d4a-987e-09d17c9cd7e2`
  - `fdd69ef6-4eda-4128-a10c-1ca0b487e8b1`
  - `test`
- Orphan approved profiles (approved + null customer id): **3**
- Duplicate emails in `user_profiles`: **1 duplicate key** (`demo.business@borderpayafrica.com`, n=2)
- Duplicate emails among affected rows: **1 duplicate key** (`demo.business@borderpayafrica.com`, n=2)
- Duplicate external references:
  - `bridge_kyc_link_id`: none
  - `bridge_kyb_link_id`: none
  - customer `client_reference_id` duplicates in webhook payloads: none

## Deterministic repairability result

No accepted immutable match was found for any affected row across:

- exact email in webhook payloads
- exact email in pending-event payloads
- exact `bridge_kyc_link_id` / `bridge_kyb_link_id` webhook linkage
- exact `client_reference_id == internal_id`
- existing Bridge projection tables (`bridge_wallets`, `bridge_virtual_accounts`) for affected users

Therefore all affected rows are Category C.

## SQL queries executed (read-only)

1. Session check
```sql
select now() as audited_at_utc, current_database() as db, current_user as db_user;
```

2. Affected rows
```sql
with i as (
  select id as internal_id, 'individual'::text as profile_type, email, full_name,
         bridge_kyc_link_id as link_id, bridge_kyc_status as verification_status, updated_at
  from public.user_profiles
  where bridge_kyc_status='approved' and bridge_customer_id is null
),
b as (
  select bp.user_id as internal_id, 'business'::text as profile_type, up.email, bp.company_name as full_name,
         bp.bridge_kyb_link_id as link_id, bp.bridge_kyb_status as verification_status, bp.updated_at
  from public.business_profiles bp
  join public.user_profiles up on up.id=bp.user_id
  where bp.bridge_kyb_status='approved' and bp.bridge_customer_id is null
)
select * from i
union all
select * from b
order by profile_type, updated_at desc nulls last;
```

3. Exact-email candidate mapping from webhook payloads
```sql
with affected as (
  select id as internal_id, 'individual'::text as profile_type, lower(email) as email
  from public.user_profiles
  where bridge_kyc_status='approved' and bridge_customer_id is null
  union all
  select bp.user_id as internal_id, 'business'::text as profile_type, lower(up.email) as email
  from public.business_profiles bp
  join public.user_profiles up on up.id=bp.user_id
  where bp.bridge_kyb_status='approved' and bp.bridge_customer_id is null
),
wh as (
  select coalesce(nullif(payload->'event_object'->>'customer_id',''),
                  nullif(payload->>'event_object_id',''),
                  nullif(payload->'event_object'->>'id','')) as bridge_customer_id,
         lower(nullif(payload->'event_object'->>'email','')) as email,
         event_type, event_id, received_at
  from public.bridge_webhook_events
)
select a.internal_id, a.profile_type, a.email as internal_email,
       w.bridge_customer_id, w.event_type, w.event_id, w.received_at
from affected a
left join wh w on a.email = w.email and w.bridge_customer_id is not null
order by a.internal_id, w.received_at desc nulls last;
```

4. Exact-email candidate mapping from pending-event payloads
```sql
with affected as (
  select id as internal_id, 'individual'::text as profile_type, lower(email) as email
  from public.user_profiles
  where bridge_kyc_status='approved' and bridge_customer_id is null
  union all
  select bp.user_id as internal_id, 'business'::text as profile_type, lower(up.email) as email
  from public.business_profiles bp
  join public.user_profiles up on up.id=bp.user_id
  where bp.bridge_kyb_status='approved' and bp.bridge_customer_id is null
),
pe as (
  select coalesce(nullif(payload->'event_object'->>'customer_id',''),
                  nullif(payload->>'event_object_id',''),
                  nullif(payload->'event_object'->>'id','')) as bridge_customer_id,
         lower(nullif(payload->'event_object'->>'email','')) as email,
         event_type, event_id, created_at
  from public.pending_events
  where source='bridge'
)
select a.internal_id, a.profile_type, a.email as internal_email,
       p.bridge_customer_id, p.event_type, p.event_id, p.created_at
from affected a
left join pe p on a.email = p.email and p.bridge_customer_id is not null
order by a.internal_id, p.created_at desc nulls last;
```

5. Link-ID deterministic mapping check
```sql
with affected as (
  select id as internal_id, 'individual'::text as profile_type, email, bridge_kyc_link_id as link_id
  from public.user_profiles
  where bridge_kyc_status='approved' and bridge_customer_id is null
  union all
  select bp.user_id as internal_id, 'business'::text as profile_type, up.email, bp.bridge_kyb_link_id as link_id
  from public.business_profiles bp
  join public.user_profiles up on up.id=bp.user_id
  where bp.bridge_kyb_status='approved' and bp.bridge_customer_id is null
),
wh as (
  select event_id, event_type, payload->>'event_object_id' as event_object_id,
         payload->'event_object'->>'customer_id' as customer_id
  from public.bridge_webhook_events
  where event_type like 'kyc_link.%'
)
select a.internal_id, a.profile_type, a.email, a.link_id,
       w.customer_id as bridge_customer_candidate, w.event_type, w.event_id
from affected a
left join wh w on a.link_id is not null and a.link_id = w.event_object_id
order by a.internal_id;
```

6. Exact client_reference_id deterministic mapping check
```sql
with affected as (
  select id as internal_id, 'individual'::text as profile_type, email
  from public.user_profiles
  where bridge_kyc_status='approved' and bridge_customer_id is null
  union all
  select bp.user_id as internal_id, 'business'::text as profile_type, up.email
  from public.business_profiles bp
  join public.user_profiles up on up.id=bp.user_id
  where bp.bridge_kyb_status='approved' and bp.bridge_customer_id is null
),
wh as (
  select event_id, event_type, payload->'event_object'->>'client_reference_id' as client_reference_id,
         coalesce(payload->'event_object'->>'customer_id', payload->>'event_object_id', payload->'event_object'->>'id') as customer_id
  from public.bridge_webhook_events
  where event_type like 'customer.%'
)
select a.internal_id, a.profile_type, a.email,
       w.customer_id as bridge_customer_candidate, w.event_type, w.event_id, w.client_reference_id
from affected a
left join wh w on w.client_reference_id = a.internal_id::text
order by a.internal_id;
```

7. Projection-table deterministic mapping check
```sql
with affected as (
  select id as internal_id, 'individual'::text as profile_type, email
  from public.user_profiles
  where bridge_kyc_status='approved' and bridge_customer_id is null
  union all
  select bp.user_id as internal_id, 'business'::text as profile_type, up.email
  from public.business_profiles bp
  join public.user_profiles up on up.id=bp.user_id
  where bp.bridge_kyb_status='approved' and bp.bridge_customer_id is null
),
candidates as (
  select user_id as internal_id, bridge_customer_id, 'bridge_wallets'::text as source_table
  from public.bridge_wallets where bridge_customer_id is not null
  union all
  select user_id as internal_id, bridge_customer_id, 'bridge_virtual_accounts'::text
  from public.bridge_virtual_accounts where bridge_customer_id is not null
)
select a.internal_id, a.profile_type, a.email,
       c.bridge_customer_id as bridge_customer_candidate, c.source_table
from affected a
left join candidates c on c.internal_id = a.internal_id
order by a.internal_id, c.source_table;
```

8. Duplicate ownership count
```sql
with owners as (
  select 'user_profiles'::text as table_name, id as owner_id, bridge_customer_id
  from public.user_profiles where bridge_customer_id is not null
  union all
  select 'business_profiles'::text, user_id as owner_id, bridge_customer_id
  from public.business_profiles where bridge_customer_id is not null
),
d as (
  select bridge_customer_id, count(distinct owner_id) as owner_count
  from owners group by bridge_customer_id
  having count(distinct owner_id) > 1
)
select count(*) as duplicate_ownership_count from d;
```

9. Conflicting ownership count
```sql
with u as (
  select id as internal_id, bridge_customer_id
  from public.user_profiles where bridge_customer_id is not null
),
b as (
  select user_id as internal_id, bridge_customer_id
  from public.business_profiles where bridge_customer_id is not null
),
allm as (select * from u union all select * from b),
d as (
  select internal_id, count(distinct bridge_customer_id) as customer_ids
  from allm group by internal_id
  having count(distinct bridge_customer_id) > 1
)
select count(*) as conflicting_ownership_count from d;
```

10. Orphan Bridge customers from webhook-observed customer IDs
```sql
with wh_customers as (
  select distinct coalesce(nullif(payload->'event_object'->>'customer_id',''),
                           case when event_type like 'customer.%' then nullif(payload->>'event_object_id','') else null end,
                           case when event_type like 'customer.%' then nullif(payload->'event_object'->>'id','') else null end) as bridge_customer_id
  from public.bridge_webhook_events
  where coalesce(nullif(payload->'event_object'->>'customer_id',''),
                 case when event_type like 'customer.%' then nullif(payload->>'event_object_id','') else null end,
                 case when event_type like 'customer.%' then nullif(payload->'event_object'->>'id','') else null end) is not null
),
mapped as (
  select bridge_customer_id from public.user_profiles where bridge_customer_id is not null
  union all
  select bridge_customer_id from public.business_profiles where bridge_customer_id is not null
)
select w.bridge_customer_id
from wh_customers w
where not exists (select 1 from mapped m where m.bridge_customer_id = w.bridge_customer_id)
order by w.bridge_customer_id
limit 50;
```

11. Duplicate email checks
```sql
select lower(email) as email, count(*) as n
from public.user_profiles
where email is not null
group by lower(email)
having count(*) > 1
order by n desc, email;
```

```sql
with affected as (
  select lower(email) as email
  from public.user_profiles
  where bridge_kyc_status='approved' and bridge_customer_id is null
  union all
  select lower(up.email) as email
  from public.business_profiles bp
  join public.user_profiles up on up.id=bp.user_id
  where bp.bridge_kyb_status='approved' and bp.bridge_customer_id is null
)
select email, count(*) as n
from affected
group by email
having count(*) > 1
order by n desc, email;
```

12. Duplicate external reference checks
```sql
with refs as (
  select 'user_profiles.bridge_kyc_link_id'::text as ref_type, bridge_kyc_link_id::text as ref_value
  from public.user_profiles where bridge_kyc_link_id is not null
  union all
  select 'business_profiles.bridge_kyb_link_id', bridge_kyb_link_id::text
  from public.business_profiles where bridge_kyb_link_id is not null
),
d as (
  select ref_type, ref_value, count(*) as n
  from refs group by ref_type, ref_value
  having count(*) > 1
)
select * from d
order by ref_type, n desc, ref_value;
```

```sql
with refs as (
  select payload->'event_object'->>'client_reference_id' as client_reference_id
  from public.bridge_webhook_events
  where event_type like 'customer.%'
    and nullif(payload->'event_object'->>'client_reference_id','') is not null
),
d as (
  select client_reference_id, count(*) as n
  from refs
  group by client_reference_id
  having count(*) > 1
)
select * from d
order by n desc, client_reference_id
limit 20;
```

13. Presence check for affected emails in any stored webhook payload text
```sql
with affected as (
  select lower(email) as email
  from public.user_profiles
  where bridge_kyc_status='approved' and bridge_customer_id is null
  union all
  select lower(up.email) as email
  from public.business_profiles bp
  join public.user_profiles up on up.id=bp.user_id
  where bp.bridge_kyb_status='approved' and bp.bridge_customer_id is null
)
select a.email,
       count(*) filter (where bwe.payload::text ilike '%'||a.email||'%') as webhook_payload_mentions
from affected a
cross join public.bridge_webhook_events bwe
group by a.email
order by a.email;
```

## Risk assessment

- Immediate automated repair risk is **high** because no accepted immutable mapping was found for any affected row.
- Any automatic assignment of `bridge_customer_id` would be speculative and could mis-attribute funds.
- Existing orphan webhook customer IDs suggest historical ops/test activity and require manual adjudication before reuse.

## Recommendation

**MANUAL REVIEW REQUIRED**


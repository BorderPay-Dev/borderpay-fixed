# Root Cause Analysis — Phase 1 (Read-Only)

Date: 2026-06-20  
Scope: approved entities with missing `bridge_customer_id`  
Mode: read-only (no writes, no migrations, no deployments)

## Executive Result

Affected records: **2** (`user_profiles`) + **1** linked approved `business_profiles` row.  
Root-cause classification outcome:

- **A. Legacy test data**: 2/2 affected users
- B. Interrupted onboarding: 0
- C. Bridge API failure: 0
- D. Webhook processing failure: 0
- E. Manual database modification: 0 (no direct evidence)
- F. Application bug: 0 (no direct evidence for these rows)
- G. Unknown: 0

## Why Category A (Legacy Test Data)

1. Both affected users are explicit demo rows (`is_demo = true`).
2. Both were created at the exact same timestamp (`2026-06-07 22:42:09.567647+00`), indicating batch seeding.
3. Both were set to approved statuses without provider linkage:
   - `user_profiles.bridge_kyc_status = approved`
   - `user_profiles.bridge_customer_id = NULL`
   - business row has `bridge_kyb_status = approved` with `bridge_customer_id = NULL`
4. No evidence chain exists in ingress/queue/audit tables tying these records to Bridge onboarding:
   - `bridge_webhook_events`: 0 matches
   - `webhook_logs`: 0 matches
   - `pending_events`: 0 matches
   - `email_log`: 0 matches
   - `admin_alerts`: 0 matches
5. Only one audit row exists, and it is migration-sourced account type promotion (`source = migration`) for the business demo user.

## Per-Record Classification

| Internal ID | Profile Type | Email | Classification | Confidence | Evidence |
|---|---|---|---|---|---|
| `6ab47d98-1855-4f6e-afb2-15dfa46c79d1` | business | `demo.business@borderpayafrica.com` | A. Legacy test data | High | `is_demo=true`; created in demo batch timestamp; no webhook/queue/email/admin traces; migration-sourced account_type audit |
| `a4b3fccf-ac76-41f1-9727-432feffd8dac` | individual | `demo.individual@borderpayafrica.com` | A. Legacy test data | High | `is_demo=true`; created in same demo batch timestamp; no webhook/queue/email/admin traces |

## Required Questions Answered (Evidence-Based)

For both records:

- When created: `2026-06-07 22:42:09.567647+00`
- When approved: no explicit audited approval event; rows already in approved state at observed baseline
- Which Edge Function approved: **no evidence available**
- Which webhook updated: **none found**
- Which admin action approved: **none found** (`admin_kyc_*` fields null; no `admin_alerts`)
- Which deployment/version introduced: **not deterministically attributable from available write-audit data**
  - nearest confirmed production deployment observed: `dpl_3o76Rd7ZvhdVVe8XwRbfkzz762vG` at `Mon Jun 08 2026 01:50:42 +0300`
- Bridge customer creation request exists: **no evidence found**
- Bridge webhook exists: **no evidence found**
- Failed queue event exists: **no evidence found**
- Error log exists: **no evidence found**
- Bridge unavailable: **no evidence found**
- Imported test data: **strongly indicated (yes)**
- Created before current onboarding flow: **likely yes** (no onboarding event-chain artifacts for these rows)

## SQL Queries Executed

```sql
-- affected set validation
select up.id as user_id, up.account_type, up.email, up.is_demo, up.created_at, up.updated_at,
       up.bridge_kyc_status, up.bridge_customer_id, up.kyc_status, up.bridge_account_status,
       bp.id as business_profile_id, bp.bridge_kyb_status, bp.bridge_customer_id as business_bridge_customer_id,
       bp.bridge_kyb_completed_at
from public.user_profiles up
left join public.business_profiles bp on bp.user_id = up.id
where (up.account_type in ('individual','business') and up.bridge_kyc_status = 'approved' and up.bridge_customer_id is null)
   or (bp.id is not null and bp.bridge_kyb_status = 'approved' and bp.bridge_customer_id is null)
order by up.created_at, up.id;

-- profile/admin timeline fields
select id, account_type, email, is_demo, created_at, updated_at, kyc_status, bridge_kyc_status,
       bridge_kyc_completed_at, bridge_customer_id, admin_kyc_decision, admin_kyc_reviewer, admin_kyc_approved_at
from public.user_profiles
where id in ('6ab47d98-1855-4f6e-afb2-15dfa46c79d1','a4b3fccf-ac76-41f1-9727-432feffd8dac')
order by id;

select id, user_id, created_at, updated_at, bridge_kyb_status, bridge_kyb_completed_at, bridge_customer_id
from public.business_profiles
where user_id in ('6ab47d98-1855-4f6e-afb2-15dfa46c79d1','a4b3fccf-ac76-41f1-9727-432feffd8dac')
order by user_id;

-- auth provenance
select id, email, created_at, email_confirmed_at, raw_user_meta_data->>'account_type' as meta_account_type
from auth.users
where id in ('6ab47d98-1855-4f6e-afb2-15dfa46c79d1','a4b3fccf-ac76-41f1-9727-432feffd8dac')
order by created_at;

-- event/log traces by ids/emails
select 'bridge_webhook_events' as source, count(*)::int as matched_rows
from public.bridge_webhook_events
where payload::text ilike '%demo.business@borderpayafrica.com%'
   or payload::text ilike '%demo.individual@borderpayafrica.com%'
   or payload::text ilike '%6ab47d98-1855-4f6e-afb2-15dfa46c79d1%'
   or payload::text ilike '%a4b3fccf-ac76-41f1-9727-432feffd8dac%'
union all
select 'webhook_logs', count(*)::int
from public.webhook_logs
where event_id in (
  select event_id from public.bridge_webhook_events
  where payload::text ilike '%demo.business@borderpayafrica.com%'
     or payload::text ilike '%demo.individual@borderpayafrica.com%'
     or payload::text ilike '%6ab47d98-1855-4f6e-afb2-15dfa46c79d1%'
     or payload::text ilike '%a4b3fccf-ac76-41f1-9727-432feffd8dac%'
)
union all
select 'pending_events', count(*)::int
from public.pending_events
where payload::text ilike '%demo.business@borderpayafrica.com%'
   or payload::text ilike '%demo.individual@borderpayafrica.com%'
   or payload::text ilike '%6ab47d98-1855-4f6e-afb2-15dfa46c79d1%'
   or payload::text ilike '%a4b3fccf-ac76-41f1-9727-432feffd8dac%'
union all
select 'email_log', count(*)::int
from public.email_log
where user_id in ('6ab47d98-1855-4f6e-afb2-15dfa46c79d1','a4b3fccf-ac76-41f1-9727-432feffd8dac')
   or lower(recipient) in ('demo.business@borderpayafrica.com','demo.individual@borderpayafrica.com')
union all
select 'admin_alerts', count(*)::int
from public.admin_alerts
where user_id in ('6ab47d98-1855-4f6e-afb2-15dfa46c79d1','a4b3fccf-ac76-41f1-9727-432feffd8dac')
union all
select 'account_type_audit', count(*)::int
from public.account_type_audit
where user_id in ('6ab47d98-1855-4f6e-afb2-15dfa46c79d1','a4b3fccf-ac76-41f1-9727-432feffd8dac');

-- account-type migration audit row
select id, user_id, from_type, to_type, source, reviewer_id, created_at
from public.account_type_audit
where user_id in ('6ab47d98-1855-4f6e-afb2-15dfa46c79d1','a4b3fccf-ac76-41f1-9727-432feffd8dac')
order by created_at;

-- cohort isolation: only demo accounts affected
select is_demo,
       count(*) filter (where bridge_kyc_status='approved' and bridge_customer_id is null) as approved_missing_customer,
       count(*) as total_profiles
from public.user_profiles
group by is_demo
order by is_demo;
```

## Recommended Action (Allowed Set)

For both affected records: **1. Delete the record (legacy/test)**.

Rationale:

- They are demo-only artifacts (`is_demo=true`), not production customers.
- No deterministic Bridge ownership linkage exists.
- Keeping approved+null-customer demo rows preserves a known broken financial invariant.


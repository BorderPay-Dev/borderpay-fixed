# Identity Timeline Report — Approved Profiles Missing `bridge_customer_id`

Date: 2026-06-20  
Mode: read-only investigation only

## Scope

Tracked records:

- `6ab47d98-1855-4f6e-afb2-15dfa46c79d1` (business)
- `a4b3fccf-ac76-41f1-9727-432feffd8dac` (individual)

## Timeline — Record 1 (Business Demo)

Internal ID: `6ab47d98-1855-4f6e-afb2-15dfa46c79d1`  
Email: `demo.business@borderpayafrica.com`

| Time (UTC) | Source | Observed Event | Evidence | Confidence |
|---|---|---|---|---|
| `2026-06-07 22:42:09.567647+00` | `auth.users` | Auth user created | `auth.users.created_at` | High |
| `2026-06-07 22:42:09.567647+00` | `auth.users` | Email already confirmed | `email_confirmed_at` equals create time | High |
| `2026-06-07 22:42:09.567647+00` | `user_profiles` | Profile created as demo business and already approved without customer id | `is_demo=true`, `bridge_kyc_status=approved`, `bridge_customer_id=NULL` | High |
| `2026-06-07 22:42:09.567647+00` | `business_profiles` | Business profile created and already KYB-approved without customer id | `bridge_kyb_status=approved`, `bridge_customer_id=NULL` | High |
| `2026-06-07 22:42:09.567647+00` | `account_type_audit` | Type promotion logged as migration-sourced (`individual -> business`) | `source='migration'`, `reviewer_id=NULL` | High |
| `2026-06-14 00:12:22.651377+00` | `user_profiles` | Last profile update observed | `updated_at` | Medium |
| no rows | `bridge_webhook_events` | No Bridge webhook payload references id/email | trace count = 0 | High |
| no rows | `webhook_logs` | No webhook log references id/email chain | trace count = 0 | High |
| no rows | `pending_events` | No queued/retry events reference id/email | trace count = 0 | High |
| no rows | `email_log` | No email workflow traces for id/email | trace count = 0 | High |
| no rows | `admin_alerts` | No admin alert/review traces | trace count = 0 | High |

Classification: **A. Legacy test data**

Recommended action: **1. Delete the record (legacy/test)**.

---

## Timeline — Record 2 (Individual Demo)

Internal ID: `a4b3fccf-ac76-41f1-9727-432feffd8dac`  
Email: `demo.individual@borderpayafrica.com`

| Time (UTC) | Source | Observed Event | Evidence | Confidence |
|---|---|---|---|---|
| `2026-06-07 22:42:09.567647+00` | `auth.users` | Auth user created | `auth.users.created_at` | High |
| `2026-06-07 22:42:09.567647+00` | `auth.users` | Email already confirmed | `email_confirmed_at` equals create time | High |
| `2026-06-07 22:42:09.567647+00` | `user_profiles` | Profile created as demo individual and already approved without customer id | `is_demo=true`, `bridge_kyc_status=approved`, `bridge_customer_id=NULL` | High |
| `2026-06-14 00:12:22.651377+00` | `user_profiles` | Last profile update observed | `updated_at` | Medium |
| no rows | `account_type_audit` | No type transition logged for this user | trace count = 0 | High |
| no rows | `bridge_webhook_events` | No Bridge webhook payload references id/email | trace count = 0 | High |
| no rows | `webhook_logs` | No webhook log references id/email chain | trace count = 0 | High |
| no rows | `pending_events` | No queued/retry events reference id/email | trace count = 0 | High |
| no rows | `email_log` | No email workflow traces for id/email | trace count = 0 | High |
| no rows | `admin_alerts` | No admin alert/review traces | trace count = 0 | High |

Classification: **A. Legacy test data**

Recommended action: **1. Delete the record (legacy/test)**.

---

## Attribution Questions (Answered)

| Question | Business Demo | Individual Demo |
|---|---|---|
| Which Edge Function approved it? | No evidence available in retained tables/logs | No evidence available in retained tables/logs |
| Which webhook updated it? | None found | None found |
| Which admin action approved it? | None found (`admin_kyc_*` null, no `admin_alerts`) | None found (`admin_kyc_*` null, no `admin_alerts`) |
| Bridge customer creation request exists? | None found | None found |
| Bridge webhook exists? | None found | None found |
| Failed queue event exists? | None found | None found |
| Error log exists? | None found | None found |
| Was Bridge unavailable? | No evidence | No evidence |
| Imported test data? | Strongly yes (`is_demo=true`) | Strongly yes (`is_demo=true`) |
| Created before current onboarding flow? | Likely yes (no onboarding chain artifacts) | Likely yes (no onboarding chain artifacts) |

## Deployment/Version Correlation

- A production deployment in the same period was verified:
  - deployment: `dpl_3o76Rd7ZvhdVVe8XwRbfkzz762vG`
  - created at: `Mon Jun 08 2026 01:50:42 +0300`
- Affected rows were created at `2026-06-07 22:42:09.567647+00` (`2026-06-08 01:42:09.567647 +0300`), about **8m 32s before** that deployment.
- No write-audit table exists that deterministically maps these row writes to a specific function version or commit.

## Supporting SQL Evidence (Executed)

```sql
-- global trace coverage for affected ids/emails
with targets as (
  select unnest(array['demo.business@borderpayafrica.com','demo.individual@borderpayafrica.com'])::text as email
), ids as (
  select unnest(array['6ab47d98-1855-4f6e-afb2-15dfa46c79d1','a4b3fccf-ac76-41f1-9727-432feffd8dac'])::uuid as user_id
)
select 'bridge_webhook_events' as source, count(*)::int as matched_rows
from public.bridge_webhook_events
where payload::text ilike '%demo.business@borderpayafrica.com%'
   or payload::text ilike '%demo.individual@borderpayafrica.com%'
   or payload::text ilike '%6ab47d98-1855-4f6e-afb2-15dfa46c79d1%'
   or payload::text ilike '%a4b3fccf-ac76-41f1-9727-432feffd8dac%'
union all
select 'webhook_logs', count(*)::int from public.webhook_logs
where event_id in (
  select event_id from public.bridge_webhook_events
  where payload::text ilike '%demo.business@borderpayafrica.com%'
     or payload::text ilike '%demo.individual@borderpayafrica.com%'
     or payload::text ilike '%6ab47d98-1855-4f6e-afb2-15dfa46c79d1%'
     or payload::text ilike '%a4b3fccf-ac76-41f1-9727-432feffd8dac%'
)
union all
select 'pending_events', count(*)::int from public.pending_events
where payload::text ilike '%demo.business@borderpayafrica.com%'
   or payload::text ilike '%demo.individual@borderpayafrica.com%'
   or payload::text ilike '%6ab47d98-1855-4f6e-afb2-15dfa46c79d1%'
   or payload::text ilike '%a4b3fccf-ac76-41f1-9727-432feffd8dac%'
union all
select 'email_log', count(*)::int from public.email_log
where user_id in (select user_id from ids) or lower(recipient) in (select email from targets)
union all
select 'admin_alerts', count(*)::int from public.admin_alerts
where user_id in (select user_id from ids)
union all
select 'account_type_audit', count(*)::int from public.account_type_audit
where user_id in (select user_id from ids);

-- account type audit row proving migration-sourced type change
select id, user_id, from_type, to_type, source, reviewer_id, created_at
from public.account_type_audit
where user_id in ('6ab47d98-1855-4f6e-afb2-15dfa46c79d1','a4b3fccf-ac76-41f1-9727-432feffd8dac')
order by created_at;
```


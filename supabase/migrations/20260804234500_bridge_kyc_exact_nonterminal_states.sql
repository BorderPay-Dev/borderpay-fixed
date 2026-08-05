-- Repair status drift caused by the webhook worker collapsing Bridge's
-- `not_started` and `incomplete` states into `pending`.
with latest_kyc as (
  select distinct on (payload #>> '{event_object,customer_id}')
    payload #>> '{event_object,customer_id}' as customer_id,
    lower(coalesce(payload #>> '{event_object,kyc_status}', payload ->> 'event_object_status', '')) as provider_status
  from public.bridge_webhook_events
  where event_type ilike 'kyc_link%'
    and nullif(payload #>> '{event_object,customer_id}', '') is not null
  order by payload #>> '{event_object,customer_id}', received_at desc
)
update public.user_profiles as profile
set bridge_kyc_status = latest.provider_status,
    updated_at = now()
from latest_kyc as latest
where latest.customer_id = profile.bridge_customer_id
  and latest.provider_status in ('not_started', 'incomplete', 'under_review', 'pending')
  and lower(coalesce(profile.bridge_kyc_status, '')) is distinct from latest.provider_status;

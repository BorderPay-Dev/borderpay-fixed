alter table public.user_profiles
  add column if not exists bridge_account_paused_at timestamptz;

comment on column public.user_profiles.bridge_account_paused_at is
  'Bridge customer status transition time when bridge_account_status is paused; cleared on any later non-paused status.';

-- Backfill every customer already paused before this column existed from the
-- latest stored Bridge pause webhook. `updated_at` is only a last-resort fallback.
update public.user_profiles as profile
set bridge_account_paused_at = coalesce(
  (
    select nullif(event.payload ->> 'event_created_at', '')::timestamptz
    from public.bridge_webhook_events as event
    where event.payload #>> '{event_object,id}' = profile.bridge_customer_id
      and lower(event.payload #>> '{event_object,status}') = 'paused'
    order by event.received_at desc
    limit 1
  ),
  profile.updated_at
)
where lower(coalesce(profile.bridge_account_status, '')) = 'paused'
  and profile.bridge_account_paused_at is null;

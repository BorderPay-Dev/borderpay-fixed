-- Bridge EEA SCA safe-recovery control.
-- Password recovery or replacement of an active authenticator starts a
-- 24-hour restriction for Bridge SCA-protected actions. Login and fund-in
-- remain available. The restriction is evaluated only after the server has
-- established that Bridge SCA applies to the customer.

alter table public.user_security
  add column if not exists sca_recovery_restricted_until timestamptz,
  add column if not exists sca_recovery_started_at timestamptz,
  add column if not exists sca_recovery_reason text;

comment on column public.user_security.sca_recovery_restricted_until is
  'Blocks Bridge EEA SCA-protected actions during credential recovery/factor replacement; does not block login or fund-in.';

alter table public.sca_audit_events
  drop constraint if exists sca_audit_events_event_type_check;
alter table public.sca_audit_events
  add constraint sca_audit_events_event_type_check check (event_type in (
    'authorization_succeeded', 'authorization_failed', 'authorization_locked',
    'authorization_consumed', 'authorization_rejected', 'recovery_restricted',
    'scope_unavailable'
  ));

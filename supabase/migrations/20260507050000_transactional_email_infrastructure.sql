-- ============================================================================
-- 20260507_transactional_email_infrastructure.sql
-- ----------------------------------------------------------------------------
-- Source-controlled migration mirroring the live transactional email infra:
--   public.email_log              — every send attempt, status, retries, error
--   public.email_verification_tokens — sha256-hashed one-time tokens
--   public.issue_email_token()    — rate-limited token issuance helper
--   public.consume_email_token()  — single-use, expiry-aware validator
--   public.log_email_attempt()    — convenience helper for the send-email fn
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ─── email_log ──────────────────────────────────────────────────────────────
create table if not exists public.email_log (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        references auth.users(id) on delete set null,
  recipient       text        not null,
  template        text        not null,
  subject         text        not null,
  status          text        not null default 'queued'
                  check (status in ('queued','sending','sent','failed','dropped')),
  attempts        integer     not null default 0,
  max_attempts    integer     not null default 4,
  next_attempt_at timestamptz not null default now(),
  resend_id       text,
  last_error      text,
  idempotency_key text,
  payload         jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists email_log_status_idx        on public.email_log (status, next_attempt_at)
  where status in ('queued','failed');
create index if not exists email_log_recipient_idx     on public.email_log (recipient, created_at desc);
create index if not exists email_log_user_idx          on public.email_log (user_id, created_at desc) where user_id is not null;
create unique index if not exists email_log_idem_idx   on public.email_log (idempotency_key) where idempotency_key is not null;

alter table public.email_log enable row level security;

drop policy if exists email_log_owner_read    on public.email_log;
create policy email_log_owner_read    on public.email_log for select to authenticated using (auth.uid() = user_id);
drop policy if exists email_log_admin_read    on public.email_log;
create policy email_log_admin_read    on public.email_log for select to authenticated using (public.is_borderpay_admin());
drop policy if exists email_log_service_role  on public.email_log;
create policy email_log_service_role  on public.email_log for all to service_role using (true) with check (true);

drop trigger if exists trg_email_log_touch on public.email_log;
create trigger trg_email_log_touch
  before update on public.email_log
  for each row execute function public.touch_updated_at();

-- ─── email_verification_tokens ──────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'email_token_purpose') then
    create type public.email_token_purpose as enum (
      'signup_individual', 'signup_business', 'password_reset', 'email_change'
    );
  end if;
end $$;

create table if not exists public.email_verification_tokens (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  token_hash  text        not null,
  purpose     public.email_token_purpose not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now(),
  unique (token_hash)
);
create index if not exists evt_user_purpose_idx on public.email_verification_tokens (user_id, purpose, created_at desc);
create index if not exists evt_active_idx       on public.email_verification_tokens (purpose, expires_at) where used_at is null;

alter table public.email_verification_tokens enable row level security;
drop policy if exists evt_service_role on public.email_verification_tokens;
create policy evt_service_role on public.email_verification_tokens for all to service_role using (true) with check (true);
drop policy if exists evt_admin_read   on public.email_verification_tokens;
create policy evt_admin_read   on public.email_verification_tokens for select to authenticated using (public.is_borderpay_admin());

-- ─── issue_email_token (rate-limited, returns plaintext exactly once) ──────
create or replace function public.issue_email_token(
  p_user_id    uuid,
  p_purpose    public.email_token_purpose,
  p_ttl_minutes int default 60 * 24,
  p_ip         inet default null,
  p_ua         text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_recent_count int;
  v_last_at      timestamptz;
  v_raw          bytea;
  v_token        text;
  v_hash         text;
begin
  if p_user_id is null then
    raise exception 'issue_email_token: p_user_id required' using errcode = '22023';
  end if;
  select count(*), max(created_at) into v_recent_count, v_last_at
    from public.email_verification_tokens
   where user_id = p_user_id and purpose = p_purpose
     and created_at > now() - interval '1 hour'
     and used_at is null and expires_at > now();
  if v_recent_count >= 3 then
    raise exception 'issue_email_token: too many tokens — try again later'
      using errcode = '22023', hint = 'rate_limit';
  end if;
  if v_last_at is not null and v_last_at > now() - interval '60 seconds' then
    raise exception 'issue_email_token: please wait before requesting again'
      using errcode = '22023', hint = 'cooldown';
  end if;
  v_raw   := extensions.gen_random_bytes(32);
  v_token := translate(rtrim(encode(v_raw, 'base64'), '='), '+/', '-_');
  v_hash  := encode(extensions.digest(v_token, 'sha256'), 'hex');
  insert into public.email_verification_tokens (user_id, token_hash, purpose, expires_at, ip_address, user_agent)
  values (p_user_id, v_hash, p_purpose, now() + make_interval(mins => greatest(p_ttl_minutes, 5)), p_ip, p_ua);
  return v_token;
end;
$$;
revoke all     on function public.issue_email_token(uuid, public.email_token_purpose, int, inet, text) from public;
grant  execute on function public.issue_email_token(uuid, public.email_token_purpose, int, inet, text) to service_role;

-- ─── consume_email_token (single-use, expiry-aware) ─────────────────────────
create or replace function public.consume_email_token(
  p_token   text,
  p_purpose public.email_token_purpose
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_hash text; v_row record;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'consume_email_token: malformed token' using errcode = '22023';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select id, user_id, expires_at, used_at, purpose into v_row
    from public.email_verification_tokens where token_hash = v_hash for update;
  if v_row.id      is null                    then raise exception 'consume_email_token: token not found' using errcode = '22023', hint = 'not_found'; end if;
  if v_row.purpose <> p_purpose               then raise exception 'consume_email_token: token purpose mismatch' using errcode = '22023', hint = 'purpose_mismatch'; end if;
  if v_row.used_at is not null                then raise exception 'consume_email_token: token already used' using errcode = '22023', hint = 'already_used'; end if;
  if v_row.expires_at <= now()                then raise exception 'consume_email_token: token expired' using errcode = '22023', hint = 'expired'; end if;
  update public.email_verification_tokens set used_at = now() where id = v_row.id;
  return v_row.user_id;
end;
$$;
revoke all     on function public.consume_email_token(text, public.email_token_purpose) from public;
grant  execute on function public.consume_email_token(text, public.email_token_purpose) to service_role;

-- ─── log_email_attempt (idempotent ledger row) ──────────────────────────────
create or replace function public.log_email_attempt(
  p_user_id   uuid,
  p_recipient text,
  p_template  text,
  p_subject   text,
  p_payload   jsonb default '{}'::jsonb,
  p_idem_key  text  default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if p_idem_key is not null then
    select id into v_id from public.email_log
     where idempotency_key = p_idem_key and status in ('sent','sending','queued')
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.email_log (user_id, recipient, template, subject, payload, idempotency_key, status, attempts, next_attempt_at)
  values (p_user_id, lower(trim(p_recipient)), p_template, p_subject, coalesce(p_payload, '{}'::jsonb), p_idem_key, 'queued', 0, now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all     on function public.log_email_attempt(uuid, text, text, text, jsonb, text) from public;
grant  execute on function public.log_email_attempt(uuid, text, text, text, jsonb, text) to service_role;

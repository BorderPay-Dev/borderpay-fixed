-- Disposable CI database only. Extends payment_sca_fixture.sql.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
create table public.user_profiles(id uuid primary key, account_type text, country text, bridge_customer_id text, bridge_kyc_status text);
create table public.business_profiles(user_id uuid primary key, country text, bridge_customer_id text, bridge_kyb_status text);
create table public.sca_customer_scopes(user_id uuid primary key, bridge_customer_id text, provider_country text, source text, expires_at timestamptz);
create table public.bridge_wallets(id int generated always as identity primary key, user_id uuid, business_user_id uuid, currency text, chain text);
create table public.bridge_balance_ledger(id int generated always as identity primary key, user_id uuid, business_user_id uuid, currency text);
create table public.wallets(id int generated always as identity primary key, user_id uuid, currency text, balance numeric default 0);
alter table public.bridge_wallets enable row level security;
alter table public.bridge_balance_ledger enable row level security;
alter table public.wallets enable row level security;
grant select, update, insert on public.bridge_wallets, public.bridge_balance_ledger, public.wallets to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- Match the production PL/pgSQL boundary rather than an inlined SQL stub.
create function public.can_read_bridge_financial_data(p_user_id uuid) returns boolean language plpgsql stable as $$
begin
 return p_user_id = auth.uid() and coalesce(current_setting('test.financial_read_blocked', true), '') <> 'true';
end;
$$;
create policy wallets_own on public.wallets for all to public
using(auth.uid()=user_id and upper(coalesce(currency,'')) <> 'USDT')
with check(auth.uid()=user_id and upper(coalesce(currency,'')) <> 'USDT');

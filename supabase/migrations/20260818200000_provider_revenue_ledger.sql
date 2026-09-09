-- Authoritative, immutable provider revenue ledger.
-- Revenue is recognized only from settled provider evidence and reversed by
-- separate immutable rows. The admin dashboard consumes the RPC below; it no
-- longer estimates revenue in the browser from mutable provider projections.

create table if not exists public.provider_revenue_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('bridge', 'yellow_card')),
  environment text not null check (environment in ('live', 'sandbox')),
  source_type text not null check (source_type in ('bridge_transfer', 'bridge_virtual_account', 'yellow_card_transaction')),
  source_id text not null,
  source_event_id text,
  event_kind text not null check (event_kind in ('earned', 'reversal')),
  revenue_category text not null check (revenue_category in ('developer_fee', 'transfer_markup', 'fx_markup')),
  settlement_status text not null check (settlement_status in ('settled', 'reversed')),
  fee_currency text not null,
  gross_customer_fee numeric(38,18) not null check (gross_customer_fee >= 0),
  provider_cost numeric(38,18) not null check (provider_cost >= 0),
  net_revenue numeric(38,18) not null check (net_revenue >= 0),
  source_amount numeric(38,18),
  source_currency text,
  destination_currency text,
  usd_rate numeric(38,18) check (usd_rate is null or usd_rate > 0),
  reconciliation_status text not null check (reconciliation_status in ('reconciled', 'partial', 'exception')),
  evidence jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint provider_revenue_fee_math check (abs(net_revenue - (gross_customer_fee - provider_cost)) < 0.000000000001),
  constraint provider_revenue_settlement_kind check (
    (event_kind = 'earned' and settlement_status = 'settled') or
    (event_kind = 'reversal' and settlement_status = 'reversed')
  ),
  constraint provider_revenue_same_token_free check (
    not (
      provider = 'bridge' and source_type = 'bridge_transfer'
      and source_currency = destination_currency
      and source_currency in ('USDC', 'USDT')
      and (gross_customer_fee <> 0 or provider_cost <> 0 or net_revenue <> 0)
    )
  ),
  unique (provider, environment, source_type, source_id, event_kind, revenue_category)
);

create index if not exists provider_revenue_occurred_idx
  on public.provider_revenue_events (occurred_at desc);
create index if not exists provider_revenue_provider_idx
  on public.provider_revenue_events (provider, environment, occurred_at desc);

alter table public.provider_revenue_events enable row level security;

drop policy if exists provider_revenue_events_admin_read on public.provider_revenue_events;
create policy provider_revenue_events_admin_read on public.provider_revenue_events
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists provider_revenue_events_service_insert on public.provider_revenue_events;
create policy provider_revenue_events_service_insert on public.provider_revenue_events
  for insert to service_role with check (true);

create or replace function public.provider_revenue_events_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'provider_revenue_events is immutable; append a reversal event';
end;
$$;

drop trigger if exists trg_provider_revenue_events_immutable on public.provider_revenue_events;
create trigger trg_provider_revenue_events_immutable
  before update or delete on public.provider_revenue_events
  for each row execute function public.provider_revenue_events_immutable();

create or replace function public.revenue_json_numeric(p_value jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_text text;
begin
  if p_value is null or p_value = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_value) = 'object' then
    return public.revenue_json_numeric(p_value -> 'amount');
  end if;
  v_text := trim(both '"' from p_value::text);
  if v_text ~ '^-?[0-9]+([.][0-9]+)?$' then return v_text::numeric; end if;
  return null;
end;
$$;

create or replace function public.record_provider_revenue_event(
  p_provider text,
  p_environment text,
  p_source_type text,
  p_source_id text,
  p_source_event_id text,
  p_event_kind text,
  p_revenue_category text,
  p_fee_currency text,
  p_gross_customer_fee numeric,
  p_provider_cost numeric,
  p_source_amount numeric,
  p_source_currency text,
  p_destination_currency text,
  p_usd_rate numeric,
  p_reconciliation_status text,
  p_evidence jsonb,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_gross numeric := p_gross_customer_fee;
  v_cost numeric := p_provider_cost;
  v_source_amount numeric := p_source_amount;
  v_usd_rate numeric := p_usd_rate;
  v_currency text := upper(nullif(trim(p_fee_currency), ''));
  v_source_currency text := upper(nullif(trim(p_source_currency), ''));
  v_destination_currency text := upper(nullif(trim(p_destination_currency), ''));
begin
  if p_provider not in ('bridge', 'yellow_card') then raise exception 'unsupported revenue provider'; end if;
  if p_environment not in ('live', 'sandbox') then raise exception 'invalid revenue environment'; end if;
  if p_source_type not in ('bridge_transfer', 'bridge_virtual_account', 'yellow_card_transaction') then raise exception 'invalid revenue source_type'; end if;
  if nullif(trim(p_source_id), '') is null then raise exception 'revenue source_id is required'; end if;
  if p_event_kind not in ('earned', 'reversal') then raise exception 'invalid revenue event_kind'; end if;
  if p_revenue_category not in ('developer_fee', 'transfer_markup', 'fx_markup') then raise exception 'invalid revenue category'; end if;
  if p_reconciliation_status not in ('reconciled', 'partial', 'exception') then raise exception 'invalid reconciliation status'; end if;
  if p_evidence is null or p_evidence = '{}'::jsonb then raise exception 'provider evidence is required'; end if;
  if p_occurred_at is null then raise exception 'occurred_at is required'; end if;

  if p_event_kind = 'reversal' and (v_gross is null or v_currency is null) then
    select gross_customer_fee, provider_cost, fee_currency, source_amount,
           source_currency, destination_currency, usd_rate
      into v_gross, v_cost, v_currency, v_source_amount,
           v_source_currency, v_destination_currency, v_usd_rate
    from public.provider_revenue_events
    where provider = p_provider
      and environment = p_environment
      and source_type = p_source_type
      and source_id = p_source_id
      and event_kind = 'earned'
      and revenue_category = p_revenue_category;
  end if;

  v_gross := coalesce(v_gross, 0);
  v_cost := coalesce(v_cost, 0);
  if v_currency is null then raise exception 'fee currency is required'; end if;
  if v_gross < 0 or v_cost < 0 or v_cost > v_gross then raise exception 'invalid provider revenue fee amounts'; end if;

  -- Bridge does not accept a developer fee on same-token external wallet
  -- payouts. Enforce both documented free routes at the accounting boundary.
  if p_provider = 'bridge'
     and p_source_type = 'bridge_transfer'
     and v_source_currency = v_destination_currency
     and v_source_currency in ('USDC', 'USDT')
     and (v_gross <> 0 or v_cost <> 0) then
    raise exception 'same-token USDC/USDT transfer revenue must be zero';
  end if;

  insert into public.provider_revenue_events (
    provider, environment, source_type, source_id, source_event_id,
    event_kind, revenue_category, settlement_status, fee_currency,
    gross_customer_fee, provider_cost, net_revenue, source_amount,
    source_currency, destination_currency, usd_rate,
    reconciliation_status, evidence, occurred_at
  ) values (
    p_provider, p_environment, p_source_type, trim(p_source_id), nullif(trim(p_source_event_id), ''),
    p_event_kind, p_revenue_category,
    case when p_event_kind = 'earned' then 'settled' else 'reversed' end,
    v_currency, v_gross, v_cost, v_gross - v_cost, v_source_amount,
    v_source_currency, v_destination_currency,
    case when v_currency in ('USD', 'USDC', 'USDT') then 1 else v_usd_rate end,
    p_reconciliation_status, p_evidence, p_occurred_at
  )
  on conflict (provider, environment, source_type, source_id, event_kind, revenue_category)
  do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.provider_revenue_events
    where provider = p_provider and environment = p_environment
      and source_type = p_source_type and source_id = trim(p_source_id)
      and event_kind = p_event_kind and revenue_category = p_revenue_category;
  end if;
  return v_id;
end;
$$;

revoke all on function public.record_provider_revenue_event(text,text,text,text,text,text,text,text,numeric,numeric,numeric,text,text,numeric,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.record_provider_revenue_event(text,text,text,text,text,text,text,text,numeric,numeric,numeric,text,text,numeric,text,jsonb,timestamptz) to service_role;

create or replace function public.capture_bridge_transfer_revenue()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_receipt jsonb := coalesce(new.raw -> 'receipt', '{}'::jsonb);
  v_fee numeric;
  v_source_currency text;
  v_destination_currency text;
  v_kind text;
begin
  if new.state not in ('succeeded', 'refunded', 'returned') then return new; end if;
  v_fee := coalesce(
    public.revenue_json_numeric(new.raw -> 'developer_fee'),
    public.revenue_json_numeric(v_receipt -> 'developer_fee'),
    public.revenue_json_numeric(v_receipt -> 'developer_fee_amount')
  );
  v_source_currency := upper(coalesce(nullif(v_receipt ->> 'source_currency', ''), new.currency));
  v_destination_currency := upper(coalesce(nullif(v_receipt ->> 'destination_currency', ''), new.raw ->> 'destination_currency'));
  v_kind := case when new.state = 'succeeded' then 'earned' else 'reversal' end;
  if v_kind = 'earned' and v_fee is null then return new; end if;

  perform public.record_provider_revenue_event(
    'bridge', 'live', 'bridge_transfer', new.bridge_transfer_id,
    coalesce(new.raw ->> 'event_id', new.bridge_transfer_id), v_kind,
    'developer_fee', coalesce(v_source_currency, upper(new.currency)),
    v_fee, case when v_fee is null then null else 0::numeric end, new.amount,
    v_source_currency, v_destination_currency,
    case when coalesce(v_source_currency, upper(new.currency)) in ('USD','USDC','USDT') then 1::numeric else null end,
    case when v_fee is null then 'partial' else 'reconciled' end,
    jsonb_build_object('table', 'bridge_transfers', 'state', new.state, 'receipt', v_receipt),
    coalesce(new.updated_at, new.created_at, now())
  );
  return new;
end;
$$;

drop trigger if exists trg_capture_bridge_transfer_revenue on public.bridge_transfers;
create trigger trg_capture_bridge_transfer_revenue
  after insert or update of state, raw on public.bridge_transfers
  for each row execute function public.capture_bridge_transfer_revenue();

create or replace function public.capture_bridge_va_revenue()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_receipt jsonb := coalesce(new.metadata -> 'receipt', '{}'::jsonb);
  v_fee numeric;
  v_source_id text;
  v_destination_currency text;
  v_kind text;
  v_status text;
begin
  if new.entity_type <> 'virtual_account' then return new; end if;
  v_source_id := coalesce(
    nullif(new.metadata ->> 'deposit_id', ''),
    nullif(new.metadata ->> 'bridge_deposit_id', ''),
    nullif(v_receipt ->> 'deposit_id', ''),
    new.event_id
  );
  v_fee := coalesce(
    public.revenue_json_numeric(new.metadata -> 'developer_fee_amount'),
    public.revenue_json_numeric(v_receipt -> 'developer_fee'),
    public.revenue_json_numeric(v_receipt -> 'service_charge_amount')
  );
  v_status := lower(coalesce(new.metadata ->> 'state', new.metadata ->> 'status', ''));
  v_kind := case
    when new.direction = 'credit' then 'earned'
    when new.direction = 'debit' and v_status in ('canceled', 'refunded', 'returned', 'reversed') then 'reversal'
    else null
  end;
  -- Ordinary debits are not proof that provider revenue was reversed.
  if v_kind is null then return new; end if;
  if v_kind = 'earned' and v_fee is null then return new; end if;
  v_destination_currency := upper(coalesce(v_receipt ->> 'destination_currency', new.metadata ->> 'destination_currency'));

  perform public.record_provider_revenue_event(
    'bridge', 'live', 'bridge_virtual_account', v_source_id, new.event_id,
    v_kind, 'developer_fee', upper(new.currency), v_fee,
    case when v_fee is null then null else 0::numeric end,
    abs(new.amount_minor)::numeric /
      case upper(new.currency) when 'USDC' then 1000000::numeric when 'USDT' then 1000000::numeric else 100::numeric end,
    upper(new.currency), v_destination_currency,
    case when upper(new.currency) in ('USD','USDC','USDT') then 1::numeric else null end,
    case when v_fee is null then 'partial' else 'reconciled' end,
    jsonb_build_object('table', 'bridge_balance_ledger', 'direction', new.direction, 'metadata', new.metadata),
    new.created_at
  );
  return new;
end;
$$;

drop trigger if exists trg_capture_bridge_va_revenue on public.bridge_balance_ledger;
create trigger trg_capture_bridge_va_revenue
  after insert on public.bridge_balance_ledger
  for each row execute function public.capture_bridge_va_revenue();

-- Backfill only rows with captured provider fee evidence. No configured fee
-- percentages are used to manufacture historical revenue.
insert into public.provider_revenue_events (
  provider, environment, source_type, source_id, source_event_id, event_kind,
  revenue_category, settlement_status, fee_currency, gross_customer_fee,
  provider_cost, net_revenue, source_amount, source_currency,
  destination_currency, usd_rate, reconciliation_status, evidence, occurred_at
)
select 'bridge', 'live', 'bridge_transfer', bt.bridge_transfer_id,
       coalesce(bt.raw ->> 'event_id', bt.bridge_transfer_id), 'earned',
       'developer_fee', 'settled',
       upper(coalesce(nullif(bt.raw -> 'receipt' ->> 'source_currency',''), bt.currency)),
       fee.amount, 0, fee.amount, bt.amount,
       upper(coalesce(nullif(bt.raw -> 'receipt' ->> 'source_currency',''), bt.currency)),
       upper(nullif(bt.raw -> 'receipt' ->> 'destination_currency','')),
       case when upper(coalesce(bt.raw -> 'receipt' ->> 'source_currency', bt.currency)) in ('USD','USDC','USDT') then 1 end,
       'reconciled', jsonb_build_object('table','bridge_transfers','state',bt.state,'receipt',bt.raw -> 'receipt'),
       coalesce(bt.updated_at, bt.created_at)
from public.bridge_transfers bt
cross join lateral (
  select coalesce(
    public.revenue_json_numeric(bt.raw -> 'developer_fee'),
    public.revenue_json_numeric(bt.raw -> 'developer_fee_amount'),
    public.revenue_json_numeric(bt.raw -> 'receipt' -> 'developer_fee'),
    public.revenue_json_numeric(bt.raw -> 'receipt' -> 'developer_fee_amount')
  ) amount
) fee
where bt.state = 'succeeded' and fee.amount is not null and fee.amount >= 0
on conflict do nothing;

-- Existing virtual-account rows are backfilled only when the persisted Bridge
-- receipt contains an explicit fee amount. Configuration percentages are not
-- used to estimate historical revenue.
insert into public.provider_revenue_events (
  provider, environment, source_type, source_id, source_event_id, event_kind,
  revenue_category, settlement_status, fee_currency, gross_customer_fee,
  provider_cost, net_revenue, source_amount, source_currency,
  destination_currency, usd_rate, reconciliation_status, evidence, occurred_at
)
select 'bridge', 'live', 'bridge_virtual_account', evidence.source_id,
       l.event_id, 'earned', 'developer_fee', 'settled', upper(l.currency),
       evidence.fee_amount, 0, evidence.fee_amount,
       coalesce(public.revenue_json_numeric(l.metadata -> 'gross_amount'),
                abs(l.amount_minor)::numeric /
                  case upper(l.currency) when 'USDC' then 1000000::numeric when 'USDT' then 1000000::numeric else 100::numeric end),
       upper(l.currency), upper(coalesce(l.metadata -> 'receipt' ->> 'destination_currency', l.metadata ->> 'destination_currency')),
       case when upper(l.currency) in ('USD','USDC','USDT') then 1 end,
       'reconciled', jsonb_build_object('table','bridge_balance_ledger','direction',l.direction,'metadata',l.metadata),
       l.created_at
from public.bridge_balance_ledger l
cross join lateral (
  select
    coalesce(nullif(l.metadata ->> 'deposit_id',''), nullif(l.metadata -> 'receipt' ->> 'deposit_id',''), l.event_id) source_id,
    coalesce(
      public.revenue_json_numeric(l.metadata -> 'developer_fee_amount'),
      public.revenue_json_numeric(l.metadata -> 'receipt' -> 'developer_fee'),
      public.revenue_json_numeric(l.metadata -> 'receipt' -> 'service_charge_amount')
    ) fee_amount
) evidence
where l.entity_type = 'virtual_account'
  and l.direction = 'credit'
  and evidence.fee_amount is not null
  and evidence.fee_amount >= 0
on conflict do nothing;

-- Historical refunds/returns reverse the exact earned row. A debit without an
-- explicit reversal status remains excluded.
insert into public.provider_revenue_events (
  provider, environment, source_type, source_id, source_event_id, event_kind,
  revenue_category, settlement_status, fee_currency, gross_customer_fee,
  provider_cost, net_revenue, source_amount, source_currency,
  destination_currency, usd_rate, reconciliation_status, evidence, occurred_at
)
select earned.provider, earned.environment, earned.source_type, earned.source_id,
       l.event_id, 'reversal', earned.revenue_category, 'reversed', earned.fee_currency,
       earned.gross_customer_fee, earned.provider_cost, earned.net_revenue,
       earned.source_amount, earned.source_currency, earned.destination_currency,
       earned.usd_rate, 'reconciled',
       jsonb_build_object('table','bridge_balance_ledger','direction',l.direction,'metadata',l.metadata),
       l.created_at
from public.bridge_balance_ledger l
join public.provider_revenue_events earned
  on earned.provider = 'bridge'
 and earned.environment = 'live'
 and earned.source_type = 'bridge_virtual_account'
 and earned.source_id = coalesce(nullif(l.metadata ->> 'deposit_id',''), nullif(l.metadata -> 'receipt' ->> 'deposit_id',''), l.event_id)
 and earned.event_kind = 'earned'
 and earned.revenue_category = 'developer_fee'
where l.entity_type = 'virtual_account'
  and l.direction = 'debit'
  and lower(coalesce(l.metadata ->> 'state', l.metadata ->> 'status', '')) in ('canceled','refunded','returned','reversed')
on conflict do nothing;

create or replace function public.admin_provider_revenue_summary()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_borderpay_admin() then
    raise exception 'admin access required';
  end if;

  with signed as (
    select e.*,
      case when event_kind = 'reversal' then -1 else 1 end as event_sign,
      case when usd_rate is not null then net_revenue * usd_rate end as net_usd,
      case when usd_rate is not null then gross_customer_fee * usd_rate end as gross_usd,
      case when usd_rate is not null then provider_cost * usd_rate end as cost_usd
    from public.provider_revenue_events e where environment = 'live'
  ), provider_rows as (
    select provider,
      coalesce(sum(event_sign * gross_usd),0) gross_usd,
      coalesce(sum(event_sign * cost_usd),0) cost_usd,
      coalesce(sum(event_sign * net_usd),0) net_usd,
      count(*) filter (where usd_rate is null) unconverted,
      count(*) filter (where reconciliation_status = 'reconciled') reconciled,
      count(*) filter (where reconciliation_status <> 'reconciled') exceptions
    from signed group by provider
  ), monthly as (
    select to_char(date_trunc('month', occurred_at), 'YYYY-MM') as month_key,
      coalesce(sum(event_sign * net_usd),0) revenue
    from signed
    where occurred_at >= date_trunc('month', now()) - interval '11 months'
    group by date_trunc('month', occurred_at)
    order by date_trunc('month', occurred_at)
  )
  select jsonb_build_object(
    'source', 'provider_revenue_events',
    'generated_at', now(),
    'currency', 'USD',
    'totals', jsonb_build_object(
      'gross_customer_fees', coalesce(sum(event_sign * gross_usd),0),
      'provider_costs', coalesce(sum(event_sign * cost_usd),0),
      'net_revenue', coalesce(sum(event_sign * net_usd),0),
      'unconverted_rows', count(*) filter (where usd_rate is null),
      'exception_rows', count(*) filter (where reconciliation_status <> 'reconciled')
    ),
    'breakdown', jsonb_build_object(
      'walletActivations', coalesce(sum(event_sign * net_usd) filter (where source_type = 'bridge_virtual_account'),0),
      'transactionFees', coalesce(sum(event_sign * net_usd) filter (where source_type in ('bridge_transfer','yellow_card_transaction') and revenue_category <> 'fx_markup'),0),
      'fxMarkup', coalesce(sum(event_sign * net_usd) filter (where revenue_category = 'fx_markup'),0),
      'cardIssuance', 0,
      'other', 0
    ),
    'providers', jsonb_build_object(
      'bridge', coalesce((select to_jsonb(p) from provider_rows p where provider='bridge'), jsonb_build_object('provider','bridge','gross_usd',0,'cost_usd',0,'net_usd',0,'unconverted',0,'reconciled',0,'exceptions',0)),
      'yellow_card', coalesce((select to_jsonb(p) || jsonb_build_object('capture_status','available') from provider_rows p where provider='yellow_card'), jsonb_build_object('provider','yellow_card','gross_usd',0,'cost_usd',0,'net_usd',0,'unconverted',0,'reconciled',0,'exceptions',0,'capture_status','unavailable_live_execution_not_implemented'))
    ),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month',month_key,'newRevenue',revenue) order by month_key) from monthly), '[]'::jsonb)
  ) into v_result
  from signed;
  return v_result;
end;
$$;

revoke all on function public.admin_provider_revenue_summary() from public, anon;
grant execute on function public.admin_provider_revenue_summary() to authenticated, service_role;

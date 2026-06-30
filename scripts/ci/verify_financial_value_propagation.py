#!/usr/bin/env python3
"""
Deploy-blocking value propagation checks for financial read model.

Checks (linked production DB):
1) VA ledger net (bridge_balance_ledger) matches VA projection totals
   (bridge_virtual_account_balances) per owner+currency.
2) Every owner with non-zero financial ledger net has at least one recent
   notification row (drift signal for projection/notification pipeline).
3) Canonical financial surfaces consume backendAPI.financial.getSnapshot.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run_json(sql: str) -> dict:
    compact_sql = " ".join(sql.split())
    cmd = [
        "/bin/zsh", "-lc",
        f"cd {ROOT} && SUPABASE_DISABLE_TELEMETRY=1 supabase db query --linked -o json {json.dumps(compact_sql)}",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "supabase db query failed")
    out = proc.stdout
    start = out.find("{")
    if start < 0:
        raise RuntimeError("no JSON output from supabase db query")
    return json.loads(out[start:])


def parse_num(v: object) -> int:
    try:
        return int(str(v))
    except Exception:
        return 0


def fail(msg: str) -> int:
    print(f"[FAIL] {msg}")
    return 1


def main() -> int:
    failures = 0

    # 1) Ledger -> VA projection parity by owner/currency (last 30 days)
    va_parity_sql = """
with ledger as (
  select
    coalesce(user_id, business_user_id) as owner_id,
    upper(currency) as currency,
    sum(case when lower(direction)='debit' then -abs(amount_minor) else abs(amount_minor) end) as ledger_minor
  from public.bridge_balance_ledger
  where entity_type = 'virtual_account'
    and created_at >= now() - interval '30 days'
  group by 1,2
),
va_proj as (
  select
    coalesce(user_id, business_user_id) as owner_id,
    upper(currency) as currency,
    sum(available_balance_minor) as proj_minor
  from public.bridge_virtual_account_balances
  group by 1,2
)
select
  coalesce(l.owner_id, v.owner_id) as owner_id,
  coalesce(l.currency, v.currency) as currency,
  coalesce(l.ledger_minor,0) as ledger_minor,
  coalesce(v.proj_minor,0) as proj_minor,
  abs(coalesce(l.ledger_minor,0) - coalesce(v.proj_minor,0)) as delta_minor
from ledger l
full outer join va_proj v
  on l.owner_id = v.owner_id and l.currency = v.currency
where abs(coalesce(l.ledger_minor,0) - coalesce(v.proj_minor,0)) > 1
order by delta_minor desc
limit 50;
"""
    va_rows = run_json(va_parity_sql).get("rows", [])
    if va_rows:
        failures += fail(f"VA ledger/projection drift detected ({len(va_rows)} rows >1 minor unit)")
    else:
        print("[OK] VA ledger/projection parity")

    # 2) Owners with non-zero ledger net must have recent notification signal.
    notif_sql = """
with owner_net as (
  select
    coalesce(user_id, business_user_id) as owner_id,
    sum(case when lower(direction)='debit' then -abs(amount_minor) else abs(amount_minor) end) as net_minor
  from public.bridge_balance_ledger
  where created_at >= now() - interval '7 days'
    and entity_type in ('wallet','virtual_account')
  group by 1
),
owners_with_value as (
  select owner_id from owner_net where owner_id is not null and net_minor <> 0
),
notif as (
  select user_id as owner_id, count(*) as notif_count
  from public.notifications
  where created_at >= now() - interval '7 days'
  group by 1
)
select o.owner_id, coalesce(n.notif_count, 0) as notif_count
from owners_with_value o
left join notif n on n.owner_id = o.owner_id
where coalesce(n.notif_count, 0) = 0
limit 50;
"""
    notif_rows = run_json(notif_sql).get("rows", [])
    if notif_rows:
        failures += fail(f"value->notification propagation missing for {len(notif_rows)} owners")
    else:
        print("[OK] value->notification propagation signal present")

    # 3) Static surface contract: all customer financial screens must consume snapshot.
    must_use_snapshot = {
        "components/app/Dashboard.tsx": True,
        "components/wallet/WalletScreen.tsx": True,
        "components/transactions/TransactionsScreen.tsx": True,
        "components/notifications/NotificationsScreen.tsx": True,
        "components/profile/ProfileScreen.tsx": True,
        "components/send/SendMoneyFlow.tsx": True,
        "components/receive/ReceiveMoneyScreen.tsx": True,
    }
    for rel in must_use_snapshot:
        txt = (ROOT / rel).read_text(encoding="utf-8")
        if "backendAPI.financial.getSnapshot" not in txt:
            failures += fail(f"{rel} does not consume canonical snapshot")
        else:
            print(f"[OK] {rel} consumes canonical snapshot")

    # 4) Ban direct balance math in these surfaces (coarse guard).
    banned_patterns = [
        r"backendAPI\.wallets\.getWallets\(",
        r"backendAPI\.transactions\.getTransactions\(",
    ]
    for rel in must_use_snapshot:
        txt = (ROOT / rel).read_text(encoding="utf-8")
        for pat in banned_patterns:
            if re.search(pat, txt):
                failures += fail(f"{rel} contains banned direct financial read pattern /{pat}/")
            else:
                print(f"[OK] {rel} no banned pattern /{pat}/")

    if failures:
        print(f"\nfinancial_value_propagation: FAIL ({failures} checks)")
        return 1
    print("\nfinancial_value_propagation: PASS")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"financial_value_propagation: FAIL (error={exc})")
        sys.exit(1)

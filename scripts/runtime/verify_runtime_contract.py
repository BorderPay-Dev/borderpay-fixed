#!/usr/bin/env python3
"""
Live runtime contract verification (read-only).

Purpose:
- Fail fast before deployment if production runtime prerequisites are missing.
- Uses Supabase CLI read-only queries and function inventory.

Usage:
  python3 scripts/runtime/verify_runtime_contract.py
"""
from __future__ import annotations
import json
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

REQUIRED_TABLES = {
    "bridge_external_accounts",
    "bridge_transfers",
    "bridge_virtual_account_balances",
    "bridge_virtual_accounts",
    "bridge_wallets",
    "bridge_webhook_events",
    "business_profiles",
    "pending_events",
    "transactions",
    "user_profiles",
    "webhook_logs",
}

REQUIRED_COLUMNS = {
    ("bridge_wallets", "bridge_customer_id"),
    ("bridge_wallets", "bridge_wallet_id"),
    ("bridge_wallets", "currency"),
    ("bridge_wallets", "chain"),
    ("bridge_virtual_accounts", "bridge_virtual_account_id"),
    ("bridge_virtual_account_balances", "available_balance_minor"),
    ("bridge_transfers", "bridge_transfer_id"),
    ("bridge_transfers", "state"),
    ("bridge_transfers", "raw"),
    ("bridge_external_accounts", "bridge_external_account_id"),
    ("pending_events", "status"),
    ("pending_events", "next_attempt_at"),
    ("webhook_logs", "status"),
}

REQUIRED_INDEXES = {
    "transactions_bridge_transfer_uniq",
    "pending_events_queue_idx",
    "pending_events_locked_idx",
    "bwe_target_idx",
    "bt_state_idx",
    "bw_customer_idx",
    "bva_customer_idx",
}

REQUIRED_CONSTRAINTS = {
    "pending_events_event_id_fkey",
    "pending_events_event_id_key",
    "pending_events_status_check",
    "webhook_logs_pkey",
    "webhook_logs_status_check",
}

REQUIRED_RPCS = {
    "apply_bridge_va_credit",
    "claim_pending_events",
    "complete_pending_event",
    "fail_pending_event",
    "ingest_bridge_event",
    "reap_stuck_processing",
    "upsert_bridge_transaction",
}

REQUIRED_EDGE_FUNCTIONS = {
    "bridge-webhook",
    "process-pending-events",
    "bridge-transfer",
    "bridge-bulk-payout",
    "bridge-virtual-account",
    "bridge-wallet",
    "bridge-external-account",
    "bridge-sync-accounts",
    "bridge-provision-stablecoins",
    "deactivate-inactive-virtual-accounts",
}

REQUIRED_CRON_JOBS = {
    "process-pending-events-drain",
    "reap-stuck-processing",
    "deactivate-inactive-virtual-accounts",
}


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def non_empty(v: object) -> bool:
    return bool(str(v or "").strip())


def detect_config_source(text: str) -> str:
    s = (text or "").lower()
    has_legacy = "app_config_get('worker_url')" in s or "app_config_get('worker_auth_token')" in s
    has_guc = "current_setting('app.process_pending_events_url'" in s or "current_setting('app.process_pending_events_jwt'" in s
    if has_legacy and has_guc:
        return "hybrid"
    if has_legacy:
        return "legacy_app_config"
    if has_guc:
        return "guc"
    return "unknown"


def redacted_url(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return "<empty>"
    if "://" not in u:
        return u[:64]
    scheme, rest = u.split("://", 1)
    host = rest.split("/", 1)[0]
    return f"{scheme}://{host}/..."


def run_shell(cmd: str, retries: int = 3) -> str:
    last_err = ""
    for i in range(retries):
        proc = subprocess.run(
            ["/bin/zsh", "-lc", f"cd /Users/a/Downloads/borderpay-fixed && SUPABASE_DISABLE_TELEMETRY=1 {cmd}"],
            cwd=ROOT, capture_output=True, text=True
        )
        if proc.returncode == 0:
            return proc.stdout
        last_err = proc.stderr.strip() or proc.stdout.strip() or f"command failed: {cmd}"
        if i < retries - 1:
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(last_err)


def run(cmd: list[str]) -> dict:
    out = run_shell(" ".join(cmd))
    first = out.find("{")
    if first < 0:
        raise RuntimeError(f"no JSON output from command: {' '.join(cmd)}")
    return json.loads(out[first:])


def main() -> int:
    checks: list[Check] = []

    cols_json = run([
        "supabase", "db", "query", "--linked", "-o", "json",
        "\"select table_name, column_name from information_schema.columns where table_schema='public';\"",
    ])
    cols = {(r["table_name"], r["column_name"]) for r in cols_json.get("rows", [])}
    tables = {t for t, _ in cols}

    idx_json = run([
        "supabase", "db", "query", "--linked", "-o", "json",
        "\"select indexname from pg_indexes where schemaname='public';\"",
    ])
    idx = {r["indexname"] for r in idx_json.get("rows", [])}

    con_json = run([
        "supabase", "db", "query", "--linked", "-o", "json",
        "\"select conname from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public';\"",
    ])
    cons = {r["conname"] for r in con_json.get("rows", [])}

    rpc_json = run([
        "supabase", "db", "query", "--linked", "-o", "json",
        "\"select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';\"",
    ])
    rpcs = {r["proname"] for r in rpc_json.get("rows", [])}

    fn_out = run_shell("supabase functions list --project-ref orwrcpwsffjlvzuraxjc --output-format json")
    fn_rows = json.loads(fn_out or "[]")
    fn_names = {r.get("slug") for r in fn_rows if r.get("slug")}

    cron_json = run([
        "supabase", "db", "query", "--linked", "-o", "json",
        "\"select jobname, active, command from cron.job;\"",
    ])
    cron_names = {r["jobname"] for r in cron_json.get("rows", []) if r.get("active") is True}
    cron_rows = cron_json.get("rows", [])
    drain_job = next((r for r in cron_rows if r.get("jobname") == "process-pending-events-drain" and r.get("active") is True), None)
    cron_source = detect_config_source(str((drain_job or {}).get("command") or ""))

    settings_row = {}
    settings_json = run([
        "supabase", "db", "query", "--linked", "-o", "json",
        "\"select current_setting('app.process_pending_events_url', true) as guc_url, current_setting('app.process_pending_events_jwt', true) as guc_jwt;\"",
    ])
    settings_row.update((settings_json.get("rows") or [{}])[0])

    # Legacy app_config is supported runtime mode. Not all environments need
    # app_config table, so probe safely.
    try:
        legacy_json = run([
            "supabase", "db", "query", "--linked", "-o", "json",
            "\"select max(case when key='worker_url' then value end) as legacy_url, max(case when key='worker_auth_token' then value end) as legacy_jwt from public.app_config where key in ('worker_url','worker_auth_token');\"",
        ])
        settings_row.update((legacy_json.get("rows") or [{}])[0])
    except Exception:
        settings_row.setdefault("legacy_url", None)
        settings_row.setdefault("legacy_jwt", None)

    func_defs_json = run([
        "supabase", "db", "query", "--linked", "-o", "json",
        "\"select proname, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('fire_pending_event_webhook','invoke_process_pending_events_drain') order by proname;\"",
    ])
    func_defs = {r.get("proname"): str(r.get("def") or "") for r in func_defs_json.get("rows", [])}
    fire_source = detect_config_source(func_defs.get("fire_pending_event_webhook", ""))
    invoke_source = detect_config_source(func_defs.get("invoke_process_pending_events_drain", "")) if "invoke_process_pending_events_drain" in func_defs else "absent"

    has_guc_url = non_empty(settings_row.get("guc_url"))
    has_guc_jwt = non_empty(settings_row.get("guc_jwt"))
    has_legacy_url = non_empty(settings_row.get("legacy_url"))
    has_legacy_jwt = non_empty(settings_row.get("legacy_jwt"))

    usable_guc = has_guc_url and has_guc_jwt
    usable_legacy = has_legacy_url and has_legacy_jwt

    if usable_guc and usable_legacy:
        runtime_mode = "Hybrid"
    elif usable_legacy:
        runtime_mode = "Legacy app_config"
    elif usable_guc:
        runtime_mode = "GUC"
    else:
        runtime_mode = "Invalid"

    warnings: list[str] = []
    if usable_guc and usable_legacy:
        if str(settings_row.get("guc_url") or "").strip() != str(settings_row.get("legacy_url") or "").strip():
            warnings.append("hybrid_url_mismatch")
        if (has_guc_jwt and has_legacy_jwt) and str(settings_row.get("guc_jwt") or "").strip() != str(settings_row.get("legacy_jwt") or "").strip():
            warnings.append("hybrid_auth_mismatch")

    expected_source = (
        "legacy_app_config" if runtime_mode == "Legacy app_config"
        else "guc" if runtime_mode == "GUC"
        else "hybrid" if runtime_mode == "Hybrid"
        else "unknown"
    )
    if cron_source not in (expected_source, "hybrid") and cron_source != "unknown":
        warnings.append(f"cron_source_split:{cron_source}")
    if fire_source not in (expected_source, "hybrid") and fire_source != "unknown":
        warnings.append(f"fire_source_split:{fire_source}")
    if invoke_source not in ("absent", expected_source, "hybrid", "unknown"):
        warnings.append(f"invoke_source_split:{invoke_source}")
    if runtime_mode in ("Legacy app_config", "Hybrid") and not str(settings_row.get("legacy_url") or "").strip().endswith("/functions/v1/process-pending-events"):
        warnings.append("legacy_worker_url_unexpected_shape")
    if runtime_mode in ("GUC", "Hybrid") and not str(settings_row.get("guc_url") or "").strip().endswith("/functions/v1/process-pending-events"):
        warnings.append("guc_worker_url_unexpected_shape")

    missing_tables = sorted(REQUIRED_TABLES - tables)
    checks.append(Check("C1 required tables", not missing_tables, f"missing={missing_tables}"))

    missing_cols = sorted(REQUIRED_COLUMNS - cols)
    checks.append(Check("C2 required columns", not missing_cols, f"missing={missing_cols}"))

    missing_idx = sorted(REQUIRED_INDEXES - idx)
    checks.append(Check("C3 required indexes", not missing_idx, f"missing={missing_idx}"))

    missing_cons = sorted(REQUIRED_CONSTRAINTS - cons)
    checks.append(Check("C4 required constraints", not missing_cons, f"missing={missing_cons}"))

    missing_rpcs = sorted(REQUIRED_RPCS - rpcs)
    checks.append(Check("C5 required RPCs", not missing_rpcs, f"missing={missing_rpcs}"))

    missing_fns = sorted(REQUIRED_EDGE_FUNCTIONS - fn_names)
    checks.append(Check("C6 required Edge functions", not missing_fns, f"missing={missing_fns}"))

    missing_cron = sorted(REQUIRED_CRON_JOBS - cron_names)
    checks.append(Check("C7 required cron jobs active", not missing_cron, f"missing={missing_cron}"))

    queue_ok = runtime_mode != "Invalid"
    queue_detail = (
        f"runtime_mode={runtime_mode}; "
        f"configuration_source_detected={expected_source}; "
        f"queue_endpoint={redacted_url(str(settings_row.get('legacy_url') if runtime_mode == 'Legacy app_config' else settings_row.get('guc_url') if runtime_mode == 'GUC' else settings_row.get('guc_url') or settings_row.get('legacy_url') or ''))}; "
        f"authentication_source={'app_config.worker_auth_token' if runtime_mode == 'Legacy app_config' else 'current_setting(app.process_pending_events_jwt)' if runtime_mode == 'GUC' else 'hybrid' if runtime_mode == 'Hybrid' else 'missing'}; "
        f"evidence=cron_source:{cron_source},fire_source:{fire_source},invoke_source:{invoke_source}; "
        f"warnings={warnings if warnings else 'none'}"
    )
    checks.append(Check("C8 queue runtime mode supported", queue_ok, queue_detail if queue_ok else f"{queue_detail}; invalid_state: neither legacy nor GUC provides usable worker endpoint+auth"))

    print("runtime_contract_live_verify:")
    ok = True
    for c in checks:
        show_detail = (c.name.startswith("C8"))
        print(f"  [{'OK' if c.ok else 'XX'}] {c.name}" + ((f" -> {c.detail}") if (show_detail or not c.ok) else ""))
        ok = ok and c.ok
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c.ok)}/{len(checks)})")
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"runtime_contract_live_verify: FAIL (error={e})")
        sys.exit(1)

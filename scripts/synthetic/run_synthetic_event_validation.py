#!/usr/bin/env python3
"""
Synthetic Event Validation runner.

Default mode: plan-only (no event injection).
Execute mode: injects bridge_test events via bridge-test-webhook and collects evidence.

Usage:
  python3 scripts/synthetic/run_synthetic_event_validation.py
  python3 scripts/synthetic/run_synthetic_event_validation.py --execute
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"


@dataclass
class Scenario:
    name: str
    event_type: str
    event_id: str
    payload: dict
    replay_group_key: str


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def zsh(cmd: str) -> tuple[int, str, str]:
    p = subprocess.run(["/bin/zsh", "-lc", cmd], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def supabase_query(sql: str) -> list[dict]:
    sql_escaped = sql.replace('"', '\\"')
    cmd = (
        f"cd {shlex.quote(str(ROOT))} && "
        f"SUPABASE_DISABLE_TELEMETRY=1 supabase db query --linked -o json \"{sql_escaped}\""
    )
    rc, out, err = zsh(cmd)
    if rc != 0:
        raise RuntimeError((out + "\n" + err).strip())
    return json.loads(out).get("rows", [])


def post_json(url: str, token: str, body: dict) -> tuple[int, dict]:
    req = Request(url=url, method="POST", data=json.dumps(body).encode("utf-8"), headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    try:
        with urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8", errors="replace")
            return r.status, json.loads(raw) if raw else {}
    except Exception as e:
        return 0, {"error": str(e)}


def scenarios() -> list[Scenario]:
    return [
        Scenario(
            name="deposit_activity",
            event_type="virtual_account.activity.created",
            event_id="dep_evt_001",
            replay_group_key="deposit:dep_evt_001",
            payload={
                "id": "dep_evt_001",
                "event_object": {
                    "id": "va_activity_001",
                    "virtual_account_id": "va_test_001",
                    "customer_id": "cust_test_001",
                    "currency": "USD",
                    "amount": "25.00",
                    "reference": "synthetic_deposit_001",
                },
            },
        ),
        Scenario(
            name="transfer_processed",
            event_type="transfer.processed",
            event_id="xfer_evt_001",
            replay_group_key="transfer:xfer_evt_001",
            payload={
                "id": "xfer_evt_001",
                "event_object": {
                    "id": "xfer_001",
                    "transfer_id": "xfer_001",
                    "customer_id": "cust_test_001",
                    "amount": 12.50,
                    "currency": "USD",
                    "state": "payment_processed",
                    "source": {"type": "wallet"},
                    "destination": {"type": "external_bank"},
                },
            },
        ),
        Scenario(
            name="transfer_failed_with_retry",
            event_type="transfer.failed",
            event_id="xfer_evt_002",
            replay_group_key="transfer:xfer_evt_002",
            payload={
                "id": "xfer_evt_002",
                "test_control": {"force_fail": True},
                "event_object": {
                    "id": "xfer_002",
                    "transfer_id": "xfer_002",
                    "customer_id": "cust_test_001",
                    "amount": 7.20,
                    "currency": "USD",
                    "state": "error",
                },
            },
        ),
        Scenario(
            name="external_account_updated",
            event_type="external_account.updated",
            event_id="ext_evt_001",
            replay_group_key="external:ext_evt_001",
            payload={
                "id": "ext_evt_001",
                "event_object": {
                    "id": "ext_001",
                    "external_account_id": "ext_001",
                    "customer_id": "cust_test_001",
                    "status": "active",
                    "currency": "USD",
                    "account_type": "us",
                    "last_4": "4242",
                },
            },
        ),
    ]


def write_report(path: Path, title: str, lines: list[str]) -> None:
    path.write_text("\n".join([f"# {title}", "", f"- Generated (UTC): {utc_now()}", "", *lines, ""]), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="Inject synthetic events and collect live evidence")
    args = ap.parse_args()

    DOCS.mkdir(parents=True, exist_ok=True)

    supabase_url = (os.environ.get("SUPABASE_URL") or "").strip()
    token = (os.environ.get("BRIDGE_TEST_WEBHOOK_TOKEN") or "").strip()

    plan_lines = [
        "## Scenarios",
        "",
    ]
    for s in scenarios():
        plan_lines.append(f"- `{s.name}`: `{s.event_type}` (`{s.event_id}`)")

    if not args.execute:
        plan_lines.extend([
            "",
            "## Execution Status",
            "",
            "- Status: `PENDING_EXECUTION`",
            "- No synthetic events were injected in this run.",
            "- Run with `--execute` after explicit approval and environment setup.",
        ])
        write_report(DOCS / "SYNTHETIC_EVENT_EXECUTION_REPORT.md", "Synthetic Event Execution Report", plan_lines)
        write_report(DOCS / "ISOLATION_BOUNDARY_VERIFICATION.md", "Isolation Boundary Verification", [
            "## Status",
            "",
            "- `PENDING_EXECUTION`",
            "- This file will record proof that synthetic runs wrote only queue/log boundaries and zero financial tables.",
        ])
        write_report(DOCS / "REPLAY_DETERMINISM_REPORT.md", "Replay Determinism Report", [
            "## Status",
            "",
            "- `PENDING_EXECUTION`",
            "- This file will capture duplicate replay evidence for identical synthetic event IDs.",
        ])
        print("PENDING_EXECUTION reports generated.")
        return 0

    if not supabase_url or not token:
        print("Missing SUPABASE_URL or BRIDGE_TEST_WEBHOOK_TOKEN", file=sys.stderr)
        return 2

    endpoint = f"{supabase_url.rstrip('/')}/functions/v1/bridge-test-webhook"
    results: list[tuple[Scenario, int, dict]] = []

    for s in scenarios():
        body = {
            "test_case_id": "synthetic_validation_phase",
            "event_type": s.event_type,
            "event_id": s.event_id,
            "replay_group_key": s.replay_group_key,
            "payload": s.payload,
        }
        results.append((s, *post_json(endpoint, token, body)))

    # Replay one transfer event intentionally.
    replay = scenarios()[1]
    replay_status, replay_body = post_json(endpoint, token, {
        "test_case_id": "synthetic_validation_phase",
        "event_type": replay.event_type,
        "event_id": replay.event_id,
        "replay_group_key": replay.replay_group_key,
        "payload": replay.payload,
    })

    # Read-only evidence.
    queue_rows = supabase_query(
        """
        select source, status, count(*) as n
        from public.pending_events
        where event_id like 'bridge_test:synthetic_validation_phase:%'
        group by source, status
        order by source, status;
        """
    )
    write_guard_rows = supabase_query(
        """
        select
          (select count(*) from public.transactions where provider='bridge' and coalesce(metadata->>'test_origin','false')='true') as tx_test_writes,
          (select count(*) from public.bridge_transfers where coalesce(raw->>'test_origin','false')='true') as bridge_transfer_test_writes,
          (select count(*) from public.bridge_wallets where bridge_customer_id like 'cust_test_%') as bridge_wallet_test_writes,
          (select count(*) from public.bridge_virtual_accounts where bridge_customer_id like 'cust_test_%') as bridge_va_test_writes,
          (select count(*) from public.bridge_external_accounts where bridge_customer_id like 'cust_test_%') as bridge_external_test_writes;
        """
    )

    exec_lines = ["## Injection Results", ""]
    for s, status, body in results:
        exec_lines.append(f"- `{s.name}`: http_status=`{status}` response=`{json.dumps(body)}`")
    exec_lines.extend([
        "",
        "## Replay Check",
        "",
        f"- replay `{replay.name}`: http_status=`{replay_status}` response=`{json.dumps(replay_body)}`",
        "",
        "## Queue Snapshot",
        "",
        f"```json\n{json.dumps(queue_rows, indent=2)}\n```",
    ])
    write_report(DOCS / "SYNTHETIC_EVENT_EXECUTION_REPORT.md", "Synthetic Event Execution Report", exec_lines)

    isolation_lines = [
        "## Financial Write Leakage Check",
        "",
        f"```json\n{json.dumps(write_guard_rows, indent=2)}\n```",
        "",
        "- PASS only when all counters are zero.",
    ]
    write_report(DOCS / "ISOLATION_BOUNDARY_VERIFICATION.md", "Isolation Boundary Verification", isolation_lines)

    replay_lines = [
        "## Replay Result",
        "",
        f"- Replay response: http_status=`{replay_status}` payload=`{json.dumps(replay_body)}`",
        "- PASS when replay returns duplicate/queued-idempotent and queue identity counts remain 1 per event id.",
    ]
    write_report(DOCS / "REPLAY_DETERMINISM_REPORT.md", "Replay Determinism Report", replay_lines)

    print("Synthetic execution reports generated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""
Phase 3 live Bridge sandbox validation runner (sandbox-only).

Scope for step 1:
  - Enforce non-production execution fences.
  - Verify sandbox credentials and connectivity.
  - Emit required Phase 3 report artifacts with evidence.

This script intentionally performs no production writes and no deployment.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
PROD_PROJECT_REF = "orwrcpwsffjlvzuraxjc"


@dataclass
class Check:
    name: str
    passed: bool
    evidence: str
    impact: str
    risk: str


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def mask(value: str, keep: int = 8) -> str:
    if not value:
        return "UNSET"
    if len(value) <= keep:
        return "*" * len(value)
    return value[:keep] + "..."


def http_json(
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 30,
) -> tuple[int, Any, dict[str, str]]:
    payload = None
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = Request(url=url, method=method.upper(), data=payload, headers=req_headers)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw) if raw else {}
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            return int(resp.status), data, hdrs
    except HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            data = json.loads(raw) if raw else {"raw": raw}
        except Exception:
            data = {"raw": raw}
        hdrs = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
        return int(e.code), data, hdrs
    except URLError as e:
        return 0, {"error": f"network_error: {e.reason}"}, {}
    except Exception as e:
        return 0, {"error": f"request_failed: {e}"}, {}


def detect_project_ref_from_url(url: str) -> str:
    # https://<ref>.supabase.co
    if "https://" in url and ".supabase.co" in url:
        host = url.split("://", 1)[1].split("/", 1)[0]
        return host.split(".supabase.co", 1)[0]
    return ""


def run_preflight() -> list[Check]:
    checks: list[Check] = []

    supabase_url = get_env("LIVE_SUPABASE_URL")
    supabase_key = get_env("LIVE_SUPABASE_SERVICE_ROLE_KEY")
    bridge_key = get_env("BRIDGE_API_KEY")
    bridge_base = get_env("BRIDGE_BASE_URL") or "https://api.bridge.xyz"
    sandbox_ref = get_env("LIVE_SUPABASE_PROJECT_REF")

    missing = [
        k for k, v in {
            "LIVE_SUPABASE_URL": supabase_url,
            "LIVE_SUPABASE_SERVICE_ROLE_KEY": supabase_key,
            "BRIDGE_API_KEY": bridge_key,
        }.items() if not v
    ]
    checks.append(Check(
        name="P1 required sandbox env present",
        passed=len(missing) == 0,
        evidence=f"missing={missing}" if missing else "all required env vars are set",
        impact="No live validation can run without explicit sandbox credentials.",
        risk="critical",
    ))

    project_ref = sandbox_ref or detect_project_ref_from_url(supabase_url)
    is_prod_ref = (project_ref == PROD_PROJECT_REF)
    checks.append(Check(
        name="P2 target Supabase project is non-production",
        passed=(not is_prod_ref and bool(project_ref)),
        evidence=f"project_ref={project_ref or 'unknown'}; blocked_prod_ref={PROD_PROJECT_REF}",
        impact="Prevents accidental writes/reads against production while running live scenarios.",
        risk="critical",
    ))

    key_kind = "sandbox" if bridge_key.startswith("sk-test") else "live" if bridge_key.startswith("sk-live") else "unknown"
    checks.append(Check(
        name="P3 Bridge key is sandbox key",
        passed=(key_kind == "sandbox"),
        evidence=f"bridge_key_prefix={mask(bridge_key)}; detected_key_kind={key_kind}",
        impact="Prevents live Bridge account mutations during validation.",
        risk="critical",
    ))

    if supabase_url and supabase_key and not is_prod_ref:
        status, data, _ = http_json(
            "POST",
            f"{supabase_url.rstrip('/')}/functions/v1/bridge-ping",
            headers={
                "Authorization": f"Bearer {supabase_key}",
                "apikey": supabase_key,
            },
            body={},
            timeout=40,
        )
        ok = 200 <= status < 300 and bool(data.get("ok"))
        checks.append(Check(
            name="P4 bridge-ping function reachable in sandbox",
            passed=ok,
            evidence=f"http_status={status}; response={json.dumps(data)[:500]}",
            impact="Confirms Supabase edge + Bridge secret wiring in target sandbox.",
            risk="high",
        ))
    else:
        checks.append(Check(
            name="P4 bridge-ping function reachable in sandbox",
            passed=False,
            evidence="skipped: missing sandbox credentials or target resolved to production",
            impact="Cannot confirm runtime wiring without safe sandbox target.",
            risk="high",
        ))

    if bridge_key and key_kind == "sandbox":
        status, data, headers = http_json(
            "GET",
            f"{bridge_base.rstrip('/')}/v0/customers?limit=1",
            headers={"Api-Key": bridge_key, "User-Agent": "borderpay-live-validation/1.0"},
            timeout=40,
        )
        ok = status in (200, 204)
        checks.append(Check(
            name="P5 Bridge sandbox API reachable",
            passed=ok,
            evidence=f"http_status={status}; request_id={headers.get('x-request-id')}; response={json.dumps(data)[:500]}",
            impact="Confirms Bridge sandbox endpoint/API key are usable before scenario execution.",
            risk="high",
        ))
    else:
        checks.append(Check(
            name="P5 Bridge sandbox API reachable",
            passed=False,
            evidence="skipped: BRIDGE_API_KEY missing or not sandbox key",
            impact="Live sandbox scenarios cannot run without a valid sandbox API key.",
            risk="high",
        ))

    return checks


def write_report(path: Path, title: str, checks: list[Check]) -> None:
    overall = "PASS" if all(c.passed for c in checks) else "FAIL"
    lines: list[str] = [
        f"# {title}",
        "",
        f"- Generated (UTC): {utc_now()}",
        f"- Overall: **{overall}**",
        "",
        "## Preflight (Step 1)",
        "",
    ]
    for c in checks:
        lines.extend([
            f"### {c.name}",
            f"- Result: **{'PASS' if c.passed else 'FAIL'}**",
            f"- Evidence: `{c.evidence}`",
            f"- Business impact: {c.impact}",
            f"- Deployment risk: {c.risk}",
            "",
        ])
    if not all(c.passed for c in checks):
        lines.extend([
            "## Blocking Issues",
            "",
            "- Sandbox credentials/target are not fully validated yet. Full Phase 3 scenario execution is blocked until preflight is all PASS.",
            "",
            "## Rollback Strategy",
            "",
            "- Not applicable for Step 1 preflight (no runtime mutation, no deployment, no migration).",
            "",
        ])
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    checks = run_preflight()
    DOCS.mkdir(parents=True, exist_ok=True)

    reports = [
        ("LIVE_BRIDGE_VALIDATION_REPORT.md", "Live Bridge Sandbox Validation Report"),
        ("LIVE_FINANCIAL_CORRECTNESS_REPORT.md", "Live Financial Correctness Report"),
        ("LIVE_WEBHOOK_MATRIX.md", "Live Webhook Matrix"),
        ("LIVE_RECONCILIATION_REPORT.md", "Live Reconciliation Report"),
    ]
    for filename, title in reports:
        write_report(DOCS / filename, title, checks)

    print("live_bridge_validation_preflight:")
    for c in checks:
        print(f"  [{'OK' if c.passed else 'XX'}] {c.name} -> {c.evidence}")
    ok = all(c.passed for c in checks)
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c.passed)}/{len(checks)})")
    print("reports:")
    for filename, _ in reports:
        print(f"  - {DOCS / filename}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())


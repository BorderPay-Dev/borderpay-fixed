#!/usr/bin/env python3
"""Step 2S: single go/no-go verifier for API onboarding live-readiness."""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

REQUIRED_FILES = [
    "docs/api/openapi-v1.yaml",
    "docs/api/postman/BorderPay_API_v1.postman_collection.json",
    "docs/api/curl/API_V1_CURL_COOKBOOK.md",
    "docs/api/onboarding/RUNBOOK_INDEX.md",
    "docs/api/onboarding/FINAL_OPERATOR_QUICKSTART.md",
    "docs/api/onboarding/SECRETS_CHECKLIST.md",
    "docs/api/onboarding/CUTOVER_COMMAND_SHEET.md",
    "docs/api/onboarding/SIGNOFF_RUBRIC.md",
    "docs/api/onboarding/LOCAL_OPS_COMMAND_BLOCK.md",
    "docs/api/onboarding/WORKFLOW_AND_SECRETS_SETUP.md",
    "docs/api/onboarding/TENANT_DRILL_MATRIX_TEMPLATE.json",
    ".github/workflows/api-contract-pack.yml",
    ".github/workflows/api-rollout-watchdog.yml",
    "scripts/api/run_release_candidate_gate.sh",
    "scripts/api/run_rollout_watchdog.sh",
    "scripts/api/run_tenant_golive_drill.sh",
    "scripts/api/promote_tenant_closed_beta.sh",
    "scripts/api/emergency_rollback_tenant.sh",
    "scripts/api/monitor_api_rollout.sh",
]

REQUIRED_EXECUTABLE_SCRIPTS = [
    "scripts/api/run_release_candidate_gate.sh",
    "scripts/api/run_rollout_watchdog.sh",
    "scripts/api/run_tenant_golive_drill.sh",
    "scripts/api/promote_tenant_closed_beta.sh",
    "scripts/api/emergency_rollback_tenant.sh",
    "scripts/api/monitor_api_rollout.sh",
]

REQUIRED_WATCHDOG_SECRETS = [
    "API_GATEWAY_SUPABASE_URL",
    "API_GATEWAY_SERVICE_ROLE_KEY",
    "API_GATEWAY_TENANT_IDS",
]

REQUIRED_CHECKLIST_ITEMS = [
    "API_GATEWAY_SUPABASE_URL",
    "API_GATEWAY_SERVICE_ROLE_KEY",
    "API_GATEWAY_TENANT_IDS",
    "auto_rollback_on_alert=false",
    "window_minutes=15",
]


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    raise SystemExit(1)


def ok(msg: str) -> None:
    print(f"[OK] {msg}")


def assert_file_exists(rel_path: str) -> pathlib.Path:
    p = ROOT / rel_path
    if not p.exists():
        fail(f"missing required file: {rel_path}")
    return p


def main() -> None:
    for rel in REQUIRED_FILES:
        assert_file_exists(rel)
    ok("required file set present")

    for rel in REQUIRED_EXECUTABLE_SCRIPTS:
        p = ROOT / rel
        if not p.exists() or not p.is_file():
            fail(f"missing required script: {rel}")
        if not (p.stat().st_mode & 0o111):
            fail(f"script is not executable: {rel}")
    ok("required scripts are executable")

    watchdog = (ROOT / ".github/workflows/api-rollout-watchdog.yml").read_text(
        encoding="utf-8"
    )
    for sec in REQUIRED_WATCHDOG_SECRETS:
        if sec not in watchdog:
            fail(f"watchdog workflow missing secret reference: {sec}")
    if "workflow_dispatch" not in watchdog:
        fail("watchdog workflow missing workflow_dispatch trigger")
    if "schedule:" not in watchdog:
        fail("watchdog workflow missing schedule trigger")
    ok("watchdog workflow secret/trigger checks passed")

    setup_doc = (ROOT / "docs/api/onboarding/WORKFLOW_AND_SECRETS_SETUP.md").read_text(
        encoding="utf-8"
    )
    for token in REQUIRED_CHECKLIST_ITEMS:
        if token not in setup_doc:
            fail(f"workflow/secrets checklist missing token: {token}")
    ok("workflow/secrets checklist coverage passed")

    command_sheet = (ROOT / "docs/api/onboarding/CUTOVER_COMMAND_SHEET.md").read_text(
        encoding="utf-8"
    )
    for cmd in (
        "./scripts/api/run_release_candidate_gate.sh",
        "./scripts/api/run_rollout_watchdog.sh",
        "./scripts/api/emergency_rollback_tenant.sh",
    ):
        if cmd not in command_sheet:
            fail(f"cutover command sheet missing command: {cmd}")
    ok("cutover command sheet command coverage passed")

    rubric = (ROOT / "docs/api/onboarding/SIGNOFF_RUBRIC.md").read_text(
        encoding="utf-8"
    )
    for role in ("Engineering:", "Compliance:", "Operations:"):
        if role not in rubric:
            fail(f"signoff rubric missing role line: {role}")
    ok("signoff rubric includes all approval domains")

    runbook = (ROOT / "docs/api/onboarding/RUNBOOK_INDEX.md").read_text(encoding="utf-8")
    for marker in (
        "FINAL_OPERATOR_QUICKSTART.md",
        "CUTOVER_COMMAND_SHEET.md",
        "SIGNOFF_RUBRIC.md",
        "api-rollout-watchdog.yml",
    ):
        if marker not in runbook:
            fail(f"runbook index missing marker: {marker}")
    ok("runbook index references core handoff assets")

    print("api_ship_readiness: GO")


if __name__ == "__main__":
    main()

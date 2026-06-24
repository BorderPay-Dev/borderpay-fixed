#!/usr/bin/env python3
"""
Unified pre-deployment gate.

Single entry point:
  python3 scripts/predeploy/run_predeploy_gate.py

Contract:
- Runs ordered stages.
- Stops on first failed stage.
- Writes docs/PREDEPLOY_GATE_REPORT_<timestamp>.md
- Exit 0 only if all stages pass; non-zero otherwise.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from shutil import which

ROOT = Path(__file__).resolve().parents[2]
DOCS_DIR = ROOT / "docs"


@dataclass
class CheckResult:
    name: str
    passed: bool
    evidence: str
    severity: str = "medium"
    remediation: str = ""


@dataclass
class StageResult:
    name: str
    passed: bool
    checks: list[CheckResult] = field(default_factory=list)
    started_at: str = ""
    ended_at: str = ""


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def timestamp_for_file() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def run_shell(cmd: str, timeout: int = 180) -> tuple[int, str, str]:
    shell_prefix: list[str] | None = None
    candidates = [
        os.environ.get("SHELL"),
        "/bin/zsh",
        "/usr/bin/zsh",
        "/bin/bash",
        "/usr/bin/bash",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            shell_prefix = [candidate, "-lc"]
            break
    if shell_prefix is None:
        bash = which("bash")
        shell_prefix = [bash, "-lc"] if bash else ["/usr/bin/env", "bash", "-lc"]

    proc = subprocess.run(
        [*shell_prefix, f"cd {shlex.quote(str(ROOT))} && {cmd}"],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def rg_hits(pattern: str, target: str, extra_globs: list[str] | None = None) -> list[str]:
    globs = extra_globs or []
    glob_args = " ".join(f"--glob {shlex.quote(g)}" for g in globs)
    rc, out, _ = run_shell(f"rg -n -S {shlex.quote(pattern)} {glob_args} {shlex.quote(target)} || true")
    if rc not in (0, 1):
        return [f"rg invocation error for pattern={pattern}"]
    return [line for line in out.splitlines() if line.strip()]


def run_check_command(name: str, cmd: str, severity: str = "high", remediation: str = "") -> CheckResult:
    rc, out, err = run_shell(cmd, timeout=300)
    # Ignore local shell bootstrap noise from ~/.zprofile in evidence summaries.
    noise = re.compile(r"^/Users/.+\.zprofile:\d+:\s+no such file or directory: .+$")
    out_lines = [ln for ln in out.splitlines() if ln.strip() and not noise.match(ln.strip())]
    err_lines = [ln for ln in err.splitlines() if ln.strip() and not noise.match(ln.strip())]
    if rc == 0:
        preferred = None
        for ln in reversed(out_lines):
            if "C8 queue runtime mode supported" in ln:
                preferred = ln
                break
        tail = preferred or (out_lines[-1] if out_lines else "OK")
        return CheckResult(name=name, passed=True, evidence=tail)
    # Prefer stdout on failure because most audit scripts print actionable
    # failure details there; fall back to stderr.
    msg = "\n".join(out_lines[-12:]) or "\n".join(err_lines[-12:]) or f"exit={rc}"
    return CheckResult(name=name, passed=False, evidence=msg[:1000], severity=severity, remediation=remediation)


def stage1_repository_integrity(ci_mode: bool, allow_dirty: bool) -> StageResult:
    stage = StageResult(name="Stage 1 - Repository Integrity", passed=True, started_at=now_utc())

    rc, out, err = run_shell("git status --porcelain")
    dirty = bool(out.strip())
    dirty_allowed = allow_dirty or ci_mode
    stage.checks.append(CheckResult(
        name="Clean repository state (or explicit CI mode)",
        passed=(not dirty) or dirty_allowed,
        evidence="clean working tree" if not dirty else ("dirty allowed by mode" if dirty_allowed else f"dirty files detected ({len(out.splitlines())})"),
        severity="high",
        remediation="Commit/stash local changes before deployment, or run gate with --ci in CI context only.",
    ))

    required_files = [
        "scripts/runtime/verify_runtime_contract.py",
        "scripts/ci/compute_rc1_status.py",
        "scripts/predeploy/run_predeploy_gate.py",
        "scripts/ci/enforce-safety-boundaries.sh",
        "tests/audit/customer_identity_invariant_phase1_audit.py",
        "tests/audit/bridge_webhook_signature_audit.py",
        "tests/audit/bridge_ingest_event_audit.py",
        "tests/audit/webhook_transfer_reconciliation_audit.py",
        "tests/audit/provisioning_lock_resilience_audit.py",
        "tests/audit/funding_gate_outage_policy_audit.py",
        "tests/audit/external_account_webhook_coverage_audit.py",
        "tests/audit/financial_engine_drift_prevention_audit.py",
        "tests/audit/rc1_business_certification_gate_audit.py",
        "tests/audit/rc1_freeze_rule_audit.py",
        "tests/audit/rc1_runtime_killswitch_audit.py",
        "tests/audit/business_performance_parity_phase2_audit.py",
        "tests/audit/business_platform_navigation_audit.py",
    ]
    missing = [p for p in required_files if not (ROOT / p).is_file()]
    stage.checks.append(CheckResult(
        name="Required gate/audit files exist",
        passed=not missing,
        evidence="all required files present" if not missing else f"missing={missing}",
        severity="high",
        remediation="Restore missing files before deployment.",
    ))

    # Bridge-only runtime: no Maplerad references in active runtime surfaces.
    maplerad_hits = rg_hits("maplerad", "supabase/functions src utils components", extra_globs=["!**/*.md", "!**/*.txt"])
    stage.checks.append(CheckResult(
        name="No Maplerad runtime references",
        passed=len(maplerad_hits) == 0,
        evidence="none" if not maplerad_hits else "; ".join(maplerad_hits[:8]),
        severity="high",
        remediation="Remove Maplerad references from runtime code paths.",
    ))

    # No unsupported provider usage in runtime paths (Bridge-only).
    banned_provider_hits = rg_hits(
        "african_onramp|flutterwave",
        "supabase/functions src utils components",
        extra_globs=[
            "!**/*.md",
            "!supabase/functions/_shared/providers/registry.ts",
            "!supabase/functions/_shared/providers/types.ts",
            "!supabase/functions/_shared/providers/african-onramp.types.ts",
            "!supabase/functions/get-fx-rates/index.ts",
            "!supabase/functions/get-momo-providers/index.ts",
            "!supabase/functions/kyc-submit/index.ts",
            "!supabase/functions/provisioning-request/index.ts",
            "!supabase/functions/borderpay-transfer/index.ts",
        ],
    )
    stage.checks.append(CheckResult(
        name="No unsupported provider runtime dependency",
        passed=len(banned_provider_hits) == 0,
        evidence="none" if not banned_provider_hits else "; ".join(banned_provider_hits[:8]),
        severity="high",
        remediation="Remove unsupported provider references from active runtime paths.",
    ))

    # Incident SQL quarantine guard.
    stage.checks.append(run_check_command(
        "Incident SQL remains quarantined",
        "bash scripts/ci/enforce-safety-boundaries.sh",
        severity="high",
        remediation="Fix safety-boundary guard violations before deployment.",
    ))

    stage.passed = all(c.passed for c in stage.checks)
    stage.ended_at = now_utc()
    return stage


def stage2_runtime_contract() -> StageResult:
    stage = StageResult(name="Stage 2 - Runtime Contract", passed=True, started_at=now_utc())
    stage.checks.append(run_check_command(
        "compute_rc1_status.py --check",
        "python3 scripts/ci/compute_rc1_status.py --check",
        severity="critical",
        remediation="Regenerate RC1 computed status from gate evidence (python3 scripts/ci/compute_rc1_status.py --write).",
    ))
    stage.checks.append(run_check_command(
        "verify_runtime_contract.py",
        "python3 scripts/runtime/verify_runtime_contract.py",
        severity="critical",
        remediation="Reconcile live runtime contract failures (tables/columns/indexes/constraints/RPCs/functions/cron/queue settings).",
    ))
    stage.checks.append(run_check_command(
        "verify_financial_schema_contract.py",
        "python3 scripts/ci/verify_financial_schema_contract.py",
        severity="critical",
        remediation="Fix financial read-model schema/RPC/ownership contract drift before deployment.",
    ))
    stage.checks.append(run_check_command(
        "verify_financial_value_propagation.py",
        "python3 scripts/ci/verify_financial_value_propagation.py",
        severity="critical",
        remediation="Fix value propagation drift (ledger -> projections -> snapshot -> financial surfaces) before deployment.",
    ))
    stage.checks.append(run_check_command(
        "verify_business_platform_rc1.py",
        "python3 scripts/ci/verify_business_platform_rc1.py",
        severity="critical",
        remediation="Fix business platform RC1 convergence failures before deployment.",
    ))
    stage.passed = all(c.passed for c in stage.checks)
    stage.ended_at = now_utc()
    return stage


def stage3_financial_correctness() -> StageResult:
    stage = StageResult(name="Stage 3 - Financial Correctness Audits", passed=True, started_at=now_utc())
    audits = [
        "tests/audit/customer_identity_invariant_phase1_audit.py",
        "tests/audit/bridge_webhook_signature_audit.py",
        "tests/audit/bridge_ingest_event_audit.py",
        "tests/audit/webhook_transfer_reconciliation_audit.py",
        "tests/audit/provisioning_lock_resilience_audit.py",
        "tests/audit/funding_gate_outage_policy_audit.py",
        "tests/audit/external_account_webhook_coverage_audit.py",
        "tests/audit/queue_orchestration_config_hardening_audit.py",
        "tests/audit/queue_runtime_prereq_assertions_audit.py",
        "tests/audit/bridge_event_envelope_audit.py",
        "tests/audit/bridge_core_contract_audit.py",
        "tests/audit/state_transition_invariant_audit.py",
        "tests/audit/bridge_ingress_canonicalization_audit.py",
        "tests/audit/synthetic_event_isolation_audit.py",
        "tests/audit/operator_account_exclusion_audit.py",
        "tests/audit/financial_engine_convergence_audit.py",
        "tests/audit/financial_engine_drift_prevention_audit.py",
        "tests/audit/rc1_business_certification_gate_audit.py",
        "tests/audit/rc1_freeze_rule_audit.py",
        "tests/audit/rc1_runtime_killswitch_audit.py",
        "tests/audit/business_performance_parity_phase2_audit.py",
        "tests/audit/business_platform_navigation_audit.py",
    ]
    for audit in audits:
        stage.checks.append(run_check_command(
            f"Audit {audit}",
            f"python3 {shlex.quote(audit)}",
            severity="critical",
            remediation=f"Fix failing audit: {audit}",
        ))
    stage.checks.append(run_check_command(
        "Lifecycle write-path exhaustiveness (Phase A)",
        "python3 scripts/ci/verify_lifecycle_write_path_exhaustiveness.py --phase A",
        severity="critical",
        remediation="Classify every lifecycle-table write in scripts/ci/lifecycle_write_matrix.json and eliminate unmatched paths.",
    ))
    stage.checks.append(run_check_command(
        "Lifecycle runtime lock objective (Phase C)",
        "python3 scripts/ci/verify_lifecycle_write_path_exhaustiveness.py --phase C --runtime-only",
        severity="critical",
        remediation="Eliminate runtime lifecycle writes and disallowed bridge_webhook_events direct columns before deployment.",
    ))
    stage.passed = all(c.passed for c in stage.checks)
    stage.ended_at = now_utc()
    return stage


def stage4_bridge_integration() -> StageResult:
    stage = StageResult(name="Stage 4 - Bridge Integration Verification", passed=True, started_at=now_utc())
    worker_path = ROOT / "supabase/functions/process-pending-events/index.ts"
    bridge_path = ROOT / "supabase/functions/_shared/providers/bridge.ts"
    funding_path = ROOT / "supabase/functions/_shared/funding-gate.ts"
    transfer_map_path = ROOT / "supabase/functions/_shared/bridge-transfer-state.ts"
    ingress_eval_path = ROOT / "supabase/functions/_shared/bridge-ingress-evaluator.ts"

    worker = worker_path.read_text(encoding="utf-8")
    bridge = bridge_path.read_text(encoding="utf-8")
    funding = funding_path.read_text(encoding="utf-8")
    transfer_map = transfer_map_path.read_text(encoding="utf-8")
    ingress_eval = ingress_eval_path.read_text(encoding="utf-8")

    lifecycle_checks = [
        ("Customer lifecycle handler", "handleBridgeCustomerStatus(" in worker),
        ("KYC/KYB lifecycle handler", "handleBridgeKycKyb(" in worker),
        ("Stablecoin provisioning path", "ensureStablecoinWalletsProvisioned(" in worker),
        ("Virtual account lifecycle handler", "handleBridgeVirtualAccount(" in worker),
        ("External account lifecycle handler", "handleBridgeExternalAccount(" in worker),
        ("Transfer lifecycle handler", "handleBridgeTransfer(" in worker),
        ("Webhook taxonomy routing", all(x in ingress_eval for x in [
            't.startsWith("customer.")',
            't.startsWith("kyc_link.")',
            't.startsWith("virtual_account.")',
            't.startsWith("wallet.")',
            't.startsWith("bridge_wallet.")',
            't.startsWith("external_account.")',
            't.startsWith("transfer.")',
        ]) and all(y in worker for y in [
            'case "bridge.customer":',
            'case "bridge.kyc":',
            'case "bridge.virtual_account":',
            'case "bridge.wallet":',
            'case "bridge.external_account":',
            'case "bridge.transfer":',
        ])),
        ("Bridge idempotency (wallet create)", "idempotencyKey: `borderpay:wallet:" in bridge),
        ("Bridge idempotency (VA create)", "idempotencyKey: `borderpay:va:" in bridge),
        ("Bridge idempotency (transfer create)", "idempotencyKey: input.idempotency_key" in bridge),
        ("Funding gate uses Bridge wallet balances only", "bridge_virtual_account_balances" not in funding and "bridgeProvider.listWallets(" in funding),
        ("Canonical transfer state mapper exists", "mapBridgeTransferState" in transfer_map and "payment_processed" in transfer_map),
    ]

    for name, passed in lifecycle_checks:
        stage.checks.append(CheckResult(
            name=name,
            passed=passed,
            evidence="OK" if passed else "missing required integration contract element",
            severity="high",
            remediation="Align runtime implementation with Bridge lifecycle/idempotency requirements.",
        ))

    stage.passed = all(c.passed for c in stage.checks)
    stage.ended_at = now_utc()
    return stage


def stage5_architecture_policy() -> StageResult:
    stage = StageResult(name="Stage 5 - Architecture Policy", passed=True, started_at=now_utc())

    # Bridge remains orchestration+infra: active provider calls should be Bridge.
    infra_hits = rg_hits("bridgeProvider\\.|bridgeFetch\\(", "supabase/functions")
    stage.checks.append(CheckResult(
        name="Bridge remains financial infrastructure path",
        passed=len(infra_hits) > 0,
        evidence=f"bridge provider call sites={len(infra_hits)}",
        severity="high",
        remediation="Ensure active money infrastructure calls route via Bridge provider client.",
    ))

    # No provider abstraction expansion in runtime routes.
    expansion_hits = rg_hits(
        "payment_provider\\s*===\\s*['\\\"](?!bridge)[^'\\\"]+['\\\"]|getProviderByName\\((?!['\\\"]bridge['\\\"])",
        "supabase/functions src utils components",
        extra_globs=["!**/*.md"],
    )
    stage.checks.append(CheckResult(
        name="No provider abstraction expansion in runtime",
        passed=len(expansion_hits) == 0,
        evidence="none" if not expansion_hits else "; ".join(expansion_hits[:8]),
        severity="high",
        remediation="Remove non-Bridge runtime provider routing/selection logic.",
    ))

    # BorderPay UI/UX remains product layer (frontend still present and separate).
    ui_ok = (ROOT / "components").is_dir() and (ROOT / "src").is_dir()
    stage.checks.append(CheckResult(
        name="BorderPay UI/orchestration layer present",
        passed=ui_ok,
        evidence="components/src present" if ui_ok else "frontend layer missing",
        severity="medium",
        remediation="Restore UI/orchestration layer directories.",
    ))

    stage.passed = all(c.passed for c in stage.checks)
    stage.ended_at = now_utc()
    return stage


def stage6_deployment_readiness() -> StageResult:
    stage = StageResult(name="Stage 6 - Deployment Readiness", passed=True, started_at=now_utc())

    # No known undeployed runtime-schema mismatch pattern.
    worker = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text(encoding="utf-8")
    mismatch_patterns = [
        r"\breconciliation_status\s*:",
        r"\breconciliation_reason\s*:",
        r"\breconciliation_required_at\s*:",
        r"\breconciled_at\s*:",
    ]
    bad_refs = [p for p in mismatch_patterns if re.search(p, worker)]
    stage.checks.append(CheckResult(
        name="No known undeployed runtime/schema dependency",
        passed=not bad_refs,
        evidence="none" if not bad_refs else f"patterns={bad_refs}",
        severity="critical",
        remediation="Remove runtime references to undeployed schema fields before deploy.",
    ))

    # Environment contract presence in .env.example (contract doc source).
    env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
    required_env = [
        "SUPABASE_URL=",
        "SUPABASE_SERVICE_ROLE_KEY=",
        "BRIDGE_API_KEY=",
        "BRIDGE_BASE_URL=",
        "BRIDGE_WEBHOOK_PUBLIC_KEY=",
        "BRIDGE_TRANSFERS_ENABLED=",
    ]
    missing_env = [k for k in required_env if k not in env_example]
    stage.checks.append(CheckResult(
        name="Environment contract keys documented",
        passed=not missing_env,
        evidence="all required env keys documented" if not missing_env else f"missing={missing_env}",
        severity="high",
        remediation="Add missing required keys to .env.example and secrets contract docs.",
    ))

    # Queue dependency checks are enforced by runtime contract gate script (Stage 2).
    stage.checks.append(CheckResult(
        name="Queue prerequisites delegated to runtime contract gate",
        passed=True,
        evidence="Stage 2 includes queue DB settings + cron checks.",
        severity="medium",
        remediation="N/A",
    ))

    stage.passed = all(c.passed for c in stage.checks)
    stage.ended_at = now_utc()
    return stage


def render_report(stages: list[StageResult], overall_passed: bool, stopped_on_stage: str | None) -> str:
    lines: list[str] = []
    lines.append("# Unified Pre-Deployment Gate Report")
    lines.append("")
    lines.append(f"- Generated (UTC): {now_utc()}")
    lines.append(f"- Overall: **{'PASS' if overall_passed else 'FAIL'}**")
    if stopped_on_stage:
        lines.append(f"- Fail-fast stop stage: **{stopped_on_stage}**")
    lines.append("")

    for s in stages:
        lines.append(f"## {s.name}")
        lines.append("")
        lines.append(f"- Result: **{'PASS' if s.passed else 'FAIL'}**")
        lines.append(f"- Started: `{s.started_at}`")
        lines.append(f"- Ended: `{s.ended_at}`")
        lines.append("")
        lines.append("### Evidence")
        lines.append("")
        for c in s.checks:
            lines.append(f"- `{'PASS' if c.passed else 'FAIL'}` {c.name}: {c.evidence}")
        lines.append("")
        lines.append("### Blocking Issues")
        lines.append("")
        blockers = [c for c in s.checks if not c.passed]
        if not blockers:
            lines.append("- None.")
        else:
            for b in blockers:
                lines.append(f"- Severity: **{b.severity.upper()}**")
                lines.append(f"  Issue: {b.name}")
                lines.append(f"  Remediation: {b.remediation or 'Fix the failing check and rerun gate.'}")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run unified pre-deployment gate.")
    parser.add_argument("--ci", action="store_true", help="CI mode (permits dirty repo check bypass).")
    parser.add_argument("--allow-dirty", action="store_true", help="Allow dirty git state (local override).")
    args = parser.parse_args()

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = DOCS_DIR / f"PREDEPLOY_GATE_REPORT_{timestamp_for_file()}.md"

    stages: list[StageResult] = []
    stage_fns = [
        lambda: stage1_repository_integrity(ci_mode=args.ci, allow_dirty=args.allow_dirty),
        stage2_runtime_contract,
        stage3_financial_correctness,
        stage4_bridge_integration,
        stage5_architecture_policy,
        stage6_deployment_readiness,
    ]

    stopped_on_stage: str | None = None
    overall_passed = True

    for fn in stage_fns:
        stage = fn()
        stages.append(stage)
        if not stage.passed:
            overall_passed = False
            stopped_on_stage = stage.name
            break

    report = render_report(stages, overall_passed=overall_passed, stopped_on_stage=stopped_on_stage)
    report_path.write_text(report, encoding="utf-8")

    print(f"[predeploy-gate] report: {report_path}")
    print(f"[predeploy-gate] overall: {'PASS' if overall_passed else 'FAIL'}")

    return 0 if overall_passed else 1


if __name__ == "__main__":
    sys.exit(main())

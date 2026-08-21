#!/usr/bin/env python3
"""
RC1 runtime kill-switch audit (deployment-blocking).

Ensures RC1 OPEN state actively suppresses uncertified capability execution in
runtime UI, not only in branch policy.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    p = ROOT / rel
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def check(name: str, cond: bool, detail: str, failures: list[str]) -> None:
    if cond:
        print(f"[OK] {name}")
    else:
        print(f"[FAIL] {name}: {detail}")
        failures.append(name)


RC1_WORKFLOW_GUARD = "python3 scripts/ci/compute_rc1_status.py --require-pass"


def workflow_guard_precedes_boundaries(
    rel: str,
    boundaries: tuple[str, ...],
) -> tuple[bool, str]:
    workflow = read(rel)
    if not workflow:
        return False, "workflow is missing or empty"

    guard_count = workflow.count(RC1_WORKFLOW_GUARD)
    checkout_at = workflow.find("uses: actions/checkout@")
    guard_at = workflow.find(RC1_WORKFLOW_GUARD)
    missing_boundaries = [boundary for boundary in boundaries if boundary not in workflow]
    boundary_positions = [workflow.find(boundary) for boundary in boundaries if boundary in workflow]

    if guard_count != 1:
        return False, f"expected exactly one executable RC1 guard, found {guard_count}"
    if checkout_at < 0 or checkout_at > guard_at:
        return False, "RC1 guard must run after checkout"
    if missing_boundaries:
        return False, f"expected release boundaries missing: {missing_boundaries}"
    if any(guard_at >= boundary_at for boundary_at in boundary_positions):
        return False, "RC1 guard appears after a signing or store-mutation boundary"
    return True, "guard is present and ordered before all release boundaries"


def main() -> int:
    failures: list[str] = []

    flags = read("utils/featureFlags.ts")
    generated = read("utils/generated/rc1Status.ts")
    main_app = read("components/app/MainApp.tsx")
    exchange = read("components/exchange/ExchangeScreen.tsx")
    exchange_widget = read("components/dashboard/fx/ExchangeRateWidget.tsx")
    referral = read("components/referral/ReferralScreen.tsx")
    rc1_command = read("scripts/ci/compute_rc1_status.py")

    check(
        "R1 RC1 status central flag exists",
        "from './generated/rc1Status'" in flags and "RC1_CERTIFICATION_STATUS" in generated,
        "featureFlags must import computed status from utils/generated/rc1Status.ts",
        failures,
    )

    check(
        "R2 RC1 status is computed artifact (no manual literal in feature flags)",
        "RC1_CERTIFICATION_STATUS: RC1CertificationStatus =" not in flags,
        "featureFlags must not hardcode RC1_CERTIFICATION_STATUS literal",
        failures,
    )

    check(
        "R3 FX runtime gate derived from RC1",
        "export const FX_RUNTIME_ENABLED: boolean = RC1_CERTIFICATION_STATUS === 'PASS'" in flags,
        "FX runtime gate missing or not tied to RC1 status",
        failures,
    )

    check(
        "R4 Payroll runtime gate derived from RC1",
        "export const PAYROLL_RUNTIME_ENABLED: boolean = RC1_CERTIFICATION_STATUS === 'PASS'" in flags,
        "Payroll runtime gate missing or not tied to RC1 status",
        failures,
    )

    check(
        "R5 Affiliate lifecycle gate derived from RC1",
        "export const AFFILIATE_FINANCIAL_LIFECYCLE_ENABLED: boolean = RC1_CERTIFICATION_STATUS === 'PASS'" in flags,
        "Affiliate lifecycle gate missing or not tied to RC1 status",
        failures,
    )

    check(
        "R6 Mobile release gate derived from RC1",
        "export const MOBILE_RELEASE_ENABLED: boolean = RC1_CERTIFICATION_STATUS === 'PASS'" in flags,
        "Mobile release gate missing or not tied to RC1 status",
        failures,
    )

    check(
        "R7 Payroll route enforces runtime killswitch",
        "PAYROLL_RUNTIME_ENABLED" in main_app and "PayrollComingSoonScreen" in main_app,
        "MainApp payroll route must hard-route to non-executable screen when RC1 is OPEN",
        failures,
    )

    check(
        "R8 FX screen blocks provider reads while RC1 is OPEN",
        "FX_RUNTIME_ENABLED" in exchange
        and "if (!FX_RUNTIME_ENABLED)" in exchange
        and "backendAPI.fx.getLiveRates" in exchange,
        "ExchangeScreen must short-circuit before live-rate provider calls when RC1 is OPEN",
        failures,
    )

    check(
        "R9 Dashboard FX widget disables conversion while RC1 is OPEN",
        "FX_RUNTIME_ENABLED" in exchange_widget
        and "disabled={!FX_RUNTIME_ENABLED}" in exchange_widget
        and "Foreign Exchange coming soon" in exchange_widget,
        "ExchangeRateWidget must disable convert controls and show coming-soon state",
        failures,
    )

    check(
        "R10 Affiliate screen remains beta and avoids payout-live claim",
        "Affiliate Program Beta" in referral
        and "earnings and payouts are not yet enabled" in referral
        and "payouts are enabled" not in referral,
        "ReferralScreen must not claim live payouts while RC1 is OPEN",
        failures,
    )

    check(
        "R11 RC1 command has fail-closed require-pass mode",
        '"--require-pass"' in rc1_command
        and 'if status != "PASS"' in rc1_command
        and 'if current_status != "PASS"' in rc1_command
        and "return 1" in rc1_command,
        "compute_rc1_status.py must reject computed OPEN and missing/invalid/non-PASS generated status",
        failures,
    )

    workflow_contracts = {
        ".github/workflows/android-play.yml": (
            "- name: Install Android upload keystore",
            "- name: Build signed Android App Bundle",
            "- name: Upload to Google Play internal testing",
        ),
        ".github/workflows/ios-testflight.yml": (
            "- name: Install App Store Connect API key",
            "- name: Export signed IPA",
            "- name: Upload to TestFlight",
        ),
    }
    for index, (workflow, boundaries) in enumerate(workflow_contracts.items(), start=12):
        guarded, detail = workflow_guard_precedes_boundaries(workflow, boundaries)
        check(
            f"R{index} {Path(workflow).name} guard precedes signing/store mutation",
            guarded,
            detail,
            failures,
        )

    if failures:
        print(f"\nrc1_runtime_killswitch_audit: FAIL ({len(failures)} checks)")
        return 1
    print("\nrc1_runtime_killswitch_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

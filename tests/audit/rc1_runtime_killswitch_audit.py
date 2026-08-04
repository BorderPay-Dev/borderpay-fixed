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


def main() -> int:
    failures: list[str] = []

    flags = read("utils/featureFlags.ts")
    generated = read("utils/generated/rc1Status.ts")
    main_app = read("components/app/MainApp.tsx")
    exchange_widget = read("components/dashboard/fx/ExchangeRateWidget.tsx")
    referral = read("components/referral/ReferralScreen.tsx")

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
        "R3 executable FX runtime is disabled",
        "export const FX_RUNTIME_ENABLED: boolean = false" in flags,
        "customer-triggered FX execution must remain disabled",
        failures,
    )

    check(
        "R4 Payroll runtime gate derived from RC1",
        "export const PAYROLL_RUNTIME_ENABLED" in flags and "RC1_CERTIFICATION_STATUS === 'PASS'" in flags,
        "Payroll runtime gate missing or not tied to RC1 status",
        failures,
    )

    check(
        "R5 Affiliate lifecycle gate derived from RC1",
        "export const AFFILIATE_FINANCIAL_LIFECYCLE_ENABLED" in flags and "RC1_CERTIFICATION_STATUS === 'PASS'" in flags,
        "Affiliate lifecycle gate missing or not tied to RC1 status",
        failures,
    )

    check(
        "R6 Mobile release gate derived from RC1",
        "export const MOBILE_RELEASE_ENABLED" in flags and "RC1_CERTIFICATION_STATUS === 'PASS'" in flags,
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
        "R8 executable FX route is absent",
        "import { ExchangeScreen }" not in main_app
        and "return <ExchangeScreen" not in main_app
        and "case 'exchange':" in main_app
        and "return 'dashboard';" in main_app,
        "stale exchange links must resolve to dashboard and no ExchangeScreen may mount",
        failures,
    )

    check(
        "R9 Dashboard rate widget is read-only",
        "backendAPI.fx.getReferenceRates" in exchange_widget
        and "onNavigate" not in exchange_widget
        and "Convert" not in exchange_widget
        and "getLiveRates" not in exchange_widget,
        "rate widget must use Bridge reference rates and expose no execution/navigation control",
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

    # Workflow-level mobile release guard: if workflow files contain explicit
    # mobile-store release tokens, ensure the mobile gate is not OPEN.
    wf_dir = ROOT / ".github" / "workflows"
    mobile_tokens = ("testflight", "play store", "google play", "app store", "fastlane", "pilot")
    mobile_hits: list[str] = []
    if wf_dir.is_dir():
        for wf in wf_dir.glob("*.yml"):
            txt = wf.read_text(encoding="utf-8").lower()
            if any(tok in txt for tok in mobile_tokens):
                mobile_hits.append(str(wf.relative_to(ROOT)))

    rc1_open = "RC1_CERTIFICATION_STATUS: RC1CertificationStatus = 'OPEN'" in generated
    check(
        "R11 Mobile store workflows blocked while RC1 OPEN",
        (not rc1_open) or (len(mobile_hits) == 0),
        f"Mobile release workflow tokens present while RC1 OPEN: {mobile_hits}",
        failures,
    )

    if failures:
        print(f"\nrc1_runtime_killswitch_audit: FAIL ({len(failures)} checks)")
        return 1
    print("\nrc1_runtime_killswitch_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

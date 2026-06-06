#!/usr/bin/env python3
"""
Bridge onboarding pause + collapsible header audit.

This locks the narrow launch-pause contract:
  P1. KYC/KYB onboarding defaults off in the SPA.
  P2. Only Bridge customer/KYC/KYB start functions fail closed via the launch
      gate; money-movement/provisioning functions are not paused by this PR.
  P3. Signup remains untouched by the onboarding pause.
  P4. Customer-facing KYC/KYB entry points show paused copy and remove the
      start CTA while the flag is off.
  P5. The shared AppShell header hides on scroll down and reveals on scroll up,
      route change, or drawer open.

Run: python3 tests/audit/bridge_onboarding_pause_and_header_audit.py
"""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    path = ROOT / rel
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def before(src: str, first: str, second: str) -> bool:
    a = src.find(first)
    b = src.find(second)
    return a >= 0 and b >= 0 and a < b


def main() -> int:
    flags = read("utils/featureFlags.ts")
    gates = read("supabase/functions/_shared/launch-gates.ts")
    signup = read("components/auth/SignUpFlow.tsx")
    kyc_screen = read("components/kyc/KYCVerification.tsx")
    kyc_card = read("components/dashboard/bridge/BridgeKycStatusCard.tsx")
    kyc_screen_render = kyc_screen.split("return (", 1)[-1]
    kyc_card_render = kyc_card.split("return (", 1)[-1]
    shell = read("components/shell/AppShell.tsx")

    onboarding_functions = {
        "bridge-customer": read("supabase/functions/bridge-customer/index.ts"),
        "bridge-kyc-link": read("supabase/functions/bridge-kyc-link/index.ts"),
        "bridge-kyb-link": read("supabase/functions/bridge-kyb-link/index.ts"),
    }
    money_functions = {
        "bridge-virtual-account": read("supabase/functions/bridge-virtual-account/index.ts"),
        "bridge-wallet": read("supabase/functions/bridge-wallet/index.ts"),
        "bridge-external-account": read("supabase/functions/bridge-external-account/index.ts"),
        "bridge-transfer": read("supabase/functions/bridge-transfer/index.ts"),
    }
    money_components = {
        "BridgeVirtualAccountsCard": read("components/dashboard/bridge/BridgeVirtualAccountsCard.tsx"),
        "BridgeWalletsCard": read("components/dashboard/bridge/BridgeWalletsCard.tsx"),
        "WalletScreen": read("components/wallet/WalletScreen.tsx"),
        "ReceiveMoneyScreen": read("components/receive/ReceiveMoneyScreen.tsx"),
        "AddMoneyScreen": read("components/deposit/AddMoneyScreen.tsx"),
        "USDAccountScreen": read("components/accounts/USDAccountScreen.tsx"),
    }

    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "P1 onboarding flag defaults off and no money-movement flag was added",
        "export const BRIDGE_ONBOARDING_LIVE: boolean = false" in flags
        and "MONEY_MOVEMENT_LIVE" not in flags,
        "featureFlags.ts must pause only onboarding, not money movement",
    ))

    checks.append((
        "P2 launch gate is onboarding-only",
        "BRIDGE_ONBOARDING_ENABLED" in gates
        and "bridgeOnboardingPausedBody" in gates
        and "MONEY_MOVEMENT" not in gates
        and "moneyMovement" not in gates,
        "launch-gates.ts must not define money-movement pause helpers",
    ))

    onboarding_ok = True
    for name, src in onboarding_functions.items():
        onboarding_ok = onboarding_ok and "bridgeOnboardingEnabled" in src
        onboarding_ok = onboarding_ok and "bridgeOnboardingPausedBody" in src
        onboarding_ok = onboarding_ok and before(src, "if (!bridgeOnboardingEnabled())", "const auth")
    checks.append((
        "P3 customer/KYC/KYB start functions fail closed before auth/provider work",
        onboarding_ok,
        "bridge-customer, bridge-kyc-link, and bridge-kyb-link must gate before auth",
    ))

    money_ok = all("launch-gates" not in src and "MONEY_MOVEMENT" not in src for src in money_functions.values())
    money_ui_ok = all("MONEY_MOVEMENT_LIVE" not in src and "Money movement paused" not in src for src in money_components.values())
    checks.append((
        "P4 money-movement functions and screens are untouched by this pause",
        money_ok and money_ui_ok,
        "virtual accounts, wallets, transfers, deposits, and receive screens must not be paused here",
    ))

    checks.append((
        "P5 signup remains open and does not import onboarding pause state",
        "BRIDGE_ONBOARDING_LIVE" not in signup
        and "bridgeOnboarding" not in signup
        and "launch-gates" not in signup,
        "signup must remain able to onboard users without KYC/KYB",
    ))

    checks.append((
        "P6 KYC/KYB public entry points render paused copy without provider naming",
        "BRIDGE_ONBOARDING_LIVE" in kyc_screen
        and "Verification paused" in kyc_screen_render
        and "KYC and KYB onboarding is paused" in kyc_screen_render
        and "BRIDGE_ONBOARDING_LIVE" in kyc_card
        and "KYC and KYB onboarding is paused" in kyc_card_render
        and "Bridge KYC" not in kyc_screen_render
        and "Bridge KYC" not in kyc_card_render
        and "Bridge KYB" not in kyc_screen_render
        and "Bridge KYB" not in kyc_card_render,
        "KYCVerification and BridgeKycStatusCard must show paused copy without public partner names",
    ))

    checks.append((
        "P7 AppShell header is floating, collapsible, and reveals on route/drawer",
        "headerHidden" in shell
        and "window.addEventListener('scroll', onScroll, { passive: true })" in shell
        and "delta > 8 && y > HEADER_HEIGHT_PX" in shell
        and "delta < -8" in shell
        and "setHeaderHidden(false)" in shell
        and "useEffect(() => {\n    setHeaderHidden(false);\n  }, [route]);" in shell
        and "<motion.header" in shell
        and "pointer-events-none px-3" in shell
        and "max-w-screen-sm mx-auto" in shell
        and "rounded-[28px]" in shell
        and "shadow-[0_18px_55px_rgba(0,0,0,0.28)]" in shell
        and "backdrop-blur-2xl" in shell
        and "animate={{ y: headerHidden ? '-125%' : '0%', opacity: headerHidden ? 0 : 1 }}" in shell,
        "AppShell must use a floating Telegram-style header, hide on scroll down, and reveal on scroll up, drawer open, or route change",
    ))

    ok = True
    print("bridge_onboarding_pause_and_header_audit:")
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for _, passed, _ in checks if passed)}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

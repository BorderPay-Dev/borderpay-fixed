#!/usr/bin/env python3
"""
Floating tab bar audit.

Locks the signed-in AppShell primary navigation contract:
  F1. The bottom chrome is a floating, rounded tab bar, not a full-width rail.
  F2. Individual accounts get Home / Send / Receive / Wallet / Account.
  F3. Business accounts get Home / Send / Receive / Team / Account.
  F4. The tab bar remains safe-area aware and accessible.

Run: python3 tests/audit/floating_tab_bar_audit.py
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHELL = (ROOT / "components/shell/AppShell.tsx").read_text(encoding="utf-8")


def has_all(*needles: str) -> bool:
    return all(needle in SHELL for needle in needles)


def main() -> int:
    checks: list[tuple[str, bool, str]] = []

    checks.append((
        "F1 floating rounded bottom tab bar",
        has_all(
            "Floating primary tab bar",
            "pointer-events-none px-3",
            "max-w-screen-sm mx-auto",
            "rounded-[28px]",
            "shadow-[0_18px_55px_rgba(0,0,0,0.34)]",
            "backdrop-blur-2xl",
        ),
        "AppShell bottom nav must be a centered floating pill, not a full-width bottom rail",
    ))

    checks.append((
        "F2 individual tabs include wallet",
        has_all(
            "const primaryTabs = useMemo(",
            "isBusinessAccount",
            "{ route: 'wallet' as AppRoute, icon: Wallet, label: tt('nav.wallet', 'Wallet') }",
            "{ route: 'account' as AppRoute, icon: UserIcon, label: tt('nav.account', 'Account') }",
        ),
        "Individual primary tabs must include Wallet before Account",
    ))

    checks.append((
        "F3 business tabs include team",
        has_all(
            "{ route: 'team' as AppRoute, icon: Users, label: tt('nav.teamShort', 'Team') }",
            "{ route: 'account' as AppRoute, icon: UserIcon, label: tt('nav.account', 'Account') }",
        ),
        "Business primary tabs must include Team before Account",
    ))

    checks.append((
        "F4 tabs render from primaryTabs",
        "primaryTabs.map(tab =>" in SHELL
        and "key={tab.route}" in SHELL
        and "onPrefetch={() => prefetchRoute(tab.route)}" in SHELL
        and "onClick={() => go(tab.route)}" in SHELL,
        "Bottom buttons must be generated from the business-aware primaryTabs contract",
    ))

    checks.append((
        "F5 safe-area aware and accessible",
        has_all(
            "calc(env(safe-area-inset-bottom, 0px) + 10px)",
            "aria-label={tt('shell.bottomNav', 'Primary navigation')}",
            "aria-current={active ? 'page' : undefined}",
        ),
        "Floating tab bar must account for mobile safe areas and expose active tab semantics",
    ))

    print("floating_tab_bar_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for _, p, _ in checks if p)}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
P0 navigation/runtime contract audit.

Guards against regressions reported in production:
1) Dashboard quick actions drifting back to Wallet/Add Money.
2) Business quick actions drifting to Withdraw/Banks.
3) Burger menu Cards entry being re-locked/blocked.
4) KYC/KYB ToS flow order drifting (ToS must be handled before hosted link).
"""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    failures: list[str] = []

    try:
        dashboard = read("components/app/Dashboard.tsx")
        assert_true('label={tt(\'nav.cards\', \'Cards\')}' in dashboard, "Individual dashboard quick action must include Cards.")
        assert_true('label={tt(\'action.send\', \'Send\')}' in dashboard, "Individual dashboard quick action must include Send.")
        assert_true('label={tt(\'action.receive\', \'Receive\')}' in dashboard, "Individual dashboard quick action must include Receive.")
        assert_true('label={tt(\'action.exchange\', \'Convert\')}' in dashboard, "Individual dashboard quick action must include Convert.")
        assert_true('tt(\'action.addMoney\'' not in dashboard, "Individual dashboard quick actions must not include Add Money.")
        assert_true('label={tt(\'nav.wallet\'' not in dashboard, "Individual dashboard quick actions must not include Wallet.")
    except Exception as exc:
        failures.append(f"Dashboard contract: {exc}")

    try:
        biz = read("components/business/BusinessDashboard.tsx")
        assert_true('BizChip label="Cards"' in biz, "Business dashboard quick action must include Cards.")
        assert_true('BizChip label="Team"' in biz, "Business dashboard quick action must include Team.")
        assert_true('label="FX"' in biz, "Business dashboard quick action must include FX.")
        assert_true('BizChip label="Withdraw"' not in biz, "Business dashboard quick actions must not include Withdraw.")
        assert_true('BizChip label="Banks"' not in biz, "Business dashboard quick actions must not include Banks.")
        assert_true('BizChip label="Wallet"' not in biz, "Business dashboard quick actions must not include Wallet.")
    except Exception as exc:
        failures.append(f"Business dashboard contract: {exc}")

    try:
        shell = read("components/shell/AppShell.tsx")
        cards_line_present = "label={tt('nav.cards'" in shell and "onClick={() => goFromDrawer('cards')}" in shell
        assert_true(cards_line_present, "Drawer must route to Cards from burger menu.")
        assert_true('badge="Locked"' not in shell, "Drawer Cards entry must not be hard-locked/badged.")
    except Exception as exc:
        failures.append(f"AppShell drawer contract: {exc}")

    try:
        kyc = read("components/kyc/KYCVerification.tsx")
        tos_idx = kyc.find("if (r?.success && r.data?.tos_link_url)")
        link_idx = kyc.find("if (r?.success && r.data?.link_url)")
        assert_true(tos_idx != -1 and link_idx != -1, "KYC flow must include ToS and hosted link branches.")
        assert_true(tos_idx < link_idx, "KYC flow must handle ToS link before hosted verification link.")
    except Exception as exc:
        failures.append(f"KYC ToS-first contract: {exc}")

    if failures:
        print("P0 navigation contract audit: FAIL")
        for f in failures:
            print(f"- {f}")
        return 1

    print("P0 navigation contract audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

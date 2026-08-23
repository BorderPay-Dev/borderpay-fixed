#!/usr/bin/env python3
"""Fiat beneficiaries must come from Bridge and lead into the authorized Send flow."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCREEN = (ROOT / "components/payouts/ExternalAccountsScreen.tsx").read_text()
MAIN = (ROOT / "components/app/MainApp.tsx").read_text()
SEND = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


require("backendAPI.bridge.externalAccount.list()" in SCREEN,
        "payout accounts must be read from Bridge, not a lagging snapshot")
require("backendAPI.financial.getSnapshot(50)" not in SCREEN,
        "payout account screen must not use the financial snapshot as beneficiary authority")
require("onWithdraw: () => void" in SCREEN and "onWithdraw();" in SCREEN,
        "saved payout accounts must expose a withdrawal action")
require("onWithdraw={() => navigateTo('send-money')}" in MAIN,
        "withdrawal action must enter the existing Send flow")
require("borderpay_selected_payout_account_v1" in SCREEN,
        "selected beneficiary must be handed to Send")
require("borderpay_selected_payout_account_v1" in SEND,
        "Send must consume the selected beneficiary")
require("backendAPI.bridge.transfer.create" in SEND,
        "withdrawal must retain the existing authorized Bridge transfer path")

print("external account withdrawal navigation audit: PASS")

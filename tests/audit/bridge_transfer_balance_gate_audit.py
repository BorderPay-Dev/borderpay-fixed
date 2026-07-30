#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRANSFER = ROOT / "supabase" / "functions" / "bridge-transfer" / "index.ts"
SEND = ROOT / "components" / "send" / "SendMoneyFlow.tsx"


def main() -> int:
    transfer = TRANSFER.read_text(encoding="utf-8")
    send = SEND.read_text(encoding="utf-8")
    failures: list[str] = []

    def require(ok: bool, msg: str) -> None:
        if not ok:
            failures.append(msg)

    require("async function spendableWalletBalanceMinor" in transfer,
            "bridge-transfer must have a server-side spendable wallet balance reader.")
    require('.from("bridge_balance_ledger")' in transfer and '.eq("entity_type", "wallet")' in transfer,
            "balance check must use canonical bridge_balance_ledger wallet rows.")
    require('if (normalizedSourceType === "wallet")' in transfer and 'code: "insufficient_balance"' in transfer,
            "wallet-source transfers must fail closed with insufficient_balance before provider call.")
    require(transfer.find('code: "insufficient_balance"') < transfer.find("bridgeProvider.createTransfer"),
            "insufficient_balance guard must run before bridgeProvider.createTransfer.")
    require("available_balance_minor" in transfer and "required_balance_minor" in transfer,
            "insufficient balance response must include machine-readable balance details.")
    require("code === 'insufficient_balance'" in send and "Insufficient balance for this payout" in send,
            "SendMoneyFlow must map insufficient_balance to a user-friendly message.")
    require("code === 'balance_check_unavailable'" in send,
            "SendMoneyFlow must map balance_check_unavailable to a user-friendly retry message.")

    if failures:
        print("bridge_transfer_balance_gate_audit: FAIL")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("bridge_transfer_balance_gate_audit: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

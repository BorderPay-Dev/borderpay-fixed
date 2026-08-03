#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "supabase" / "functions" / "process-pending-events" / "index.ts"


def require(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def main() -> int:
    src = WORKER.read_text(encoding="utf-8")
    failures: list[str] = []

    require(
        "function inferWalletActivityDirection" in src
        and 'if (sourceRail === "wallet") return "debit";' in src
        and 'if (destinationRail === "wallet") return "credit";' in src,
        "wallet activity direction must infer debit/credit from Bridge source/destination rails before text fallback",
        failures,
    )
    require(
        'function inferWalletActivityDirection(eventType: string, payload: any, amountMinor: bigint | null): "credit" | "debit" | null' in src
        and 'explicitBridgeWalletActivityDirection(payload)' in src
        and 'return null;' in src
        and 'wallet_activity_direction_unresolved' in src
        and 'financial_write_blocked: true' in src,
        "unrecognised wallet activity direction must block financial writes instead of defaulting to credit",
        failures,
    )
    require(
        'throw new Error("reconciliation_required:wallet_activity_direction_unresolved")' in src,
        "unrecognised positive wallet activity must retry/reconcile instead of completing silently",
        failures,
    )
    require(
        "const walletActivityTransferId = bridgeTransferIdFromPayload(d);" in src
        and "bridge_transfer_id: walletActivityTransferId" in src,
        "wallet activity ledger metadata must carry bridge_transfer_id when Bridge provides it",
        failures,
    )
    require(
        'entity_type: "wallet"' in src
        and 'direction: walletActivityDirection' in src
        and '.from("bridge_balance_ledger").upsert' in src,
        "wallet activity must project into bridge_balance_ledger with explicit direction",
        failures,
    )
    wallet_section = src[src.find("async function handleBridgeWallet"):src.find("async function handleBridgeExternalAccount")]
    require(
        '.from("notifications").insert' not in wallet_section,
        "raw wallet activity must not insert user notifications; deposit/transfer lifecycle handlers own customer notifications",
        failures,
    )
    require(
        'title: walletActivityDirection === "credit" ? "Deposit received" : "Money sent"' not in wallet_section,
        "wallet activity must not create ambiguous Deposit received/Money sent notifications",
        failures,
    )

    if failures:
        print("bridge_wallet_activity_projection_audit: FAIL")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("bridge_wallet_activity_projection_audit: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

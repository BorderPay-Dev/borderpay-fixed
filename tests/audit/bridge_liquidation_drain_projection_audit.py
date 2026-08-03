from pathlib import Path

root = Path(__file__).resolve().parents[2]
worker = (root / "supabase/functions/process-pending-events/index.ts").read_text()

checks = {
    "liquidation route handled": 'case "bridge.liquidation_address"' in worker,
    "drain handler exists": "async function handleBridgeLiquidationAddress" in worker,
    "provider hash correlation": 'raw->receipt->>destination_tx_hash' in worker and "deposit_tx_hash" in worker,
    "single canonical transaction": "canonicalTransferId = parentTransferId || drainId" in worker,
    "debit direction": 'direction: "debit"' in worker,
    "route funding receipt suppressed": "!isReusableRouteFundingLeg" in worker,
    "final drain email idempotent": "wh:liquidation-drain:" in worker,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("bridge_liquidation_drain_projection_audit: FAIL: " + ", ".join(failed))
print("bridge_liquidation_drain_projection_audit: PASS")

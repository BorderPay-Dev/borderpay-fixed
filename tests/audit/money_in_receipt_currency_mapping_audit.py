#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
worker = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()
individual = (ROOT / "supabase/functions/_shared/email-templates/individual/transaction-status.ts").read_text()
business = (ROOT / "supabase/functions/_shared/email-templates/business/transaction-status.ts").read_text()

checks = {
    "Bridge receipt initial amount is source leg": "receipt.initial_amount" in worker,
    "Bridge receipt subtotal is source available leg": "receipt.subtotal_amount" in worker,
    "converted amount parsed with event currency": "toMinorUnits(statusReceipt.destination_amount, eventCurrency)" in worker,
    "money-in receipt is explicitly typed": 'receiptKind: "money_in_conversion"' in worker,
    "destination rail forwarded": "destinationRail: String(statusReceipt.destination_rail" in worker,
    "individual template separates incoming funds": "Converted amount / added to wallet" in individual and "fmtReceiptMoney" in individual,
    "business template separates incoming funds": "Converted amount / added to wallet" in business and "fmtReceiptMoney" in business,
    "completed status is explicit": "Approved / Completed" in individual and "Approved / Completed" in business,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("money_in_receipt_currency_mapping_audit: FAIL\n- " + "\n- ".join(failed))
print("money_in_receipt_currency_mapping_audit: PASS")

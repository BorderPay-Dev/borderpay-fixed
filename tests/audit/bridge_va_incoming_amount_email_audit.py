#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "supabase/functions/process-pending-events/index.ts"


def must(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


worker = WORKER.read_text(encoding="utf-8")
body = worker.split("function receivedAmountBreakdown", 1)[1].split(
    "function bridgeVaReceiptDetails", 1
)[0]

# Regression: a Bridge payment_processed event can carry the converted
# destination amount at event_object.amount. For a EUR 500 incoming payment,
# treating a 561.10 destination amount as EUR produced the false receipt:
# 561.10 EUR - 14.90 EUR = 546.20 EUR.
receipt_initial = body.index("toMinorUnits(receipt.initial_amount, currency)")
receipt_source = body.index("toMinorUnits(receipt.source_amount, currency)")
payload_initial = body.index("toMinorUnits(payload?.initial_amount, currency)")
payload_source = body.index("toMinorUnits(payload?.source_amount, currency)")
top_level_amount = body.index("toMinorUnits(payload?.amount, currency)")

must(
    receipt_initial < receipt_source < payload_initial < payload_source < top_level_amount,
    "Bridge receipt/source incoming amounts must take precedence over converted top-level amount",
)
must(
    body.index('firstMinorUnitAmount(receipt, currency, [')
    < body.index('firstMinorUnitAmount(payload, currency, ['),
    "Bridge receipt fee fields must take precedence over top-level fee fallbacks",
)
must(
    "const netMinor = grossMinor - developerFeeMinor - exchangeFeeMinor" in body,
    "The net incoming amount must be calculated once from the real source amount",
)

receipt_body = worker.split("function bridgeVaReceiptDetails", 1)[1].split(
    "function humanizeRail", 1
)[0]
must(
    "eventCurrency && eventCurrency !== sourceCurrency ? eventCurrency : null" in receipt_body,
    "Converted settlement currency must populate the outgoing receipt currency",
)
must(
    "destinationCurrency && destinationCurrency !== sourceCurrency ? p.amount : null" in receipt_body,
    "Converted top-level amount may only populate the outgoing receipt amount",
)
must(
    worker.count("eventCurrency,") >= 3,
    "Every VA activity receipt projection must receive the webhook event currency",
)

print("bridge_va_incoming_amount_email_audit: PASS")

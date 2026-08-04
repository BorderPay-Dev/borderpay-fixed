#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
F = ROOT / "supabase/functions"

def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")

def assert_has(text: str, pattern: str, message: str) -> None:
    if not re.search(pattern, text, re.S):
        raise AssertionError(message)

def assert_not_has(text: str, pattern: str, message: str) -> None:
    if re.search(pattern, text, re.S):
        raise AssertionError(message)

worker = read("supabase/functions/process-pending-events/index.ts")
index = read("supabase/functions/_shared/email-templates/index.ts")
individual_status = read("supabase/functions/_shared/email-templates/individual/transaction-status.ts")
business_status = read("supabase/functions/_shared/email-templates/business/transaction-status.ts")
individual_legacy = read("supabase/functions/_shared/email-templates/individual/payment-received.ts")
business_legacy = read("supabase/functions/_shared/email-templates/business/payment-received.ts")

all_function_sources = "\n".join(
    p.read_text(encoding="utf-8")
    for p in F.rglob("*.ts")
    if "/_shared/email-templates/" not in str(p)
)

# Money-in must use transaction_status only.
assert_has(worker, r"emailTransactionStatusBestEffort", "Bridge webhook worker must send money-in status emails.")
assert_has(worker, r"business\.transaction_status", "Business money-in emails must route to transaction_status.")
assert_has(worker, r"individual\.transaction_status", "Individual money-in emails must route to transaction_status.")
assert_has(worker, r"kind:\s*\"virtual_account_deposit_status\"", "VA deposits must create deposit-status metadata.")
assert_has(worker, r"wh:tx-status:\$\{resolved\}:va:", "VA deposit emails must use tx-status idempotency.")

# Legacy payment_received can remain registered only as a verification-link key;
# it must not be called from any runtime source. This catches drift back to the
# old activation/payment template for real deposits.
assert_not_has(all_function_sources, r"template:\s*[\"'](?:individual|business)\.payment_received[\"']", "Runtime functions must not send legacy payment_received templates.")
assert_not_has(all_function_sources, r"renderTemplate\(\s*[\"'](?:individual|business)\.payment_received[\"']", "Runtime code must not render legacy payment_received templates.")

# Receipt templates must contain the Bridge-style receipt rows the user expects.
for name, template in [("individual", individual_status), ("business", business_status)]:
    assert_has(template, r"Incoming funds", f"{name} transaction_status must show incoming funds.")
    assert_has(template, r"Transaction fee", f"{name} transaction_status must use customer-facing transaction fee wording.")
    assert_has(template, r"Available for conversion", f"{name} transaction_status must show available for conversion.")
    assert_has(template, r"Outgoing funds", f"{name} transaction_status must show outgoing funds.")
    assert_has(template, r"Exchange rate", f"{name} transaction_status must show exchange rate when present.")
    assert_has(template, r"Deposit ID", f"{name} transaction_status must show deposit id.")

# Legacy templates must be safe compatibility shims: verification-link callers
# still work, but stale money-in callers are routed into transaction_status.
for name, template in [("individual", individual_legacy), ("business", business_legacy)]:
    assert_has(template, r"kyc_url", f"{name} legacy payment_received must remain verification-link only.")
    assert_has(template, r"renderTransactionStatus", f"{name} legacy payment_received must delegate money props to transaction_status.")
    assert_has(template, r"p\.amount !== undefined && p\.currency && p\.reference", f"{name} legacy payment_received must require money fields before receipt delegation.")

# Registry must keep both names distinct so callers cannot confuse the purpose.
assert_has(index, r"individual\.transaction_status", "transaction_status must be registered.")
assert_has(index, r"business\.transaction_status", "business transaction_status must be registered.")
assert_has(index, r"individual\.payment_received", "legacy payment_received registration must be explicit.")
assert_has(index, r"business\.payment_received", "legacy business payment_received registration must be explicit.")

print("money_in_email_template_routing_audit: PASS")

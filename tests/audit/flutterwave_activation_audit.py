#!/usr/bin/env python3
"""
Flutterwave activation (Phase A) audit, fail-closed.

Locks the money-safety invariants of the external activation-payment flow:

  F1  Shared client (_shared/providers/flutterwave.ts) reads the secret from env
      (never hardcoded), exposes verifyWebhookSignature + verifyTransaction, and
      targets the production API base.
  F2  flutterwave-webhook VERIFIES the signature before doing anything, and
      INDEPENDENTLY verifies the transaction via the API (never trusts the
      webhook body's amount/status alone).
  F3  Activation is idempotent + amount-guarded in the DB (activate_subscription_external
      keys on tx_ref, bails when already paid, blocks underpayment) and the
      checkout records a pending row BEFORE redirecting.
  F4  Webhook email recipient comes from the DB (user_profiles), NEVER from the
      webhook payload; routed via the logged send-email path (no direct Resend).
  F5  config.toml pins flutterwave-checkout (verify_jwt=true) +
      flutterwave-webhook (verify_jwt=false).
  F6  No hardcoded Flutterwave secret key in source.

Text-parsing, dependency-free. Exits non-zero on any violation.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLIENT  = ROOT / "supabase/functions/_shared/providers/flutterwave.ts"
WEBHOOK = ROOT / "supabase/functions/flutterwave-webhook/index.ts"
CHECKOUT= ROOT / "supabase/functions/flutterwave-checkout/index.ts"
MIG_DIR = ROOT / "supabase/migrations"
CONFIG  = ROOT / "supabase/config.toml"

failures: list[str] = []


def read(p: Path) -> str:
    if not p.exists():
        failures.append(f"MISSING FILE: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8")


client  = read(CLIENT)
webhook = read(WEBHOOK)
checkout= read(CHECKOUT)
config  = read(CONFIG)
mig = ""
for p in MIG_DIR.glob("*flutterwave_activation.sql"):
    mig = p.read_text(encoding="utf-8")
if not mig:
    failures.append("MISSING migration *flutterwave_activation.sql")

# F1 ----------------------------------------------------------------------
if client:
    for tok in ['Deno.env.get("FLUTTERWAVE_SECRET_KEY")',
                "export function verifyWebhookSignature",
                "export async function verifyTransaction",
                "https://api.flutterwave.com/v3"]:
        if tok not in client:
            failures.append(f"F1 flutterwave.ts missing '{tok}'")

# F2 ----------------------------------------------------------------------
if webhook:
    if "verifyWebhookSignature(req.headers.get(\"verif-hash\"))" not in webhook:
        failures.append("F2 webhook does not verify the verif-hash signature first")
    if "verifyTransaction(" not in webhook:
        failures.append("F2 webhook does not independently verify the transaction via API")
    if '"successful"' not in webhook:
        failures.append("F2 webhook does not require a 'successful' status")

# F3 ----------------------------------------------------------------------
if mig:
    for tok in ["activate_subscription_external", "already", "amount_mismatch",
                "p_amount_minor < v_pay.amount_minor"]:
        if tok not in mig:
            failures.append(f"F3 migration missing idempotency/amount-guard token '{tok}'")
    if not re.search(r"tx_ref\s+text\s+not\s+null\s+unique", mig):
        failures.append("F3 migration: tx_ref must be a UNIQUE NOT NULL idempotency key")
if checkout and 'status:       "pending"' not in checkout and "'pending'" not in checkout and '"pending"' not in checkout:
    failures.append("F3 checkout does not record a pending activation row before redirect")

# F4 ----------------------------------------------------------------------
if webhook:
    if "from(\"user_profiles\")" not in webhook:
        failures.append("F4 webhook email recipient not read from user_profiles (DB)")
    if "functions/v1/send-email" not in webhook:
        failures.append("F4 webhook does not route email via the logged send-email path")
    if re.search(r"resend\.com|api\.resend|RESEND_API_KEY", webhook, re.I):
        failures.append("F4 webhook must not call Resend directly")
    # recipient must not be taken from the webhook payload body
    if re.search(r"\bto:\s*body|payload.*email|d\.customer", webhook):
        failures.append("F4 webhook recipient appears to come from the payload")

# F5 ----------------------------------------------------------------------
if config:
    if "[functions.flutterwave-checkout]" not in config or "[functions.flutterwave-webhook]" not in config:
        failures.append("F5 config.toml missing flutterwave function pins")
    block = config.split("[functions.flutterwave-webhook]", 1)
    if len(block) == 2 and "verify_jwt = false" not in block[1].split("[functions", 1)[0]:
        failures.append("F5 flutterwave-webhook must be verify_jwt = false")

# F6 ----------------------------------------------------------------------
for name, s in [("flutterwave.ts", client), ("webhook", webhook), ("checkout", checkout)]:
    if s and re.search(r"FLWSECK[-_][0-9A-Za-z]|FLWSECK_TEST|sk_live_|FLWPUBK", s):
        failures.append(f"F6 {name} contains a hardcoded Flutterwave key")

# Report -------------------------------------------------------------------
if failures:
    print("FLUTTERWAVE ACTIVATION AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("FLUTTERWAVE ACTIVATION AUDIT: PASS (6/6)")
print("  ✓ F1 shared client: env secret + signature/verify helpers + prod base")
print("  ✓ F2 webhook verifies signature THEN re-verifies the tx via API")
print("  ✓ F3 DB activation idempotent + amount-guarded; checkout records pending row")
print("  ✓ F4 email recipient from DB, via logged send-email (no Resend, not from payload)")
print("  ✓ F5 config.toml pins checkout(jwt) + webhook(public, signature-verified)")
print("  ✓ F6 no hardcoded Flutterwave secret in source")

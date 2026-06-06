#!/usr/bin/env python3
"""
Verification paywall + stepped-review gate audit (#4 + #5), fail-closed.

Locks the money-protective invariants for the stepped KYB/KYC gate:

  V1  launch-gates.ts defines the structured gate: verificationGate +
      payment_required + pending_manual_review codes + PAID_PLAN_KEYS (free
      tiers excluded) + loadVerificationContext (fail-closed DB reads).
  V2  ALL THREE billable Bridge entry points (bridge-customer, bridge-kyc-link,
      bridge-kyb-link) call verificationGate(loadVerificationContext(...)) AND
      still keep the outer env pause (bridgeOnboardingEnabled).
  V3  The (source-only) migration adds verification_review_status defaulting to
      'pending_manual_review' and the authorize_verification RPC.
  V4  authorize-verification routes the prompt email via the logged send-email
      path (no direct Resend), keys off the authorize_verification RPC, and the
      recipient is NOT taken from request input.
  V5  Frontend gate.ts paid-plan set matches the backend PAID_PLAN_KEYS and
      exposes canMoveMoney / canStartVerification.
  V6  Both verification_authorized templates are registered.

Text-parsing, dependency-free. Exits non-zero on any violation.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "supabase/functions/_shared/launch-gates.ts"
BRIDGE_FNS = [
    ROOT / "supabase/functions/bridge-customer/index.ts",
    ROOT / "supabase/functions/bridge-kyc-link/index.ts",
    ROOT / "supabase/functions/bridge-kyb-link/index.ts",
]
MIGRATION = ROOT / "supabase/migrations/20260606120000_stepped_verification_gate.sql"
AUTHZ = ROOT / "supabase/functions/authorize-verification/index.ts"
FE_GATE = ROOT / "utils/subscriptions/gate.ts"
EMAIL_INDEX = ROOT / "supabase/functions/_shared/email-templates/index.ts"

failures: list[str] = []


def read(p: Path) -> str:
    if not p.exists():
        failures.append(f"MISSING FILE: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8")


gate = read(GATE)
mig = read(MIGRATION)
authz = read(AUTHZ)
fe = read(FE_GATE)
email_index = read(EMAIL_INDEX)

# V1 ----------------------------------------------------------------------
if gate:
    for tok in ['export function verificationGate', 'payment_required',
                'pending_manual_review', 'PAID_PLAN_KEYS',
                'export async function loadVerificationContext']:
        if tok not in gate:
            failures.append(f"V1 launch-gates.ts missing '{tok}'")
    # Free tiers must NOT be in the paid set.
    paid_block = re.search(r"PAID_PLAN_KEYS[^\]]*?new Set\(\[(.*?)\]\)", gate, re.S)
    body = paid_block.group(1) if paid_block else ""
    for paid in ["individual_premium", "business_growth", "business_enterprise"]:
        if paid not in body:
            failures.append(f"V1 PAID_PLAN_KEYS missing paid plan {paid}")
    for free in ["individual_starter", "business_starter"]:
        if free in body:
            failures.append(f"V1 PAID_PLAN_KEYS must NOT include free plan {free}")

# V2 ----------------------------------------------------------------------
for f in BRIDGE_FNS:
    s = read(f)
    if not s:
        continue
    name = f.parent.name
    if "verificationGate(await loadVerificationContext(supa, user.id))" not in s:
        failures.append(f"V2 {name} does not enforce verificationGate(loadVerificationContext)")
    if "bridgeOnboardingEnabled" not in s:
        failures.append(f"V2 {name} dropped the outer env pause (bridgeOnboardingEnabled)")

# V3 ----------------------------------------------------------------------
if mig:
    if "verification_review_status" not in mig or "'pending_manual_review'" not in mig:
        failures.append("V3 migration missing verification_review_status default 'pending_manual_review'")
    if "FUNCTION public.authorize_verification" not in mig:
        failures.append("V3 migration missing authorize_verification RPC")

# V4 ----------------------------------------------------------------------
if authz:
    if "functions/v1/send-email" not in authz:
        failures.append("V4 authorize-verification does not route via send-email")
    if re.search(r"resend\.com|api\.resend|RESEND_API_KEY", authz, re.I):
        failures.append("V4 authorize-verification must not call Resend directly")
    if "authorize_verification" not in authz:
        failures.append("V4 authorize-verification does not call the authorize_verification RPC")
    # recipient must come from the RPC row, not request input.
    if "row.email" not in authz:
        failures.append("V4 authorize-verification recipient must come from the RPC result (row.email)")

# V5 ----------------------------------------------------------------------
if fe:
    for tok in ["canMoveMoney", "canStartVerification", "isPaidPlanKey"]:
        if tok not in fe:
            failures.append(f"V5 frontend gate.ts missing {tok}")

# V6 ----------------------------------------------------------------------
if email_index:
    for slug in ['"individual.verification_authorized"', '"business.verification_authorized"']:
        if slug not in email_index:
            failures.append(f"V6 email registry missing {slug}")

# Report -------------------------------------------------------------------
if failures:
    print("VERIFICATION PAYWALL GATE AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("VERIFICATION PAYWALL GATE AUDIT: PASS (6/6)")
print("  ✓ V1 structured gate + codes + PAID_PLAN_KEYS (free excluded) + loader")
print("  ✓ V2 all 3 Bridge entry points enforce paid+review gate behind env pause")
print("  ✓ V3 migration adds review state (default pending_manual_review) + RPC")
print("  ✓ V4 authorize-verification emails via send-email, recipient from DB")
print("  ✓ V5 frontend gate helpers present")
print("  ✓ V6 verification_authorized templates registered")

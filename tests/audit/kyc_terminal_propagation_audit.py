#!/usr/bin/env python3
"""
KYC terminal-status propagation audit (#53 item 4 — backend, deploy-gated).

handleBridgeCustomerStatus (plain customer.* events, e.g. customer.updated /
customer.updated.status_transitioned) must propagate ONLY a *terminal* Bridge
customer status into canonical kyc_status, never on every account update:

  Bridge customer terminal states (confirmed from bridge_webhook_events data):
    active   -> kyc_status 'verified'
    rejected -> kyc_status 'rejected'
  Non-terminal (not_started / incomplete / pending / under_review) -> leave
  canonical kyc_status untouched; only mirror bridge_account_status (as before).

No email send here (that is a later, separate PR). No replay. Deploy-gated.

Invariants (fail closed):

  (T1) handleBridgeCustomerStatus maps active->verified and rejected->rejected.
  (T2) kyc_status is written ONLY when the status is terminal (guarded by the
       canonicalKyc value; non-terminal yields null and skips kyc_status).
  (T3) bridge_account_status is still mirrored (no regression).
  (T4) no email send / no Resend / no replay inside this handler.
  (T5) handleBridgeKycKyb terminal propagation is unchanged (approved->verified,
       rejected->rejected) — regression guard.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/kyc_terminal_propagation_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "supabase" / "functions" / "process-pending-events" / "index.ts"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def sl(s: str, start: str, end: str) -> str:
    i = s.find(start)
    if i < 0:
        return ""
    j = s.find(end, i + len(start))
    return s[i:j] if j > i else s[i:]


def main() -> int:
    src = read(WORKER)
    cust = sl(src, "async function handleBridgeCustomerStatus", "async function handleBridge")
    # handleBridgeKycKyb appears before handleBridgeCustomerStatus in the file;
    # slice it independently from its own start.
    kyc = sl(src, "async function handleBridgeKycKyb", "async function handleBridgeCustomerStatus")

    checks: list[tuple[str, bool, str]] = []

    # T1 — terminal mapping present
    t1 = ('accountStatus === "active"' in cust
          and '"verified"' in cust
          and 'accountStatus === "rejected"' in cust
          and '"rejected"' in cust)
    checks.append(("T1 customer terminal active->verified / rejected->rejected", t1,
                   "handleBridgeCustomerStatus must map active->verified and rejected->rejected"))

    # T2 — kyc_status only on terminal (guarded), non-terminal -> null
    t2 = ("const canonicalKyc" in cust
          and ": null" in cust
          and "if (canonicalKyc) update.kyc_status = canonicalKyc" in cust)
    checks.append(("T2 kyc_status written only when terminal", t2,
                   "non-terminal must yield null and skip kyc_status (guarded write)"))

    # T3 — bridge_account_status still mirrored
    t3 = "bridge_account_status: accountStatus" in cust
    checks.append(("T3 bridge_account_status still mirrored", t3,
                   "handler must still write bridge_account_status"))

    # T4 — no email / no resend / no replay in this handler
    low = cust.lower()
    t4 = ("send-email" not in cust and "resend" not in low and "replay" not in low)
    checks.append(("T4 no email / resend / replay in handler", t4,
                   "terminal propagation must not send email or replay (separate PR)"))

    # T5 — kyc/kyb handler terminal propagation unchanged
    t5 = ('kyc_status:               normalized === "approved" ? "verified" : normalized === "rejected" ? "rejected" : "pending"' in kyc
          or ('normalized === "approved" ? "verified"' in kyc and 'normalized === "rejected" ? "rejected"' in kyc))
    checks.append(("T5 handleBridgeKycKyb terminal propagation unchanged", t5,
                   "kyc/kyb handler must still map approved->verified, rejected->rejected"))

    print("kyc_terminal_propagation_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

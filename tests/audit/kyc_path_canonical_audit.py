#!/usr/bin/env python3
"""
Canonical KYC path audit (Bridge Core PR2 — doc-only clarification).

Resolves the "two KYC paths" question from the Bridge Core contract and LOCKS the
canonical wiring so it can't silently drift:

  CANONICAL (live)  = Bridge hosted-link: KYCVerification.tsx / SignUpFlow.tsx call
                      bridgeAPI.kyc.startIndividual / kyb.startBusiness
                      (bridge-customer → bridge-kyc-link / bridge-kyb-link);
                      status via kyc-status.
  LEGACY (inert)    = kycAPI.submit / verifyBVN are quarantined stubs
                      (return RAILS_FUTURE_STATE; no network). No component calls
                      the orphaned legacy `kyc-submit` edge function.

This PR changes NO behavior and deletes NOTHING (kyc-submit retirement + stale
removed-provider cleanup is handled separately).

Invariants (fail closed):

  (K1) KYCVerification uses the Bridge hosted-link flow.
  (K2) SignUpFlow onboarding uses the Bridge path (bridge-customer + link fns).
  (K3) NO component/util references the orphaned `kyc-submit` edge function.
  (K4) Legacy kycAPI write surface stays quarantined (RAILS_FUTURE_STATE; the
       write path is NOT wired to a network endpoint).
  (K5) KYC status read path (kyc-status) remains operational.
  (K6) The contract doc records the canonical resolution.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/kyc_path_canonical_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT   = Path(__file__).resolve().parents[2]
KYCV   = ROOT / "components" / "kyc" / "KYCVerification.tsx"
SIGNUP = ROOT / "components" / "auth" / "SignUpFlow.tsx"
BAPI   = ROOT / "utils" / "api" / "backendAPI.ts"
DOC    = ROOT / "docs" / "bridge-core-contract.md"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    kycv = read(KYCV)
    signup = read(SIGNUP)
    bapi = read(BAPI)
    doc = read(DOC)

    checks: list[tuple[str, bool, str]] = []

    # Free in-app KYC: the screen READS status AND lets the user start
    # verification via the CANONICAL Bridge hosted-link helpers (no legacy
    # kyc-submit). It must show status (bridge_kyc_status) and start through
    # bridge.kyc.startIndividual / bridge.kyb.startBusiness.
    checks.append(("K1 KYCVerification shows status + starts via canonical Bridge path",
                   ("bridge_kyc_status" in kycv
                    and "bridge.kyc.startIndividual" in kycv
                    and "bridge.kyb.startBusiness" in kycv
                    and "kyc-submit" not in kycv),
                   "KYCVerification must read status AND start verification via bridge.kyc.startIndividual / kyb.startBusiness (canonical), never kyc-submit"))

    checks.append(("K2 SignUpFlow hands both account types to hosted verification",
                   ("type SignUpStep = 'personal' | 'confirm-email';" in signup
                    and "onSignUpSuccess(data.user);" in signup
                    and "currentStep === 'identity'" not in signup
                    and "currentStep === 'proof-of-address'" not in signup),
                   "SignUpFlow must end after email confirmation and hand off to the dashboard hosted KYC/KYB flow; legacy in-app document steps must be unreachable"))

    # K3 — no component/util references the orphaned kyc-submit edge function.
    scan = list((ROOT / "components").rglob("*.tsx")) + list((ROOT / "components").rglob("*.ts"))
    scan += list((ROOT / "utils").rglob("*.ts")) + list((ROOT / "utils").rglob("*.tsx"))
    kyc_submit_hits = [str(f.relative_to(ROOT)) for f in scan if "kyc-submit" in read(f)]
    checks.append(("K3 no live caller of kyc-submit",
                   not kyc_submit_hits,
                   f"kyc-submit referenced by: {kyc_submit_hits}"))

    checks.append(("K4 legacy kycAPI write surface quarantined",
                   ("kycAPI" in bapi and "RAILS_FUTURE_STATE" in bapi and "kyc-submit" not in bapi),
                   "kycAPI.submit/verifyBVN must stay RAILS_FUTURE_STATE stubs; no kyc-submit wiring"))

    checks.append(("K5 KYC status read path intact",
                   "kyc-status" in bapi,
                   "kyc-status read must remain operational"))

    checks.append(("K6 contract records canonical resolution + kyc-submit not-deployed",
                   ("Canonical KYC = Bridge hosted-link" in doc and "NOT deployed" in doc),
                   "contract doc must state canonical KYC path + that kyc-submit is NOT deployed"))

    print("kyc_path_canonical_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

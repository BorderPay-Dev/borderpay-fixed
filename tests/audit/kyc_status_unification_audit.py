#!/usr/bin/env python3
"""
KYC status-unification audit (Bridge Core — frontend status derivation).

Implements docs/bridge-kyc-status-unification-plan.md items 1-3: a Bridge-first
status helper, routing display/gating surfaces through it, and caching the Bridge
fields the helper needs. The defect being fixed: a Bridge-rejected customer still
showed "pending/started" because most surfaces read the canonical/cached
kyc_status while only the Bridge cards read bridge_kyc_status.

Invariants (fail closed):

  (U1) deriveKycStatus() exists, reads bridge_kyc_status / bridge_kyb_status /
       bridge_account_status AND legacy kyc_status, and a Bridge terminal REJECT
       is returned BEFORE the legacy 'verified' fallback (rejected overrides a
       stale 'pending'/'verified' read).
  (U2) isKycVerified() derives from deriveKycStatus (gating uses the helper).
  (U3) SAFE_FIELDS caches bridge_account_status + bridge_kyb_status so the cached
       borderpay_user can be derived correctly.
  (U4) every display/gating surface routes through deriveKycStatus / isKycVerified.
  (U5) the old raw-kyc_status gating/display reads are gone on the key surfaces.
  (U6) AppContext.UserProfile carries the Bridge fields used by the helper/cache.
  (U7) Dashboard account badge has a rejected state and does not flatten
       derived rejected KYC into Starter.

Non-runtime: parses source as text. No deploy, no DB, no network.

Run: python3 tests/audit/kyc_status_unification_audit.py   (exit 0 = pass)
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV    = ROOT / "utils" / "config" / "environment.ts"
CLIENT = ROOT / "utils" / "supabase" / "client.ts"
APPCTX = ROOT / "utils" / "app" / "AppContext.tsx"

GATING = [
    "components/app/Dashboard.tsx",
    "components/cards/CardDesignSelector.tsx",
    "components/wallet/RequestProvisioningModal.tsx",
    "components/wallet/WalletScreen.tsx",
    "components/accounts/USDAccountScreen.tsx",
    "components/deposit/AddMoneyScreen.tsx",
    "components/send/SendMoneyFlow.tsx",
    "components/auth/LoginScreen.tsx",
    "components/profile/ProfileScreen.tsx",
    "components/dashboard/bridge/BridgeKycStatusCard.tsx",
]


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.is_file() else ""


def main() -> int:
    env = read(ENV)
    client = read(CLIENT)
    appctx = read(APPCTX)
    checks: list[tuple[str, bool, str]] = []

    # U1 — deriveKycStatus reads all signals + rejected-before-verified ordering
    has_fn = "export function deriveKycStatus(" in env
    reads_all = all(k in env for k in
                    ("bridge_kyc_status", "bridge_kyb_status", "bridge_account_status", "kyc_status"))
    i_reject = env.find("return 'rejected'")
    i_verified_legacy = env.find("if (isFullEnrollment(legacy)) return 'verified'")
    order_ok = i_reject >= 0 and i_verified_legacy >= 0 and i_reject < i_verified_legacy
    checks.append(("U1 deriveKycStatus Bridge-first, rejected overrides verified",
                   has_fn and reads_all and order_ok,
                   "deriveKycStatus must read all bridge+legacy fields and return 'rejected' before the legacy verified fallback"))

    # U2 — isKycVerified derives from deriveKycStatus
    checks.append(("U2 isKycVerified derives from deriveKycStatus",
                   "export function isKycVerified(" in env and "deriveKycStatus(profile) === 'verified'" in env,
                   "isKycVerified must be deriveKycStatus(profile) === 'verified'"))

    # U3 — cache carries the bridge fields
    checks.append(("U3 SAFE_FIELDS caches bridge_account_status + bridge_kyb_status",
                   "'bridge_account_status'" in client and "'bridge_kyb_status'" in client,
                   "SAFE_FIELDS must include bridge_account_status and bridge_kyb_status"))

    # U4 — every gating/display surface routes through the helper
    missing = []
    for rel in GATING:
        src = read(ROOT / rel)
        if not ("deriveKycStatus(" in src or "isKycVerified(" in src):
            missing.append(rel)
    checks.append(("U4 all gating/display surfaces use the helper",
                   not missing,
                   f"surfaces not routed through deriveKycStatus/isKycVerified: {missing}"))

    # U5 — old raw reads removed on key surfaces
    dash = read(ROOT / "components/app/Dashboard.tsx")
    login = read(ROOT / "components/auth/LoginScreen.tsx")
    prof = read(ROOT / "components/profile/ProfileScreen.tsx")
    card = read(ROOT / "components/dashboard/bridge/BridgeKycStatusCard.tsx")
    u5 = ("isFullEnrollment(cachedProfile" not in dash
          and "isFullEnrollment(p.kyc_status" not in dash
          and "kyc_status === 'verified'" not in login
          and "switch (profile.kyc_status)" not in prof
          and "deriveKycStatus(profile)" in prof
          and "bridge_account_status" in card
          and "deriveKycStatus(" in card
          and "setStatus((prof?.bridge_kyc_status" not in card)
    checks.append(("U5 raw kyc_status gating/display removed on key surfaces", u5,
                   "Dashboard/LoginScreen/ProfileScreen/BridgeKycStatusCard must not gate/display on raw kyc_status or raw bridge_kyc_status"))

    # U6 — AppContext profile type includes all Bridge fields used for derivation.
    u6 = all(k in appctx for k in ("bridge_kyc_status", "bridge_kyb_status", "bridge_account_status"))
    checks.append(("U6 AppContext profile type carries Bridge derivation fields", u6,
                   "UserProfile must include bridge_kyc_status, bridge_kyb_status, bridge_account_status"))

    badge = read(ROOT / "components" / "activation" / "AccountStatusBadge.tsx")
    u7 = ("'active' | 'rejected'" in badge
          and "Verification failed" in badge
          and "const [kycStatus, setKycStatus]" in dash
          and "setKycStatus(" in dash
          and "kycStatus === 'rejected' ? 'rejected' : 'starter'" in dash)
    checks.append(("U7 dashboard account badge preserves rejected status", u7,
                   "Dashboard/AccountStatusBadge must represent rejected separately from starter"))

    print("kyc_status_unification_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

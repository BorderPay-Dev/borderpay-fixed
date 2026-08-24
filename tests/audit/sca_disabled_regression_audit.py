#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text()


policy = read("utils/security/useScaRequirement.ts")
dialog = read("components/security/SCAChallengeDialog.tsx")
shared = read("supabase/functions/_shared/sca.ts")
authorize = read("supabase/functions/sca-authorize/index.ts")

assert "return 'not_required';" in policy, "client SCA policy must be disabled"
assert "if (requirement === 'not_required') return null;" in dialog, "disabled SCA dialog must not render"
assert "CUSTOMER_SCA_ENFORCEMENT_ENABLED = false" in shared, "server SCA enforcement must be disabled"
assert "if (!CUSTOMER_SCA_ENFORCEMENT_ENABLED) return { ok: true };" in shared, "protected APIs must bypass disabled SCA"
assert "if (!CUSTOMER_SCA_ENFORCEMENT_ENABLED)" in authorize, "authorization endpoint must expose disabled state"
assert 'sca_required: false' in authorize, "authorization endpoint must not claim SCA is required"

print("SCA disabled regression audit: PASS")

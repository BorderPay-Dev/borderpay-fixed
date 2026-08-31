#!/usr/bin/env python3
"""Keep the Bridge SCA evidence package honest and aligned with the corrected API shape."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
package = (ROOT / "docs/BRIDGE_EEA_SCA_EVIDENCE_PACKAGE_2026-08-31.md").read_text()
shared = (ROOT / "supabase/functions/_shared/sca.ts").read_text()
types = (ROOT / "supabase/functions/_shared/providers/types.ts").read_text()

required_package_markers = (
    "Status: DRAFT - evidence capture incomplete; do not submit as final",
    "Login is not an SCA-protected action",
    "Fund-in/deposit flows",
    "The United Kingdom and Switzerland are excluded",
    '"outcome": "sca_used"',
    "at least 1,827 days",
    "No production transfer test will be attempted until Bridge authorizes QA",
    "This package must not be sent as “complete”",
)

for marker in required_package_markers:
    if marker not in package:
        raise AssertionError(f"Bridge SCA evidence package is missing: {marker}")

if 'attestations: { sca: { outcome: "sca_used" as const } }' not in shared:
    raise AssertionError("Bridge initiation does not use the corrected nested SCA outcome")
if "outcome:" not in types:
    raise AssertionError("Bridge transfer type does not model the corrected SCA outcome")

for unsupported_claim in ("Bridge approved BorderPay", "production SCA verified", "fully compliant"):
    if unsupported_claim in package:
        raise AssertionError(f"Unsupported claim in Bridge SCA evidence: {unsupported_claim}")

print("bridge_sca_evidence_package_audit: PASS (draft remains fail-closed for submission)")

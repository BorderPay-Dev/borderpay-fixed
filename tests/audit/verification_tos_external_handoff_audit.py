#!/usr/bin/env python3
"""Blocking gate for the ToS -> external KYC/KYB handoff."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "components/kyc/KYCVerification.tsx").read_text(encoding="utf-8")

handler_start = SOURCE.find("const continueFromEmbeddedTos = async () =>")
handler_end = SOURCE.find("\n  const VIEW:", handler_start)
handler = SOURCE[handler_start:handler_end]
success_start = handler.find("if (r?.success && r.data?.link_url)")
success_end = handler.find("if (r?.success && r.data?.tos_link_url)", success_start)
success = handler[success_start:success_end]

checks = {
    "verification starts through the explicit Terms phase": "requestHostedLink(ctx.accountType, tosAccepted ? 'kyb' : 'terms')" in SOURCE,
    "unaccepted Terms open in the embedded ToS view": "openHostedVerificationUrl(r.data.tos_link_url" in SOURCE,
    "ToS embed cannot be dismissed as verification completion": "returnEnabled: false" in SOURCE,
    "Continue handler exists": handler_start >= 0 and handler_end > handler_start,
    "blank popup handoff is forbidden": "window.open('about:blank'" not in handler,
    "Continue requests a fresh KYB state after Terms acceptance": "requestHostedLink(ctx.accountType, 'kyb')" in handler,
    "accepted Terms produce an identity-verification link": "r.data?.link_url" in handler,
    "KYB link uses the external handoff": "openTopLevelHostedFallback(r.data.link_url)" in success,
    "identity verification is never loaded in the embedded iframe": "openHostedVerificationUrl(r.data.link_url" not in SOURCE,
    "native runtime is detected explicitly": "isNativeRuntime()" in SOURCE,
    "native provider verification uses the Capacitor Browser": "Browser.open({ url, presentationStyle: 'popover' })" in SOURCE,
    "native provider verification does not use window.open": "window.open(url" not in SOURCE,
    "web and PWA retain direct browser navigation": "window.location.assign(url)" in SOURCE,
    "blank placeholder popup remains forbidden": "window.open('about:blank'" not in SOURCE,
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("verification_tos_external_handoff_audit: FAIL\n- " + "\n- ".join(failed))

print(f"verification_tos_external_handoff_audit: PASS ({len(checks)}/{len(checks)})")

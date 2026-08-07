from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyc = (ROOT / "components/kyc/KYCVerification.tsx").read_text()

failures: list[str] = []

def require(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)

require("const openTopLevelTos" in kyc,
        "KYC ToS must have a dedicated top-level browser navigation path.")
require("sessionStorage.setItem(resumeAfterTosKey, '1')" in kyc,
        "KYC ToS navigation must persist automatic verification resume state.")
require("sessionStorage.setItem('borderpay_post_callback_screen', 'kyc')" in kyc,
        "KYC ToS navigation must return users to the KYC/KYB screen.")
require("openTopLevelTos(r.data.tos_link_url)" in kyc,
        "Every provider ToS response must use top-level navigation.")
require("openHostedVerificationUrl(r.data.tos_link_url" not in kyc,
        "Provider ToS must never be embedded in an iframe because privacy-enabled browsers can render it blank.")

if failures:
    print("kyc_tos_warning_audit: FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("kyc_tos_warning_audit: PASS")

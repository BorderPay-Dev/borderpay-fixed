from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
kyc = (ROOT / "components/kyc/KYCVerification.tsx").read_text()

failures: list[str] = []

def require(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)

require("!embeddedReturnEnabled" in kyc,
        "KYC ToS warning must live in the embedded ToS branch.")
require("You must accept the Terms of Service before continuing verification." in kyc,
        "KYC ToS warning must explicitly say Terms acceptance is required.")
require("Skipping this step can delay or block account approval." in kyc,
        "KYC ToS warning must explain approval delay/block risk.")
require("text-red-400" in kyc and "border-red-500/40" in kyc and "bg-red-500/15" in kyc,
        "KYC ToS warning must be visibly red, not neutral helper copy.")
require("Continue verification <ArrowRight" in kyc,
        "KYC ToS branch must still expose Continue verification CTA after warning.")

if failures:
    print("kyc_tos_warning_audit: FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("kyc_tos_warning_audit: PASS")

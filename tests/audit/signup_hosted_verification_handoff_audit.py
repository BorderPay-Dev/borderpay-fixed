from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SIGNUP = (ROOT / "components/auth/SignUpFlow.tsx").read_text()


def main() -> None:
    failures: list[str] = []

    if "setCurrentStep('identity')" in SIGNUP:
        failures.append(
            "individual signup must not enter the retired in-app identity/document flow"
        )

    marker = "Individual KYC is completed through the same hosted"
    section = SIGNUP[SIGNUP.find(marker):] if marker in SIGNUP else ""
    if "onSignUpSuccess(data.user);" not in section[:1000]:
        failures.append(
            "verified individual signup must hand off to the authenticated dashboard"
        )

    business_marker = "if (formData.accountType === 'business')"
    business_section = SIGNUP[SIGNUP.find(business_marker):] if business_marker in SIGNUP else ""
    if "onSignUpSuccess(data.user);" not in business_section[:7000]:
        failures.append(
            "verified business signup must hand off to the authenticated dashboard"
        )

    if failures:
        raise SystemExit("\n".join(f"FAIL: {failure}" for failure in failures))

    print("PASS: verified signup uses the hosted dashboard verification handoff")


if __name__ == "__main__":
    main()

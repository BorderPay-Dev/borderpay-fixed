from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEND = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
RECEIVE = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
BOOTSTRAP = (ROOT / "utils/review/appReviewDemoBootstrap.ts").read_text()

failures = []

for label, source in [("send", SEND), ("receive", RECEIVE)]:
    for forbidden_copy in [
        "Choose a Yellow Card",
        "Yellow Card countries",
        "Yellow Card sandbox outcome",
        "Countries and rails come only from Yellow Card",
    ]:
        if forbidden_copy in source:
            failures.append(f"{label} customer UI exposes provider copy: {forbidden_copy}")

if "{bank.code}</p>" in SEND:
    failures.append("send bank picker renders a backend bank/network identifier")

if "African receive rails" not in RECEIVE:
    failures.append("receive landing page is missing the provider-neutral African receive rails label")

for key in [
    "borderpay_business_dash_wallets_v1",
    "borderpay_business_dash_va_v1",
    "borderpay_business_dash_tx_v1",
]:
    if key not in BOOTSTRAP:
        failures.append(f"review demo bootstrap is missing business/PWA cache {key}")

if "authUserId !== account.id" in BOOTSTRAP:
    failures.append("review demo bootstrap still rejects recreated authenticated demo users")

if failures:
    print("african_rails_customer_ui_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("african_rails_customer_ui_audit: PASS")

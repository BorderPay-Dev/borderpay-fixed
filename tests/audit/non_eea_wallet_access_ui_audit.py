from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
main = (ROOT / "components/app/MainApp.tsx").read_text()
dialog = (ROOT / "components/security/SCAChallengeDialog.tsx").read_text()
business = (ROOT / "components/business/BusinessDashboard.tsx").read_text()
dashboard = (ROOT / "components/app/Dashboard.tsx").read_text()
flag = (ROOT / "components/ui/FiatCurrencyFlag.tsx").read_text()

checks = {
    "server requirement remains fail closed": "result?.success && result?.data?.sca_required === false" in (ROOT / "utils/security/useScaRequirement.ts").read_text(),
    "non-EEA bypass remains server classified": "requirement !== 'not_required'" in dialog,
    "empty bypass does not call EEA grant endpoint": "if (!authorizationId)" in main and main.index("if (!authorizationId)") < main.index("grantWalletAccess(authorizationId)"),
    "bypass releases dashboard": "setWalletAccessGranted(true)" in main,
    "EEA authorization still consumed": "grantWalletAccess(authorizationId)" in main,
    "business dashboard uses deterministic flags": "<FiatCurrencyFlag currency={code}" in business,
    "individual dashboard uses deterministic flags": "<FiatCurrencyFlag currency={code}" in dashboard,
    "flag component has no emoji regional indicators": "🇺🇸" not in flag and "🇬🇧" not in flag and "🇪🇺" not in flag,
}

for name, passed in checks.items():
    print(f"[{'PASS' if passed else 'FAIL'}] {name}")
if not all(checks.values()):
    raise SystemExit(1)
print("non_eea_wallet_access_ui_audit: PASS")

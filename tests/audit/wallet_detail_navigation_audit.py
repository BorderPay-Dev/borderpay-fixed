#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WALLET = ROOT / "components/wallet/WalletScreen.tsx"
MAIN_APP = ROOT / "components/app/MainApp.tsx"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def require(src: str, needle: str, label: str) -> None:
    if needle not in src:
        raise SystemExit(f"{label}: missing {needle!r}")


def main() -> None:
    wallet = read(WALLET)
    main_app = read(MAIN_APP)

    require(wallet, "import { FloatingBackButton } from '../common/FloatingBackButton';", "WalletScreen")
    require(wallet, '<FloatingBackButton onBack={onBack} label="Return to main app" />', "WalletScreen")
    require(wallet, "pt-floating-back", "WalletScreen")
    require(main_app, "suppressHeaderChrome={currentScreen === 'wallet-detail' || detailSheetOpen}", "MainApp")
    require(main_app, "<WalletScreen", "MainApp")
    require(main_app, "onBack={navigateBack}", "MainApp")

    print("wallet detail navigation audit passed")


if __name__ == "__main__":
    main()

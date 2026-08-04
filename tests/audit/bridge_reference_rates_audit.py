#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAIRS = ("USD_USDC", "USD_USDT", "EUR_USDC", "EUR_USDT", "GBP_USDC", "GBP_USDT")

widget = (ROOT / "components/dashboard/fx/ExchangeRateWidget.tsx").read_text()
edge = (ROOT / "supabase/functions/bridge-exchange-rates/index.ts").read_text()
main = (ROOT / "components/app/MainApp.tsx").read_text()
legacy_screen = (ROOT / "components/exchange/ExchangeScreen.tsx").read_text()

checks = {
    "all six requested pairs are explicit": all(pair in widget.replace("', '", "_") for pair in PAIRS),
    "edge function allowlists all six pairs": all(f'"{pair}"' in edge for pair in PAIRS),
    "dashboard batches rate reads": "backendAPI.fx.getReferenceRates" in widget and "Promise.all" not in widget,
    "successful provider reads are briefly cached": "CACHE_TTL_MS" in edge and "rateCache" in edge,
    "no guessed fallback rates": "FALLBACK" not in widget and "0.92" not in widget and "0.79" not in widget,
    "no customer conversion action": "onNavigate" not in widget and "Convert" not in widget,
    "transaction-rate disclaimer present": "completed transaction receipt shows the rate applied" in widget,
    "exchange screen is unreachable": "return <ExchangeScreen" not in main and "import { ExchangeScreen }" not in main,
    "legacy exchange component is indicative-only": "Indicative rates" in legacy_screen
    and "ExchangeRateWidget" in legacy_screen
    and "backendAPI.fx.convert" not in legacy_screen
    and "backendAPI.fx.getQuote" not in legacy_screen,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"[{'OK' if ok else 'FAIL'}] {name}")
raise SystemExit(1 if failed else 0)

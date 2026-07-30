#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RECEIVE = ROOT / "components/receive/ReceiveMoneyScreen.tsx"
SEND = ROOT / "components/send/SendMoneyFlow.tsx"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def require(src: str, needle: str, label: str) -> None:
    if needle not in src:
        raise SystemExit(f"{label}: missing {needle!r}")


def reject(src: str, needle: str, label: str) -> None:
    if needle in src:
        raise SystemExit(f"{label}: forbidden {needle!r}")


def block_between(src: str, start: str, end: str, label: str) -> str:
    try:
      i = src.index(start)
      j = src.index(end, i)
      return src[i:j]
    except ValueError as exc:
      raise SystemExit(f"{label}: could not locate block") from exc


def main() -> None:
    receive = read(RECEIVE)
    send = read(SEND)

    visible_vas = block_between(receive, "const visibleVas = useMemo(() => {", "const visibleStableRows", "Receive visibleVas")
    require(visible_vas, "['USD', 'EUR', 'GBP'].includes(currency)", "Receive visibleVas")
    require(visible_vas, "String(v.status || '').toLowerCase() === 'active'", "Receive visibleVas")
    require(visible_vas, "Boolean(v.bridge_virtual_account_id)", "Receive visibleVas")
    reject(visible_vas, "bridgeVirtualAccountCurrenciesForCountry", "Receive visibleVas")
    reject(receive, "bridgeVirtualAccountCurrenciesForCountry,", "Receive imports")

    require(
        send,
        "isAfricanPayout && activeFundingWallet && africanQuoteError && !limitError",
        "Send Africa validation copy",
    )

    print("receive VA and Africa error UI audit passed")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fail CI if legacy stablecoins leak into runtime surfaces."""

from __future__ import annotations

from pathlib import Path
import sys


REPO = Path(__file__).resolve().parents[2]
TARGETS = [
    REPO / "components",
    REPO / "utils",
    REPO / "supabase" / "functions",
]
LEGACY = ("PYUSD", "USDB", "EURC")


def main() -> int:
    hits: list[tuple[Path, int, str]] = []
    for root in TARGETS:
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if any(part in {"docs", "migrations"} for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except Exception:
                continue
            for i, line in enumerate(text.splitlines(), start=1):
                if any(token in line for token in LEGACY):
                    hits.append((path.relative_to(REPO), i, line.strip()))

    if hits:
        print("[legacy-stablecoin-guard] ERROR: legacy stablecoin symbols found in runtime code:")
        for p, line_no, line in hits[:200]:
            print(f"  - {p}:{line_no}: {line}")
        return 1

    print("[legacy-stablecoin-guard] OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


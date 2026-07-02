#!/usr/bin/env python3
"""Verify Flutterwave endpoint inventory against backend API references."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_API = REPO_ROOT / "utils" / "api" / "backendAPI.ts"
FUNCTIONS_DIR = REPO_ROOT / "supabase" / "functions"
INVENTORY_DOC = REPO_ROOT / "docs" / "FLUTTERWAVE_ENDPOINT_INVENTORY.md"


ENDPOINT_PATTERN = re.compile(r"'((?:admin-)?flutterwave-[a-z0-9-]+)'")


def main() -> int:
    api_text = BACKEND_API.read_text(encoding="utf-8")
    doc_text = INVENTORY_DOC.read_text(encoding="utf-8")

    referenced = sorted(set(ENDPOINT_PATTERN.findall(api_text)))
    if not referenced:
        print("[flutterwave-inventory] ERROR: no Flutterwave endpoints found in backendAPI.ts")
        return 1

    missing_function_dirs: list[str] = []
    missing_inventory_rows: list[str] = []

    for endpoint in referenced:
        endpoint_dir = FUNCTIONS_DIR / endpoint
        if not endpoint_dir.exists():
            missing_function_dirs.append(endpoint)

        if endpoint.startswith("admin-"):
            continue
        if endpoint not in doc_text:
            missing_inventory_rows.append(endpoint)

    if missing_function_dirs:
        print("[flutterwave-inventory] ERROR: missing function directories:")
        for endpoint in missing_function_dirs:
            print(f"  - {endpoint}")
        return 1

    if missing_inventory_rows:
        print("[flutterwave-inventory] ERROR: missing endpoint rows in FLUTTERWAVE_ENDPOINT_INVENTORY.md:")
        for endpoint in missing_inventory_rows:
            print(f"  - {endpoint}")
        return 1

    print("[flutterwave-inventory] OK")
    print(f"[flutterwave-inventory] referenced endpoints: {len(referenced)}")
    print(
        f"[flutterwave-inventory] non-admin inventory-checked endpoints: "
        f"{sum(1 for endpoint in referenced if not endpoint.startswith('admin-'))}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

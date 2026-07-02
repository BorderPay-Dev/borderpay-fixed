#!/usr/bin/env python3
"""Verify that backendAPI edge endpoints have deployed function handlers."""

from __future__ import annotations

import re
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
BACKEND_API = REPO / "utils" / "api" / "backendAPI.ts"
FUNCTIONS_DIR = REPO / "supabase" / "functions"

# Placeholder in comments/docs; not a real endpoint call.
IGNORED_ENDPOINTS = {"edge-function-name"}


def main() -> int:
    text = BACKEND_API.read_text(encoding="utf-8")
    endpoints = sorted(set(re.findall(r"apiCall(?:<[^>]+>)?\(\s*'([^']+)'", text)))
    endpoints = [ep for ep in endpoints if ep not in IGNORED_ENDPOINTS]

    missing_dirs: list[str] = []
    missing_handlers: list[str] = []
    for ep in endpoints:
        fn_dir = FUNCTIONS_DIR / ep
        if not fn_dir.is_dir():
            missing_dirs.append(ep)
            continue
        if not (fn_dir / "index.ts").exists():
            missing_handlers.append(ep)

    if missing_dirs:
        print("[backend-endpoint-inventory] ERROR: backendAPI references missing function directories:")
        for ep in missing_dirs:
            print(f"  - {ep}")
        return 1

    if missing_handlers:
        print("[backend-endpoint-inventory] ERROR: function directories missing index.ts handler:")
        for ep in missing_handlers:
            print(f"  - {ep}")
        return 1

    print("[backend-endpoint-inventory] OK")
    print(f"[backend-endpoint-inventory] endpoints checked: {len(endpoints)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

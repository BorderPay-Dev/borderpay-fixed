#!/usr/bin/env python3
"""Verify that backendAPI edge endpoints have matching function directories."""

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

    existing = {p.name for p in FUNCTIONS_DIR.iterdir() if p.is_dir()}
    missing = sorted(ep for ep in endpoints if ep not in existing)

    if missing:
        print("[backend-endpoint-inventory] ERROR: backendAPI references missing function directories:")
        for ep in missing:
            print(f"  - {ep}")
        return 1

    print("[backend-endpoint-inventory] OK")
    print(f"[backend-endpoint-inventory] endpoints checked: {len(endpoints)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

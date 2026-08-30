#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "utils/api/backendAPI.ts").read_text()

required = (
    "function hasAuthenticatedSubject",
    "token === ANON_KEY",
    "payload?.sub",
    "if (!hasAuthenticatedSubject(token))",
    "return { success: false, error: 'Authentication required' }",
    "'Authorization': `Bearer ${token}`",
)

for fragment in required:
    if fragment not in SOURCE:
        raise SystemExit(f"authenticated API polling invariant missing: {fragment}")

if "'Authorization': `Bearer ${token || ANON_KEY}`" in SOURCE:
    raise SystemExit("authenticated apiCall still sends the anon key as a user bearer token")

print("authenticated API polling audit passed")

#!/usr/bin/env python3
"""Fail CI when high-impact credentials are committed as literals.

This scans all Git-tracked text files and reports file/line/type,
never the matched credential. GitHub push protection remains the broader
provider-token detector.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".lock"}
SKIP_PATHS = {".env.example"}
SKIP_PREFIXES: tuple[str, ...] = ()

PATTERNS = {
    "private_key": re.compile(r"^\s*-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*$"),
    "stripe_live_key": re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b"),
    "flutterwave_live_key": re.compile(r"\bFLWSECK(?:_TEST)?-[A-Za-z0-9_-]{20,}\b"),
    "github_token": re.compile(r"\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b"),
}
JWT = re.compile(r"eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}")


def is_service_role_jwt(token: str) -> bool:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload.encode()))
        return str(claims.get("role", "")).lower() == "service_role"
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return False


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True
    )
    return [value.decode() for value in result.stdout.split(b"\0") if value]


findings: list[tuple[str, int, str]] = []
for relative in tracked_files():
    path = ROOT / relative
    if relative in SKIP_PATHS or relative.startswith(SKIP_PREFIXES) or path.suffix.lower() in SKIP_SUFFIXES:
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    lines = text.splitlines()
    for line_number, line in enumerate(lines, 1):
        if any(is_service_role_jwt(token) for token in JWT.findall(line)):
            findings.append((relative, line_number, "supabase_service_role_jwt"))
        for name, pattern in PATTERNS.items():
            if pattern.search(line):
                # Documentation may show a deliberately empty PEM skeleton.
                # A real key contains encoded material instead of a literal
                # ellipsis and therefore remains a finding.
                if name == "private_key" and line_number < len(lines) and lines[line_number].strip() == "...":
                    continue
                findings.append((relative, line_number, name))

if findings:
    for relative, line_number, name in findings:
        print(f"FAIL: {relative}:{line_number}: possible {name}")
    raise SystemExit(f"tracked-secret scan failed with {len(findings)} finding(s)")

print("PASS: no high-impact credential literals found in tracked runtime files")

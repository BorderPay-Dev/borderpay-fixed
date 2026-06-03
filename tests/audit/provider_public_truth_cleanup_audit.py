#!/usr/bin/env python3
"""
Provider/public truth cleanup audit.

Locks the #2 cleanup contract:
  P1. Public repo README no longer advertises removed providers or mock/live
      products that are not available.
  P2. Customer-facing app copy does not promise live cards, card funding,
      mobile-wallet collection, Apple/Google Pay, or active local rails.
  P3. Current source comments and runtime error strings do not name a future
      aggregator or expose provider/partner wording to customers.

Historical migrations and long-form migration runbooks are intentionally not
scanned here; they remain replay/audit history.

Run: python3 tests/audit/provider_public_truth_cleanup_audit.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


SCAN_PATHS = [
    ROOT / "README.md",
    ROOT / "components",
    ROOT / "utils",
    ROOT / "supabase" / "functions",
]

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".tools",
    "dist",
}

FORBIDDEN_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("removed provider brand", re.compile(r"\bMaplerad\b|\bmaplerad\b|\bMAPLERAD\b")),
    ("mock/live README claim", re.compile(r"\bmock data\b", re.I)),
    ("active card issuance claim", re.compile(r"Create Your First Card|create your first virtual card|create and manage your virtual cards|start making payments worldwide|ready instantly|Virtual Visa|Virtual Mastercard|Issue Card", re.I)),
    ("active card funding claim", re.compile(r"card deposit|Fund Card|Top up card|Card funded successfully", re.I)),
    ("card restriction framing", re.compile(r"Geographic Restrictions|Card Restrictions|card network restrictions|view restricted countries", re.I)),
    ("active mobile-wallet claim", re.compile(r"Receive payments from any mobile|payment prompt|Collection complete|Collection initiated successfully|bank transfer or mobile money|mobile money providers", re.I)),
    ("card network wallet claim", re.compile(r"Apple Pay|Google Pay")),
    ("named future aggregator", re.compile(r"\bYativo\b")),
    ("public partner leak", re.compile(r"African on/off-ramp partner|partner is not yet integrated|handled by Bridge|through Bridge|with Bridge|by Bridge|Bridge-backed|Bridge-supported")),
]


def iter_files() -> list[Path]:
    files: list[Path] = []
    for base in SCAN_PATHS:
        if base.is_file():
            files.append(base)
            continue
        for path in base.rglob("*"):
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if path.suffix in {".ts", ".tsx", ".md"}:
                files.append(path)
    return sorted(files)


def line_no(src: str, pos: int) -> int:
    return src[:pos].count("\n") + 1


def main() -> int:
    findings: list[str] = []
    for path in iter_files():
        src = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)
        for label, pattern in FORBIDDEN_PATTERNS:
            for match in pattern.finditer(src):
                findings.append(f"{rel}:{line_no(src, match.start())}: {label}: {match.group(0)!r}")

    if findings:
        print("FAIL: provider public truth cleanup audit")
        for finding in findings:
            print("  " + finding)
        return 1

    print("PASS: provider public truth cleanup audit")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Flutterwave legacy cleanup audit.

Context:
- This repository now includes Flutterwave adapters/functions intentionally.
- The previous "flutterwave_removed_audit" assumed Flutterwave had been removed
  and now generates false failures.

Purpose (current):
- Guard only against known retired endpoint names and stale activation-fee copy.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
failures: list[str] = []

# L1: deprecated function names should not reappear in config.
cfg_path = ROOT / "supabase/config.toml"
cfg = cfg_path.read_text(encoding="utf-8") if cfg_path.exists() else ""
for token in (
    "[functions.flutterwave-checkout]",
    "[functions.flutterwave-banks]",
    "[functions.flutterwave-resolve-account]",
):
    if token in cfg:
        failures.append(f"L1 deprecated function pin present in config.toml: {token}")


def scan(globs, pattern, label):
    for g in globs:
        for p in ROOT.glob(g):
            if not p.is_file():
                continue
            txt = p.read_text(encoding="utf-8", errors="ignore")
            for m in re.finditer(pattern, txt):
                failures.append(f"{label} {p.relative_to(ROOT)}: forbidden '{m.group(0)}'")


# L2: old fee-quote endpoint alias should be retired.
scan(
    ["utils/**/*.ts", "components/**/*.tsx", "supabase/functions/**/*.ts"],
    r"'flutterwave-fee-quote'|\"flutterwave-fee-quote\"",
    "L2 deprecated endpoint",
)

# L3: deprecated Flutterwave endpoint aliases should not appear in app copy/config.
scan(
    ["components/**/*.tsx", "utils/**/*.ts", "docs/**/*.md"],
    r"\bflutterwave-checkout\b|\bflutterwave-banks\b|\bflutterwave-resolve-account\b",
    "L3 deprecated Flutterwave alias",
)

if failures:
    print("FLUTTERWAVE-LEGACY CLEANUP AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("FLUTTERWAVE-LEGACY CLEANUP AUDIT: PASS")
print("  ✓ L1 deprecated function pins absent")
print("  ✓ L2 deprecated flutterwave-fee-quote endpoint alias absent")
print("  ✓ L3 deprecated Flutterwave alias names absent")

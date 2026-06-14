#!/usr/bin/env python3
"""
Flutterwave-removed audit (replaces flutterwave_activation_audit).

The activation-fee model was retired; Flutterwave is no longer used in any form.
This audit fails closed if the gateway is reintroduced (source dir, provider
client, config pin, frontend caller, or any user-facing copy).
"""

import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
failures: list[str] = []

# F1: source dirs must not exist
for d in [
    "supabase/functions/flutterwave-checkout",
    "supabase/functions/flutterwave-webhook",
    "supabase/functions/flutterwave-banks",
    "supabase/functions/flutterwave-resolve-account",
    "supabase/functions/_shared/providers/flutterwave.ts",
]:
    if (ROOT / d).exists():
        failures.append(f"F1 {d} must not exist (Flutterwave removed)")

# F2: no config.toml pins
cfg = (ROOT / "supabase/config.toml").read_text(encoding="utf-8")
if "[functions.flutterwave-" in cfg:
    failures.append("F2 supabase/config.toml still pins flutterwave-* functions")

# F3: no remaining frontend caller of flutterwave-* endpoints (string literal)
def scan(globs, pattern, label):
    for g in globs:
        for p in ROOT.glob(g):
            if not p.is_file(): continue
            txt = p.read_text(encoding="utf-8", errors="ignore")
            for m in re.finditer(pattern, txt):
                failures.append(f"F3 {p.relative_to(ROOT)}: forbidden '{m.group(0)}' ({label})")

scan(["utils/**/*.ts", "components/**/*.tsx"], r"'flutterwave-[a-z-]+'", "frontend caller")

# F4: activation copy must be gone from user-facing components
scan(["components/**/*.tsx"], r"\bActivation Fee\b|\bone-time activation\b|Activate (?:Wallet|your account)\b", "stale activation copy")

if failures:
    print("FLUTTERWAVE-REMOVED AUDIT: FAIL")
    for f in failures:
        print(f"  ✗ {f}")
    sys.exit(1)

print("FLUTTERWAVE-REMOVED AUDIT: PASS (4/4)")
print("  ✓ F1 no Flutterwave function source dirs")
print("  ✓ F2 no Flutterwave config.toml pins")
print("  ✓ F3 no frontend caller invokes a flutterwave-* endpoint")
print("  ✓ F4 no stale activation-fee copy in components")

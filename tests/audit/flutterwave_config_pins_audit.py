#!/usr/bin/env python3
"""
Ensure Flutterwave edge-function verify_jwt pins stay explicit in supabase/config.toml.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
CFG = ROOT / "supabase/config.toml"

REQUIRED = {
    "flutterwave-capabilities": True,
    "flutterwave-account-resolve": True,
    "flutterwave-transfer-rates": True,
    "flutterwave-transfer-create": True,
    "flutterwave-transfer-status": True,
    "flutterwave-transfers-list": True,
    "flutterwave-collection-create": True,
    "flutterwave-collection-status": True,
    "flutterwave-webhook": False,
}


def main() -> int:
    if not CFG.exists():
        print("flutterwave_config_pins_audit: FAIL")
        print(" - missing file: supabase/config.toml")
        return 1

    text = CFG.read_text(encoding="utf-8")
    failures: list[str] = []
    for fn, expected in REQUIRED.items():
        pat = re.compile(
            rf"\[functions\.{re.escape(fn)}\]\s*verify_jwt\s*=\s*{'true' if expected else 'false'}",
            re.MULTILINE,
        )
        if not pat.search(text):
            failures.append(f"{fn}: expected verify_jwt={'true' if expected else 'false'}")
        else:
            print(f"[OK] {fn}: verify_jwt={'true' if expected else 'false'}")

    if failures:
        print("flutterwave_config_pins_audit: FAIL")
        for f in failures:
            print(f" - {f}")
        return 1

    print("flutterwave_config_pins_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())


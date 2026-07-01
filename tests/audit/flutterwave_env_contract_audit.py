#!/usr/bin/env python3
"""
Step 7 audit: Flutterwave env contract coverage.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

ENV_REQUIRED = [
    "FLW_SECRET_KEY=",
    "FLW_BASE_URL=",
    "FLW_HTTP_TIMEOUT_MS=",
    "FLW_RECEIVE_ENABLED=",
    "FLW_PAYOUT_ENABLED=",
    "FLW_WEBHOOK_SECRET_HASH=",
    "FLW_WEBHOOK_SECRET=",
    "FLW_WEBHOOK_REPLAY_WINDOW_MINUTES=",
    "FLW_STATIC_IP_REQUIRED=",
    "FLW_STATIC_IP_READY=",
    "FLW_MIN_COLLECTION_AMOUNT=",
]


def main() -> int:
    failures = []
    env_file = ROOT / ".env.example"
    if not env_file.exists():
        print("flutterwave_env_contract_audit: FAIL")
        print(" - missing .env.example")
        return 1

    env_text = env_file.read_text(encoding="utf-8")
    for token in ENV_REQUIRED:
        if token not in env_text:
            failures.append(f"missing env token in .env.example: {token}")
        else:
            print(f"[OK] .env.example includes {token}")

    provider_file = ROOT / "supabase/functions/_shared/providers/flutterwave.ts"
    if not provider_file.exists():
        failures.append("missing provider file: supabase/functions/_shared/providers/flutterwave.ts")
    else:
        provider_text = provider_file.read_text(encoding="utf-8")
        for token in ("FLW_STATIC_IP_REQUIRED", "FLW_STATIC_IP_READY", "FLW_WEBHOOK_SECRET"):
            if token not in provider_text:
                failures.append(f"provider guard missing token: {token}")
            else:
                print(f"[OK] provider includes {token}")

    if failures:
        print("flutterwave_env_contract_audit: FAIL")
        for item in failures:
            print(f" - {item}")
        return 1

    print("flutterwave_env_contract_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

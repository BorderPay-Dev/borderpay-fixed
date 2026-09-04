#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = (ROOT / "components/app/MainApp.tsx").read_text()

checks = {
    "native builds disable unapproved Bridge SCA UI":
        "const bridgeScaUiEnabled = !isNativeRuntime();" in MAIN,
    "SCA dialog is guarded by native-disabled flag":
        "open={bridgeScaUiEnabled && scaDialogOpen}" in MAIN,
    "maintenance restrictions include send":
        "'send-money', 'receive-money', 'ramps'" in MAIN,
    "maintenance restriction requires explicit server timestamp":
        "restricted: Boolean(subscription?.restricted_at)" in MAIN,
    "maintenance read outage fails open":
        "A network incident must not lock customers" in MAIN,
    "profile and support remain outside restricted screen set":
        "'profile'" not in MAIN.split("const SUBSCRIPTION_RESTRICTED_SCREENS", 1)[1].split("]);", 1)[0]
        and "'support'" not in MAIN.split("const SUBSCRIPTION_RESTRICTED_SCREENS", 1)[1].split("]);", 1)[0],
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'OK' if passed else 'FAIL'}] {name}")

if failed:
    raise SystemExit(f"native_store_sca_and_subscription_audit: FAIL ({len(failed)})")

print(f"native_store_sca_and_subscription_audit: PASS ({len(checks)}/{len(checks)})")

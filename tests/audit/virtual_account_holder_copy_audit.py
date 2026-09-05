#!/usr/bin/env python3
from pathlib import Path

source = (Path(__file__).resolve().parents[2] / "components/dashboard/bridge/WalletVisuals.tsx").read_text()

assert "Share these account details to receive {cur} payments by bank transfer." in source
assert "The account holder shown is" not in source
assert "our regulated provider" not in source

print("Virtual-account holder copy audit: PASS")

#!/usr/bin/env python3
from pathlib import Path

source = (Path(__file__).resolve().parents[2] / "supabase/functions/_shared/api-gateway.ts").read_text()
cf = source.find('req.headers.get("cf-connecting-ip")')
real = source.find('req.headers.get("x-real-ip")')
forwarded = source.find('req.headers.get("x-forwarded-for")')
checks = {
    "gateway IP headers are present": min(cf, real, forwarded) >= 0,
    "Cloudflare IP wins over forwarded input": cf < real < forwarded,
    "browser sandbox mode header is allowed": "x-borderpay-mode" in source.split("Access-Control-Allow-Headers", 1)[1].split("Access-Control-Allow-Methods", 1)[0],
}
failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items(): print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed: raise SystemExit(f"API gateway client-IP audit failed: {', '.join(failed)}")
print(f"API gateway client-IP audit passed ({len(checks)}/{len(checks)}).")

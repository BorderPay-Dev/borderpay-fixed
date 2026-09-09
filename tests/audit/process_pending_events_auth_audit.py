#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text()

required = {
    "dedicated worker secret": 'Deno.env.get("PROCESS_PENDING_EVENTS_WORKER_TOKEN")',
    "timing-safe comparison": "function timingSafeEqual(",
    "authorization guard": "if (!isAuthorizedWorkerRequest(req))",
    "fail-closed response": 'error: "unauthorized worker request"',
}

failures = [name for name, marker in required.items() if marker not in source]
guard = source.find("if (!isAuthorizedWorkerRequest(req))")
parse = source.find("await req.json()", guard)
drain = source.find("await drain(", guard)
if guard < 0 or parse < 0 or drain < 0 or not (guard < parse < drain):
    failures.append("authorization must precede request parsing and every drain path")

if failures:
    raise SystemExit("FAIL: " + "; ".join(failures))

print("PASS: process-pending-events requires timing-safe worker authentication before queue access")

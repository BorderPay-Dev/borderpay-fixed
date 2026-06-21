# Incident-Only SQL Tools

This directory contains emergency SQL tooling that can alter queue/webhook lifecycle behavior.

Policy (non-negotiable):
- Do NOT run these scripts during normal deploys, migrations, or routine maintenance.
- Do NOT include these scripts in any automated execution path.
- Use only under explicit incident approval with an action log and post-incident review.

Canonical lifecycle mutation boundary:
- Ingress lifecycle (`received`, `duplicate`, `rejected`, `queued`) may be mutated only by:
  - `public.ingest_bridge_event`
  - webhook receiver layer (`supabase/functions/bridge-webhook`)
- Internal queue lifecycle (`queued`, `processing`, `completed`, `failed`) may be mutated only by:
  - `public.claim_pending_events`
  - `public.complete_pending_event`
  - `public.fail_pending_event`

Any script in this directory that redefines lifecycle RPCs is incident-only by definition.

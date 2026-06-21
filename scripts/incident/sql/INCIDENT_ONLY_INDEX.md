# Incident Tool Index

## Queue / Webhook Lifecycle

1. `20260620_queue_state_consistency_hotfix.sql`
- Purpose: emergency runtime replacement of queue completion/failure RPCs.
- Risk: alters lifecycle transition behavior globally.
- Allowed usage: incident response only, explicitly approved.

2. `20260620_queue_lifecycle_decouple_from_bridge_ingress.sql`
- Purpose: emergency runtime decoupling of ingress and internal queue state mutation paths.
- Risk: alters lifecycle transition behavior globally.
- Allowed usage: incident response only, explicitly approved.

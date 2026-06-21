# Execution Safety Boundaries

## Safe Schema Layer
Location: `supabase/migrations/`

Purpose:
- Production-safe, reviewed schema evolution.
- Canonical database functions and constraints.

Rules:
- Must not include ad-hoc incident operations.
- Changes must be deterministic and migration-controlled.

## Operational Runtime Layer
Locations:
- `supabase/functions/bridge-webhook/`
- `supabase/functions/process-pending-events/`
- Canonical RPCs in Postgres (`ingest_bridge_event`, `claim_pending_events`, `complete_pending_event`, `fail_pending_event`)

Purpose:
- Live webhook ingestion, queue claiming, completion, retry/failure handling.

Rules:
- Ingress lifecycle state transitions are allowed only in webhook receiver + `ingest_bridge_event`.
- Internal queue lifecycle transitions are allowed only in:
  - `claim_pending_events`
  - `complete_pending_event`
  - `fail_pending_event`

## Incident-Only Recovery Layer
Location: `scripts/incident/`

Purpose:
- Emergency-only repair/recovery tools.

Rules:
- Never run in normal dev, CI, or deployment pipelines.
- Requires explicit incident approval and action logging.
- Any lifecycle-mutating SQL in this area is quarantined by design.

## CI/CD Enforcement
- Guard script: `scripts/ci/enforce-safety-boundaries.sh`
- CI workflow: `.github/workflows/safety-boundary.yml`

Build fails when:
- Incident SQL is referenced outside incident mode (`INCIDENT_MODE=true`).
- Lifecycle mutation SQL appears in forbidden locations.
- `scripts/sql/` contains lifecycle mutation logic.

# INCIDENT_MODE

`INCIDENT_MODE=true` is a narrowly scoped override for explicitly approved incident operations.

Default behavior:
- `INCIDENT_MODE` unset or not `true`.
- Any reference to `scripts/incident/` outside incident context fails boundary checks.

Usage requirements:
1. Explicit operational approval.
2. Action log entry before execution.
3. Post-incident review documenting why incident tools were required.

`INCIDENT_MODE=true` must never be enabled in routine CI/CD or standard developer workflows.

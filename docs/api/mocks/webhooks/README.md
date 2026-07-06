# Webhook Mock Fixtures

These fixtures are canonical sample payloads for partner sandbox integration and CI conformance checks.

Files:
- `transfer.completed.json`
- `transfer.failed.json`
- `customer.verification.updated.json`

Contract notes:
- `id`, `type`, `created_at`, and `data` are mandatory top-level fields.
- Signature verification uses raw JSON body bytes, not parsed/normalized objects.

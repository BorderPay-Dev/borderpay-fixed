# Runtime source reconciliation
The predeposit branch initially inherited an older public API gateway than production.
On 2026-09-20 the production ESZIP source maps were read through the Supabase Management API.
The current customer-session API runtime, published white-label onboarding origin, request size limits,
canonical idempotency hashing, successful-only replay persistence, provider environment binding,
and business-name payload fix were preserved before applying instruction redaction.
Source files from the active runtime are included in this branch so future deployment cannot silently roll them back.
Account-sync source matched the branch exactly. Other legacy endpoints require the same comparison before deployment.

# BorderPay API v1 Release + Versioning Policy

Effective date: 2026-07-06  
Scope: `docs/api/openapi-v1.yaml`, partner SDK starter, Postman pack, curl cookbook.

## 1) Versioning model

- Public API uses semantic versioning: `MAJOR.MINOR.PATCH`.
- `MAJOR`:
  - Breaking change (field removal/rename, error-code removal, required field changes, route behavior break).
- `MINOR`:
  - Backward-compatible additions (new optional fields, new routes, new error details).
- `PATCH`:
  - Non-breaking fixes (docs corrections, example fixes, deterministic response clarifications).

## 2) Contract source of truth

- Primary: `docs/api/openapi-v1.yaml`
- Supporting:
  - `docs/API_V1_ERROR_AND_IDEMPOTENCY_POLICY_2026-07-06.md`
  - `docs/api/postman/BorderPay_API_v1.postman_collection.json`
  - `docs/api/curl/API_V1_CURL_COOKBOOK.md`
  - `docs/api/sdk/typescript/*`

Any mismatch across these files is a release blocker.

## 3) Release checklist (required)

1. Update `openapi-v1.yaml` version.
2. Update `docs/api/CHANGELOG.md` with date and release notes.
3. Run contract CI gate (`api-contract-pack`).
4. Build SDK starter successfully.
5. Validate idempotency replay and mismatch behavior in sandbox.
6. Publish partner release note with migration notes.

## 4) Breaking change process

- Breaking change requires:
  - new MAJOR version path/contract,
  - migration window announcement,
  - dual-support period defined in release note.

No direct breaking change allowed inside existing v1 major line.

## 5) Error-code change rules

- Existing code cannot be repurposed.
- Adding a code is MINOR.
- Removing/renaming a code is MAJOR.

## 6) Idempotency rule lock

- Mutating endpoints MUST require `Idempotency-Key`.
- Reused key + different payload MUST remain `idempotency_replay_mismatch`.
- Reused key + same payload MUST replay deterministic response.

Changing these semantics is MAJOR.

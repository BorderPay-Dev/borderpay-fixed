# API Step 2H: Versioning + CI Contract Gates (2026-07-06)

This step hardens API release governance so partner contracts cannot drift silently.

## Delivered

1. Versioning policy
- `docs/API_V1_RELEASE_AND_VERSIONING_POLICY_2026-07-06.md`

2. API changelog baseline
- `docs/api/CHANGELOG.md`

3. Contract verification script (CI-safe)
- `scripts/ci/verify_api_contract_pack.py`

4. Dedicated CI workflow for contract pack
- `.github/workflows/api-contract-pack.yml`

## What the CI gate enforces

- OpenAPI file exists and is valid YAML shape.
- Required frozen paths are present.
- Error-code enum matches policy baseline.
- Postman collection JSON parses and has expected request set.
- Curl cookbook exists and includes core sections.
- SDK starter package compiles (`npm run build` in `docs/api/sdk/typescript`).

## Why this is required

Without this gate, docs and SDK can drift from live gateway behavior and break partner integrations.

## Next (2I)

- Add generated mock-server fixtures from OpenAPI examples.
- Add webhook signature conformance tests in CI.

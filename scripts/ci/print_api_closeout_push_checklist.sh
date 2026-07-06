#!/usr/bin/env bash
set -euo pipefail

# Step 2T helper: print a deterministic closeout/push checklist.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "=== BorderPay API Closeout Push Checklist ==="
echo
echo "1) Verify ship-readiness gates"
echo "   python3 scripts/ci/verify_api_contract_pack.py"
echo "   python3 scripts/ci/verify_api_mock_fixtures.py"
echo "   python3 scripts/ci/verify_api_ship_readiness.py"
echo
echo "2) Review closeout commit plan"
echo "   docs/api/onboarding/CLOSEOUT_COMMIT_PLAN.md"
echo
echo "3) Inspect working tree scope"
echo "   git status --short"
echo
echo "4) Stage and commit by pack (A->E)"
echo "   # Use plan in CLOSEOUT_COMMIT_PLAN.md"
echo
echo "5) Final pre-push gate"
echo "   python3 scripts/ci/verify_api_contract_pack.py && \\"
echo "   python3 scripts/ci/verify_api_mock_fixtures.py && \\"
echo "   python3 scripts/ci/verify_api_ship_readiness.py"
echo
echo "6) Push and open PR"
echo "   git push origin <branch>"
echo
echo "7) PR attachment checklist"
echo "   - RC gate report sample"
echo "   - Watchdog summary sample"
echo "   - Signoff rubric draft"

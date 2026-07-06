#!/usr/bin/env bash
set -euo pipefail

# Step 2O: tenant-by-tenant go-live drill runner with evidence capture.
#
# Required env:
#   SUPABASE_URL
#   SERVICE_ROLE_KEY
#   DRILL_MATRIX_JSON            path to tenant matrix json
#
# Optional env:
#   DRY_RUN                      true|false (default true)
#   EVIDENCE_DIR                 default /tmp/api_golive_evidence_<timestamp>
#   OPERATOR                     default unknown
#   CHANGE_REQUEST_ID            default n/a

if [[ -z "${SUPABASE_URL:-}" ]]; then
  echo "SUPABASE_URL is required" >&2
  exit 1
fi
if [[ -z "${SERVICE_ROLE_KEY:-}" ]]; then
  echo "SERVICE_ROLE_KEY is required" >&2
  exit 1
fi
if [[ -z "${DRILL_MATRIX_JSON:-}" ]]; then
  echo "DRILL_MATRIX_JSON is required" >&2
  exit 1
fi
if [[ ! -f "${DRILL_MATRIX_JSON}" ]]; then
  echo "DRILL_MATRIX_JSON not found: ${DRILL_MATRIX_JSON}" >&2
  exit 1
fi

DRY_RUN="${DRY_RUN:-true}"
OPERATOR="${OPERATOR:-unknown}"
CHANGE_REQUEST_ID="${CHANGE_REQUEST_ID:-n/a}"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/api_golive_evidence_${STAMP}}"

mkdir -p "$EVIDENCE_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 - "$DRILL_MATRIX_JSON" <<'PY' > /tmp/api_golive_matrix.tsv
import json, sys
path = sys.argv[1]
obj = json.load(open(path, "r", encoding="utf-8"))
rows = obj.get("tenants") or []
for r in rows:
    tenant_id = str(r.get("tenant_id","")).strip()
    if not tenant_id:
        continue
    fields = [
        tenant_id,
        str(r.get("tenant_name","")).strip(),
        str(r.get("gateway_api_key","")).strip(),
        "true" if bool(r.get("preflight_expect_forbidden", True)) else "false",
        "true" if bool(r.get("promote", False)) else "false",
        str(r.get("default_mode","production")).strip() or "production",
        "true" if bool(r.get("beta_access_enabled", True)) else "false",
        str(r.get("max_single_transfer_usd", 5000)).strip(),
        str(r.get("rate_limit_per_minute", 120)).strip(),
    ]
    print("\t".join(fields))
PY

if [[ ! -s /tmp/api_golive_matrix.tsv ]]; then
  echo "No tenants found in matrix." >&2
  exit 1
fi

echo "# API Go-Live Drill Summary" > "${EVIDENCE_DIR}/SUMMARY.md"
echo >> "${EVIDENCE_DIR}/SUMMARY.md"
echo "- timestamp_utc: ${STAMP}" >> "${EVIDENCE_DIR}/SUMMARY.md"
echo "- dry_run: ${DRY_RUN}" >> "${EVIDENCE_DIR}/SUMMARY.md"
echo "- operator: ${OPERATOR}" >> "${EVIDENCE_DIR}/SUMMARY.md"
echo "- change_request_id: ${CHANGE_REQUEST_ID}" >> "${EVIDENCE_DIR}/SUMMARY.md"
echo >> "${EVIDENCE_DIR}/SUMMARY.md"

ok=0
failed=0

while IFS=$'\t' read -r tenant_id tenant_name gateway_api_key preflight_expect_forbidden promote default_mode beta_access_enabled max_single_transfer_usd rate_limit_per_minute; do
  [[ -z "${tenant_id}" ]] && continue
  out_md="${EVIDENCE_DIR}/${tenant_id}.md"
  out_json="${EVIDENCE_DIR}/${tenant_id}.json"

  {
    echo "# Tenant Drill Evidence"
    echo
    echo "- tenant_id: ${tenant_id}"
    echo "- tenant_name: ${tenant_name}"
    echo "- operator: ${OPERATOR}"
    echo "- change_request_id: ${CHANGE_REQUEST_ID}"
    echo "- dry_run: ${DRY_RUN}"
    echo "- timestamp_utc: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo
  } > "${out_md}"

  status="ok"
  notes=""

  if [[ -n "${gateway_api_key}" ]]; then
    set +e
    preflight_out="$(
      SUPABASE_URL="${SUPABASE_URL}" \
      SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}" \
      API_KEY="${gateway_api_key}" \
      EXPECT_PROD_FORBIDDEN="${preflight_expect_forbidden}" \
      bash "${SCRIPT_DIR}/partner_onboarding_preflight.sh" 2>&1
    )"
    preflight_rc=$?
    set -e

    {
      echo "## Preflight"
      echo
      echo '```text'
      echo "${preflight_out}"
      echo '```'
      echo
    } >> "${out_md}"

    if [[ ${preflight_rc} -ne 0 ]]; then
      status="failed"
      notes="preflight_failed"
    fi
  else
    {
      echo "## Preflight"
      echo
      echo "_Skipped: no gateway_api_key in matrix._"
      echo
    } >> "${out_md}"
  fi

  if [[ "${promote}" == "true" ]]; then
    if [[ "${DRY_RUN}" == "true" ]]; then
      {
        echo "## Promotion"
        echo
        echo "_Dry run: promotion not executed._"
        echo
        echo "- requested_default_mode: ${default_mode}"
        echo "- requested_beta_access_enabled: ${beta_access_enabled}"
        echo "- requested_max_single_transfer_usd: ${max_single_transfer_usd}"
        echo "- requested_rate_limit_per_minute: ${rate_limit_per_minute}"
        echo
      } >> "${out_md}"
    else
      set +e
      promote_out="$(
        SUPABASE_URL="${SUPABASE_URL}" \
        SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}" \
        TENANT_ID="${tenant_id}" \
        TENANT_NAME="${tenant_name}" \
        DEFAULT_MODE="${default_mode}" \
        BETA_ACCESS_ENABLED="${beta_access_enabled}" \
        MAX_SINGLE_TRANSFER_USD="${max_single_transfer_usd}" \
        RATE_LIMIT_PER_MINUTE="${rate_limit_per_minute}" \
        GATEWAY_API_KEY="${gateway_api_key}" \
        PREFLIGHT_EXPECT_FORBIDDEN="${preflight_expect_forbidden}" \
        bash "${SCRIPT_DIR}/promote_tenant_closed_beta.sh" 2>&1
      )"
      promote_rc=$?
      set -e

      {
        echo "## Promotion"
        echo
        echo '```text'
        echo "${promote_out}"
        echo '```'
        echo
      } >> "${out_md}"

      if [[ ${promote_rc} -ne 0 ]]; then
        status="failed"
        notes="${notes:+${notes},}promotion_failed"
      fi
    fi
  else
    {
      echo "## Promotion"
      echo
      echo "_Skipped: promote=false in matrix._"
      echo
    } >> "${out_md}"
  fi

  cat > "${out_json}" <<JSON
{
  "tenant_id": "${tenant_id}",
  "tenant_name": "${tenant_name}",
  "status": "${status}",
  "notes": "${notes}",
  "dry_run": ${DRY_RUN},
  "operator": "${OPERATOR}",
  "change_request_id": "${CHANGE_REQUEST_ID}",
  "timestamp_utc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON

  echo "- ${tenant_id}: ${status}" >> "${EVIDENCE_DIR}/SUMMARY.md"
  if [[ "${status}" == "ok" ]]; then
    ok=$((ok + 1))
  else
    failed=$((failed + 1))
  fi
done < /tmp/api_golive_matrix.tsv

{
  echo
  echo "## Totals"
  echo
  echo "- ok: ${ok}"
  echo "- failed: ${failed}"
  echo "- evidence_dir: ${EVIDENCE_DIR}"
} >> "${EVIDENCE_DIR}/SUMMARY.md"

echo "Go-live drill completed. Evidence: ${EVIDENCE_DIR}"
if [[ ${failed} -gt 0 ]]; then
  exit 10
fi

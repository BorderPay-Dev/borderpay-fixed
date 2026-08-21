from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts/ci/rc1_business_certification_preflight.py"
SPEC = importlib.util.spec_from_file_location("rc1_business_certification_preflight", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load preflight module")
PREFLIGHT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREFLIGHT)


class BusinessCertificationPreflightTests(unittest.TestCase):
    def base_input(self) -> dict:
        sha = "a" * 40
        account_id = "business-certification-account"
        captured_at = "2026-08-16T10:00:00Z"
        return {
            "rc1_git_commit": sha,
            "build_id": "rc1-build-20260816-001",
            "build_artifact_sha256": "c" * 64,
            "deployment_attestation": {
                "attestation_id": "release-attestation-001",
                "environment": "production",
                "deployed_git_commit": sha,
                "deployed_build_id": "rc1-build-20260816-001",
                "deployed_build_artifact_sha256": "c" * 64,
                "attested_at": "2026-08-16T10:00:00Z",
                "attested_by": "release-controller",
            },
            "provenance": {
                "account_type": {"source": "public.user_profiles.account_type", "account_id": account_id, "captured_at": captured_at, "value": "business"},
                "created_via": {"source": "public.account_origin_provenance.origin_kind", "account_id": account_id, "captured_at": captured_at, "value": "direct"},
                "email_verified": {"source": "auth.users.email_confirmed_at", "account_id": account_id, "captured_at": captured_at, "value": True},
                "kyb_approved": {"source": "public.business_profiles.bridge_kyb_status", "account_id": account_id, "captured_at": captured_at, "value": "approved"},
                "bridge_customer_id": {"source": "public.user_profiles.bridge_customer_id", "account_id": account_id, "captured_at": captured_at, "value": "bridge-customer-id"},
                "is_operator_account": {"source": "public.operator_bridge_accounts.active", "account_id": account_id, "captured_at": captured_at, "value": False},
                "is_imported_account": {"source": "public.account_origin_provenance.origin_kind", "account_id": account_id, "captured_at": captured_at, "value": False},
            },
            "manual_intervention_audit": {
                "authority_status": "EXTERNAL_PROVIDER_AUDIT_EXPORT",
                "source": "supabase_postgres_pgaudit_export",
                "project_ref": "orwrcpwsffjlvzuraxjc",
                "pgaudit_configuration": {
                    "pgaudit.log": "write, ddl, role",
                    "pgaudit.log_parameter": "on",
                    "pgaudit.log_relation": "on",
                    "shared_preload_libraries": "pg_stat_statements,pgaudit,plpgsql",
                    "captured_at": captured_at,
                },
            },
            "operation_authorizations": {},
        }

    def test_dirty_candidate_blocks_immutable_identity(self) -> None:
        failures = PREFLIGHT.validate_preflight(
            self.base_input(), surface="dashboard", repository_sha="a" * 40, dirty_paths=[" M app.ts"],
        )
        self.assertTrue(any("not immutable" in failure for failure in failures))

    def test_deployment_sha_and_build_must_match(self) -> None:
        data = self.base_input()
        data["deployment_attestation"]["deployed_git_commit"] = "b" * 40
        data["deployment_attestation"]["deployed_build_id"] = "different"
        failures = PREFLIGHT.validate_preflight(
            data, surface="dashboard", repository_sha="a" * 40, dirty_paths=[],
        )
        self.assertTrue(any("deployed_git_commit" in failure for failure in failures))
        self.assertTrue(any("deployed_build_id" in failure for failure in failures))

    def test_configured_manual_intervention_source_passes_preflight(self) -> None:
        failures = PREFLIGHT.validate_preflight(
            self.base_input(), surface="dashboard", repository_sha="a" * 40, dirty_paths=[],
        )
        self.assertEqual(failures, [])

    def test_missing_manual_intervention_source_fails_closed(self) -> None:
        data = self.base_input()
        data.pop("manual_intervention_audit")
        failures = PREFLIGHT.validate_preflight(
            data, surface="dashboard", repository_sha="a" * 40, dirty_paths=[],
        )
        self.assertTrue(any("manual_intervention_audit configuration is required" in failure for failure in failures))

    def test_manual_audit_requires_parameter_and_relation_logging(self) -> None:
        data = self.base_input()
        data["manual_intervention_audit"]["pgaudit_configuration"]["pgaudit.log_parameter"] = "off"
        data["manual_intervention_audit"]["pgaudit_configuration"]["pgaudit.log_relation"] = "off"
        failures = PREFLIGHT.validate_preflight(
            data, surface="dashboard", repository_sha="a" * 40, dirty_paths=[],
        )
        self.assertTrue(any("pgaudit.log_parameter must be on" in failure for failure in failures))
        self.assertTrue(any("pgaudit.log_relation must be on" in failure for failure in failures))

    def test_each_state_changing_surface_requires_its_own_approval(self) -> None:
        for surface in sorted(PREFLIGHT.APPROVAL_SURFACES):
            with self.subTest(surface=surface):
                failures = PREFLIGHT.validate_preflight(
                    self.base_input(), surface=surface, repository_sha="a" * 40, dirty_paths=[],
                )
                self.assertTrue(any(f"explicit authorization missing for {surface}" in failure for failure in failures))

    def test_placeholder_identity_is_rejected(self) -> None:
        data = self.base_input()
        data["build_id"] = "sample-build"
        failures = PREFLIGHT.validate_preflight(
            data, surface="dashboard", repository_sha="a" * 40, dirty_paths=[],
        )
        self.assertTrue(any("build_id" in failure for failure in failures))

    def test_build_digest_correspondence_is_required(self) -> None:
        data = self.base_input()
        data["deployment_attestation"]["deployed_build_artifact_sha256"] = "d" * 64
        failures = PREFLIGHT.validate_preflight(
            data, surface="dashboard", repository_sha="a" * 40, dirty_paths=[],
        )
        self.assertTrue(any("deployed_build_artifact_sha256" in failure for failure in failures))


if __name__ == "__main__":
    unittest.main()

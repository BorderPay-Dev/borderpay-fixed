#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


AUDIT_PATH = Path(__file__).with_name("rc1_freeze_rule_audit.py")
SPEC = importlib.util.spec_from_file_location("rc1_freeze_rule_audit", AUDIT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load audit module from {AUDIT_PATH}")
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def workflow_with_guard(*, guard_after_upload: bool = False, include_guard: bool = True) -> str:
    guard = (
        "- name: Require RC1 production approval\n"
        "  run: python3 scripts/ci/compute_rc1_status.py --require-pass\n"
    )
    before = "uses: actions/checkout@v4\n"
    boundaries = (
        "- name: Install App Store Connect API key\n"
        "- name: Create export options\n"
        "- name: Archive iOS app\n"
        "- name: Export signed IPA\n"
        "- name: Upload to TestFlight\n"
    )
    if not include_guard:
        return before + boundaries
    if guard_after_upload:
        return before + boundaries + guard
    return before + guard + boundaries


EXACT_GUARD_DIFF = """diff --git a/.github/workflows/ios-testflight.yml b/.github/workflows/ios-testflight.yml
--- a/.github/workflows/ios-testflight.yml
+++ b/.github/workflows/ios-testflight.yml
@@ -48,0 +49,3 @@
+      - name: Require RC1 production approval
+        run: python3 scripts/ci/compute_rc1_status.py --require-pass
+
"""


class RC1FreezeRuleAuditTests(unittest.TestCase):
    def test_authoritative_remote_baseline_does_not_fall_through_to_stale_local_main(self) -> None:
        responses = {
            "git rev-parse --verify origin/main": (0, "origin-main", ""),
            "git merge-base HEAD origin/main": (0, "same-head", ""),
            "git diff --name-only same-head...HEAD": (0, "", ""),
            "git status --porcelain": (0, "", ""),
        }
        original_run = AUDIT.run
        AUDIT.run = lambda command: responses.get(command, (1, "", "unexpected command"))
        try:
            self.assertEqual(AUDIT.changed_file_diffs(), {})
        finally:
            AUDIT.run = original_run

    def test_exact_correctly_ordered_rc1_guard_is_permitted(self) -> None:
        allowed, detail = AUDIT.ios_testflight_guard_only_change(
            EXACT_GUARD_DIFF,
            workflow_with_guard(),
        )
        self.assertTrue(allowed, detail)

    def test_exact_android_guard_is_permitted_before_signing_and_upload(self) -> None:
        workflow = (
            "uses: actions/checkout@v4\n"
            "- name: Require RC1 production approval\n"
            "  run: python3 scripts/ci/compute_rc1_status.py --require-pass\n"
            "- name: Install Android upload keystore\n"
            "- name: Build signed Android App Bundle\n"
            "- name: Upload to Google Play internal testing\n"
        )
        allowed, detail = AUDIT.android_play_guard_only_change(EXACT_GUARD_DIFF, workflow)
        self.assertTrue(allowed, detail)

    def test_unrelated_ios_testflight_change_is_rejected(self) -> None:
        unrelated_diff = EXACT_GUARD_DIFF + "@@ -9 +12 @@\n-        default: \"34\"\n+        default: \"37\"\n"
        allowed, _ = AUDIT.ios_testflight_guard_only_change(
            unrelated_diff,
            workflow_with_guard(),
        )
        self.assertFalse(allowed)

    def test_unrelated_xcode_project_change_is_rejected(self) -> None:
        blocked, _ = AUDIT.blocked_change(
            "ios/App/App.xcodeproj/project.pbxproj",
            "- CURRENT_PROJECT_VERSION = 34;\n+ CURRENT_PROJECT_VERSION = 37;",
        )
        self.assertTrue(blocked)

    def test_missing_or_misordered_rc1_guard_is_rejected(self) -> None:
        missing, _ = AUDIT.ios_testflight_guard_only_change(
            EXACT_GUARD_DIFF,
            workflow_with_guard(include_guard=False),
        )
        misordered, _ = AUDIT.ios_testflight_guard_only_change(
            EXACT_GUARD_DIFF,
            workflow_with_guard(guard_after_upload=True),
        )
        self.assertFalse(missing)
        self.assertFalse(misordered)

    def test_valid_guard_does_not_mask_existing_freeze_violations(self) -> None:
        guard_plus_version_change = (
            EXACT_GUARD_DIFF
            + "@@ -100 +103 @@\n"
            + "-          if [ \"$BUILD_NUMBER\" -le 33 ]; then\n"
            + "+          if [ \"$BUILD_NUMBER\" -le 36 ]; then\n"
        )
        allowed, _ = AUDIT.ios_testflight_guard_only_change(
            guard_plus_version_change,
            workflow_with_guard(),
        )
        self.assertFalse(allowed)


if __name__ == "__main__":
    unittest.main()

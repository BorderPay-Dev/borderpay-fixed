#!/usr/bin/env python3
"""
RC1 freeze rule audit (deployment-blocking).

If RC1 business certification is incomplete, block parallel implementation work on:
- FX
- Payroll
- Affiliate financial lifecycle
- Mobile release tracks

The freeze is enforced by scanning changed files in the current branch/working tree.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RC1_GATE = ROOT / "tests" / "audit" / "rc1_business_certification_gate_audit.py"

BLOCKED_PREFIXES = (
    "utils/fx/",
    "components/exchange/",
    "components/business/Payroll",
    "components/business/BulkPayout",
    "components/referral/",
    "utils/affiliate/",
    "android/",
    "ios/",
)
BLOCKED_EXACT = {
    "capacitor.config.ts",
    "AFFILIATE_CAPABILITY_MATRIX.md",
}
BLOCKED_DOC_TOKENS = (
    "APPSTORE",
    "PLAYSTORE",
    "AFFILIATE",
    "PAYROLL",
    "FX_",
)
MOBILE_WORKFLOW_TOKENS = ("testflight", "play store", "google play", "app store", "fastlane", "pilot")
IOS_TESTFLIGHT_WORKFLOW = ".github/workflows/ios-testflight.yml"
ANDROID_PLAY_WORKFLOW = ".github/workflows/android-play.yml"
RC1_GUARD_NAME = "- name: Require RC1 production approval"
RC1_GUARD_COMMAND = "run: python3 scripts/ci/compute_rc1_status.py --require-pass"
IOS_RELEASE_BOUNDARIES = (
    "- name: Install App Store Connect API key",
    "- name: Create export options",
    "- name: Archive iOS app",
    "- name: Export signed IPA",
    "- name: Upload to TestFlight",
)
ANDROID_RELEASE_BOUNDARIES = (
    "- name: Install Android upload keystore",
    "- name: Build signed Android App Bundle",
    "- name: Upload to Google Play internal testing",
)
ALLOWED_WHEN_FROZEN_PREFIXES = (
    "tests/audit/",
    "artifacts/business-certification/",
    "docs/PREDEPLOY_GATE_REPORT_",
    "RC1_BUSINESS_CERTIFICATION_REPORT.md",
)


def run(cmd: str) -> tuple[int, str, str]:
    p = subprocess.run(["/bin/zsh", "-lc", f"cd {ROOT} && {cmd}"], text=True, capture_output=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def certification_complete() -> bool:
    rc, _, _ = run(f"python3 {RC1_GATE}")
    return rc == 0


def potentially_frozen_path(path: str) -> bool:
    if any(path.startswith(prefix) for prefix in ALLOWED_WHEN_FROZEN_PREFIXES):
        return False
    return (
        path in BLOCKED_EXACT
        or any(path.startswith(prefix) for prefix in BLOCKED_PREFIXES)
        or (path.startswith("docs/") and any(tok in Path(path).name.upper() for tok in BLOCKED_DOC_TOKENS))
        or path.startswith(".github/workflows/")
    )


def changed_file_diffs() -> dict[str, str]:
    for ref in ("origin/main", "main", "origin/master", "master"):
        rc, _, _ = run(f"git rev-parse --verify {ref}")
        if rc != 0:
            continue
        rc, base, _ = run(f"git merge-base HEAD {ref}")
        if rc != 0 or not base:
            continue
        rc, out, _ = run(f"git diff --name-only {base}...HEAD")
        if rc == 0:
            files = [ln.strip() for ln in out.splitlines() if ln.strip()]
            if files:
                diffs: dict[str, str] = {}
                for path in files:
                    if not potentially_frozen_path(path):
                        continue
                    diff_rc, diff_text, _ = run(
                        f"git diff --no-ext-diff --unified=0 {base}...HEAD -- {path}"
                    )
                    if diff_rc == 0:
                        diffs[path] = diff_text
                return diffs

    rc, out, _ = run("git status --porcelain")
    if rc != 0:
        return {}
    diffs: dict[str, str] = {}
    for line in out.splitlines():
        if not line.strip():
            continue
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1].strip()
        if path:
            if not potentially_frozen_path(path):
                continue
            diff_rc, diff_text, _ = run(
                f"git diff --no-ext-diff --unified=0 HEAD -- {path}"
            )
            if diff_rc == 0 and diff_text:
                diffs[path] = diff_text
            else:
                current = ROOT / path
                if current.is_file():
                    added = "\n".join(f"+{value}" for value in current.read_text(encoding="utf-8").splitlines())
                    diffs[path] = f"--- /dev/null\n+++ b/{path}\n{added}"
    return diffs


def diff_content_lines(diff_text: str) -> tuple[list[str], list[str]]:
    additions: list[str] = []
    removals: list[str] = []
    for line in diff_text.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            value = line[1:].strip()
            if value:
                additions.append(value)
        elif line.startswith("-"):
            value = line[1:].strip()
            if value:
                removals.append(value)
    return additions, removals


def ios_testflight_guard_only_change(
    diff_text: str,
    workflow_text: str,
) -> tuple[bool, str]:
    additions, removals = diff_content_lines(diff_text)
    expected_additions = [RC1_GUARD_NAME, RC1_GUARD_COMMAND]
    if removals or additions != expected_additions:
        return False, "iOS TestFlight diff contains changes beyond the exact RC1 guard"

    guard_at = workflow_text.find(RC1_GUARD_COMMAND)
    checkout_at = workflow_text.find("uses: actions/checkout@")
    if workflow_text.count(RC1_GUARD_COMMAND) != 1 or guard_at < 0:
        return False, "exact RC1 guard must occur once"
    if checkout_at < 0 or checkout_at > guard_at:
        return False, "RC1 guard must run after checkout"

    missing_boundaries = [boundary for boundary in IOS_RELEASE_BOUNDARIES if boundary not in workflow_text]
    if missing_boundaries:
        return False, f"expected iOS release boundaries missing: {missing_boundaries}"
    if any(guard_at >= workflow_text.find(boundary) for boundary in IOS_RELEASE_BOUNDARIES):
        return False, "RC1 guard must precede key installation, signing, export, and upload"
    return True, "exact RC1 guard-only change is correctly ordered"


def android_play_guard_only_change(diff_text: str, workflow_text: str) -> tuple[bool, str]:
    additions, removals = diff_content_lines(diff_text)
    if removals or additions != [RC1_GUARD_NAME, RC1_GUARD_COMMAND]:
        return False, "Android Play diff contains changes beyond the exact RC1 guard"
    guard_at = workflow_text.find(RC1_GUARD_COMMAND)
    checkout_at = workflow_text.find("uses: actions/checkout@")
    if workflow_text.count(RC1_GUARD_COMMAND) != 1 or guard_at < 0:
        return False, "exact RC1 guard must occur once"
    if checkout_at < 0 or checkout_at > guard_at:
        return False, "RC1 guard must run after checkout"
    if any(boundary not in workflow_text for boundary in ANDROID_RELEASE_BOUNDARIES):
        return False, "expected Android release boundaries are missing"
    if any(guard_at >= workflow_text.find(boundary) for boundary in ANDROID_RELEASE_BOUNDARIES):
        return False, "RC1 guard must precede Android signing and Play upload"
    return True, "exact RC1 guard-only change is correctly ordered"


def blocked_change(path: str, diff_text: str) -> tuple[bool, str]:
    if path in BLOCKED_EXACT:
        return True, "blocked release-sensitive file changed"
    if any(path.startswith(prefix) for prefix in ALLOWED_WHEN_FROZEN_PREFIXES):
        return False, "allowed evidence/audit path"
    if path == IOS_TESTFLIGHT_WORKFLOW:
        workflow = ROOT / path
        workflow_text = workflow.read_text(encoding="utf-8") if workflow.is_file() else ""
        allowed, detail = ios_testflight_guard_only_change(diff_text, workflow_text)
        return not allowed, detail
    if path == ANDROID_PLAY_WORKFLOW:
        workflow = ROOT / path
        workflow_text = workflow.read_text(encoding="utf-8") if workflow.is_file() else ""
        allowed, detail = android_play_guard_only_change(diff_text, workflow_text)
        return not allowed, detail
    if any(path.startswith(prefix) for prefix in BLOCKED_PREFIXES):
        return True, "blocked mobile/runtime domain changed"
    if path.startswith("docs/") and any(tok in Path(path).name.upper() for tok in BLOCKED_DOC_TOKENS):
        return True, "blocked RC1 domain documentation changed"
    if path.startswith(".github/workflows/"):
        wf = ROOT / path
        txt = wf.read_text(encoding="utf-8").lower() if wf.is_file() else diff_text.lower()
        if any(tok in txt for tok in MOBILE_WORKFLOW_TOKENS):
            return True, "mobile distribution workflow changed"
    return False, "outside frozen domains"


def main() -> int:
    if certification_complete():
        print("[OK] RC1 certification complete; freeze rule inactive")
        print("\nrc1_freeze_rule_audit: PASS")
        return 0

    changes = changed_file_diffs()
    offenders: list[tuple[str, str]] = []
    for path, diff_text in changes.items():
        blocked, detail = blocked_change(path, diff_text)
        if blocked:
            offenders.append((path, detail))
    offenders.sort()

    if offenders:
        print("[FAIL] RC1 certification incomplete: blocked domains changed")
        for path, detail in offenders[:120]:
            print(f"  - {path}: {detail}")
        print("\nrc1_freeze_rule_audit: FAIL")
        return 1

    print("[OK] RC1 certification incomplete; no blocked FX/Payroll/Affiliate/Mobile changes detected")
    print("\nrc1_freeze_rule_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

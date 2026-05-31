#!/usr/bin/env python3
"""
webauthn_enroll_selfheal_audit — prove BiometricManager.enroll() self-heals an
orphaned server credential exactly once on InvalidStateError.

Background
----------
A disable that cleared only local state (stale PWA bundle) left an orphan
webauthn_credentials row. register-options rebuilds excludeCredentials from that
table, so the platform authenticator refused a re-enroll with InvalidStateError
and the user was stuck (UI showed "disabled", offering only Enable). The fix:
on InvalidStateError, delete the server credential via the user-authenticated
endpoint, fetch FRESH options, and retry create() a single time.

Invariants (fail closed):
  H1 enroll() InvalidStateError branch calls backendAPI.webauthn.disable().
  H2 after the delete, register options are fetched again (runCreate re-run),
     so excludeCredentials is rebuilt empty before the retry.
  H3 the retry happens AT MOST once — no loop (while/for) around create(), and
     exactly two `await runCreate()` call sites (initial + single retry).
  H4 the retry is gated on delete success (return early when delete fails).
  H5 self-heal triggers ONLY for InvalidStateError (the disable() call lives
     inside that branch, not on every failure).
  H6 (regression) BiometricManager.disable() still clears the local hint only
     AFTER a successful server delete (no local-only clear path reintroduced).

Run: python3 tests/audit/webauthn_enroll_selfheal_audit.py
Exit 0 = pass, 1 = fail.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MGR = os.path.join(ROOT, "utils", "security", "SecurityManager.ts")
SW = os.path.join(ROOT, "public", "service-worker.js")


def read(p):
    return open(p, encoding="utf-8").read() if os.path.exists(p) else ""


def slice_between(src, start_pat, end_pat):
    s = re.search(start_pat, src)
    if not s:
        return ""
    rest = src[s.start():]
    e = re.search(end_pat, rest[1:])
    return rest[: e.start() + 1] if e else rest


def strip_comments(src: str) -> str:
    # Drop /* */ and // comments so loop/keyword checks test CODE, not prose
    # (e.g. the word "for" in "a credential for this RP+user").
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)//.*$", "", src)
    return src


def main() -> int:
    mgr = read(MGR)
    sw = read(SW)

    # enroll() body: from its signature to the next method (disable()).
    enroll = slice_between(mgr, r"async enroll\(", r"\n  async disable\(")
    enroll_code = strip_comments(enroll)

    # BiometricManager.disable() — NOT TOTPManager.disable(). SecurityManager
    # has several disable() methods; isolate the biometric one by its unique
    # signature (touches webauthn.disable / the biometric localStorage hint).
    disable = ""
    for m in re.finditer(r"async disable\([^)]*\)\s*:\s*Promise<[^>]*>\s*\{(.*?)\n  \},", mgr, re.S):
        body = m.group(1)
        if "backendAPI.webauthn.disable" in body or "borderpay_biometric_enrolled" in body:
            disable = body
            break

    # InvalidStateError branch inside enroll().
    ise = slice_between(enroll, r"InvalidStateError'\)\s*\{", r"\n        \} else \{")

    create_calls = len(re.findall(r"await runCreate\(\)", enroll))

    checks = [
        ("H1 enroll InvalidStateError branch calls backendAPI.webauthn.disable()",
         "InvalidStateError" in enroll and "backendAPI.webauthn.disable" in ise,
         "expected the disable() API call inside the InvalidStateError branch"),

        ("H2 fresh register options fetched again after delete (runCreate re-run)",
         "registerOptions" in enroll
         and re.search(r"const runCreate\s*=", enroll) is not None
         and "await runCreate()" in ise,
         "expected a second runCreate() (which calls registerOptions) after delete"),

        ("H3 retry happens at most once (no loop; exactly 2 runCreate call sites)",
         create_calls == 2
         and not re.search(r"\b(while|for)\b", enroll_code),
         f"expected exactly 2 'await runCreate()' and no loop; found {create_calls}"),

        ("H4 retry gated on delete success (early return when delete fails)",
         bool(re.search(r"if\s*\(!delRes\?\.success\)\s*\{[^}]*return", ise)),
         "expected `if (!delRes?.success) return ...` before the retry"),

        ("H5 self-heal triggers only on InvalidStateError",
         enroll.count("backendAPI.webauthn.disable") == 1
         and "backendAPI.webauthn.disable" in ise,
         "disable() must be called only inside the InvalidStateError branch"),

        ("H6 disable() clears local hint only after server success",
         "backendAPI.webauthn.disable" in disable
         and bool(re.search(r"if\s*\(!r\?\.success\)\s*\{[^}]*return", disable))
         and disable.index("backendAPI.webauthn.disable") < disable.index("removeItem"),
         "BiometricManager.disable must return on !success before removeItem"),

        ("H7 service-worker cache bumped to v2.5.0",
         "borderpay-app-v2.5.0" in sw and "borderpay-app-runtime-v2.5.0" in sw,
         "expected CACHE_NAME/RUNTIME_CACHE at v2.5.0"),
    ]

    print("webauthn_enroll_selfheal_audit:")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK' if passed else 'XX'}] {name}" + ("" if passed else f"  -> {detail}"))
        ok = ok and passed
    print(("PASS" if ok else "FAIL") + f" ({sum(1 for c in checks if c[1])}/{len(checks)} invariants)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

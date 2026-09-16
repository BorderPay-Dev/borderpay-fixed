#!/usr/bin/env python3
"""Reject an exported store IPA that cannot perform production App Attest."""
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import zipfile

ipa_dir = Path(sys.argv[1])
ipas = list(ipa_dir.glob('*.ipa'))
if len(ipas) != 1:
    raise SystemExit('Expected exactly one exported IPA')
with tempfile.TemporaryDirectory() as temporary:
    with zipfile.ZipFile(ipas[0]) as archive:
        archive.extractall(temporary)
    apps = list((Path(temporary) / 'Payload').glob('*.app'))
    if len(apps) != 1:
        raise SystemExit('Expected exactly one signed application')
    result = subprocess.run(
        ['codesign', '-d', '--entitlements', ':-', str(apps[0])],
        check=True, capture_output=True,
    )
    entitlements = plistlib.loads(result.stdout)
    if entitlements.get('com.apple.developer.devicecheck.appattest-environment') != 'production':
        raise SystemExit('Exported IPA is missing the production App Attest entitlement')
    if entitlements.get('get-task-allow') is True:
        raise SystemExit('Store IPA must not allow debugging')
    if entitlements.get('aps-environment') != 'production':
        raise SystemExit('Exported IPA is missing the production push entitlement')
    if 'applinks:app.borderpayafrica.com' not in entitlements.get('com.apple.developer.associated-domains', []):
        raise SystemExit('Exported IPA is missing the verification return-link entitlement')
print('Signed IPA: production App Attest, push and return-link entitlements verified')

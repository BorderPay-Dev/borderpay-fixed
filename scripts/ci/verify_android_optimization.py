#!/usr/bin/env python3
"""Verify R8 ran and preserved Capacitor's reflectively loaded plugin names."""
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile

bundle = Path(sys.argv[1])
with ZipFile(bundle) as archive:
    mapping = archive.read(
        'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map'
    ).decode()
    classes = dict(re.findall(r'^([^ #\s].*?) -> (.+):$', mapping, re.MULTILINE))
    renamed = sum(source != target for source, target in classes.items())
    if renamed == 0:
        raise SystemExit('Release bundle contains no obfuscated classes')
    plugins = json.loads(archive.read('base/assets/capacitor.plugins.json'))
    dex = b''.join(archive.read(name) for name in archive.namelist() if name.endswith('.dex'))
    for plugin in plugins:
        name = plugin['classpath']
        if classes.get(name) != name:
            raise SystemExit(f'Reflectively loaded plugin was removed or renamed: {name}')
        descriptor = ('L' + name.replace('.', '/') + ';').encode()
        if descriptor not in dex:
            raise SystemExit(f'Plugin missing from compiled DEX: {name}')
    print(f'R8 mapping embedded; {renamed}/{len(classes)} mapped classes renamed; '
          f'{len(plugins)} Capacitor plugin entry points preserved.')
    print('This mapping count is not the Google Play optimization percentage.')

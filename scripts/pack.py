#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import shutil
root = Path(__file__).resolve().parents[1]
uuid = json.loads((root / 'metadata.json').read_text())['uuid']
output = root / 'dist' / f'{uuid}.shell-extension.zip'
# Explicit runtime allowlist: development scripts and stray files cannot leak
# into a GNOME Extensions submission when new files are added to the checkout.
files = [root / name for name in [
    'extension.js', 'prefs.js', 'capture.js', 'restore.js', 'model.js',
    'store.js', 'projects.js', 'saveReview.js', 'settings.js', 'login.js',
    'shutdownPrompt.js', 'metadata.json', 'LICENSE',
    'schemas/gschemas.compiled',
    'schemas/org.gnome.shell.extensions.session-atlas.gschema.xml',
    'schemas/org.gnome.shell.extensions.windowkeep.gschema.xml',
    'icons/windowkeep-symbolic.svg', 'scripts/windowkeep',
]]
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(files):
        if path == root / 'scripts/windowkeep':
            info = ZipInfo.from_file(path, str(path.relative_to(root)))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, path.read_text().replace('@GJS@', shutil.which('gjs') or '/usr/bin/gjs', 1))
        else:
            archive.write(path, path.relative_to(root))
print(output)

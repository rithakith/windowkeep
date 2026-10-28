#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Dependency-free baseline lint; syntax, metadata and whitespace."""
from pathlib import Path
import json
import subprocess
files = list(Path('.').glob('*.js')) + list(Path('tests').glob('*.js'))
for path in files:
    subprocess.run(['node', '--check', str(path)], check=True)
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if line.rstrip() != line:
            raise SystemExit(f'{path}:{number}: trailing whitespace')
metadata = json.loads(Path('metadata.json').read_text())
assert metadata['uuid'] == 'windowkeep@rithakith.github.io'
assert metadata['shell-version'] == ['50']
print('Syntax, metadata and whitespace checks passed')

#!/usr/bin/env python3
"""Make the ZIP to upload to the Chrome Web Store: dist/plamo3-translate-local-<version>.zip.

The ZIP holds the files of extension/ with manifest.json at its root. The manifest goes in without its "key":
the store refuses a manifest with a key and gives the item an ID of its own. The unpacked extension/ keeps the
key, so a development install keeps its fixed ID.
Entries are sorted and carry a fixed time, so the same files give the same ZIP.
usage: python tools/pack-store.py
"""
import hashlib
import io
import json
import os
import re
import sys
import zipfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
EXT = os.path.join(ROOT, 'extension')
DIST = os.path.join(ROOT, 'dist')
STAMP = (2026, 1, 1, 0, 0, 0)
SKIP_NAMES = {'Thumbs.db', 'desktop.ini'}
# what must not reach the store: local paths and tokens (/home/web_user is Emscripten's virtual file system;
# the token prefixes are spelled with a character class so this file does not carry them)
LEAKS = [rb'[A-Za-z]:[\\/]+Users[\\/]', rb'(?<![A-Za-z0-9])/[a-z]/Users/', rb'/home/(?!web_user\b)[a-z]', rb'gh[p]_[A-Za-z0-9]{20}', rb'github[_]pat_']


def files():
    for d, dirs, names in os.walk(EXT):
        dirs[:] = sorted(x for x in dirs if not x.startswith('.'))
        for n in sorted(names):
            if n.startswith('.') or n in SKIP_NAMES or n.endswith('.map'):
                continue
            p = os.path.join(d, n)
            yield os.path.relpath(p, EXT).replace(os.sep, '/'), p


def store_manifest():
    with open(os.path.join(EXT, 'manifest.json'), encoding='utf-8') as f:
        m = json.load(f)
    m.pop('key', None)
    return m, (json.dumps(m, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def referenced(m):
    """Files the manifest names, so a missing one fails here instead of in the store's checks."""
    out = set(m.get('icons', {}).values()) | set(m.get('action', {}).get('default_icon', {}).values())
    out.add(m['background']['service_worker'])
    out.add(m['action']['default_popup'])
    out.add(m['options_ui']['page'])
    return out


def main():
    m, manifest = store_manifest()
    names = {}
    for rel, p in files():
        with open(p, 'rb') as f:
            names[rel] = manifest if rel == 'manifest.json' else f.read()
    missing = sorted(referenced(m) - set(names))
    if missing:
        sys.exit('missing files named in the manifest: ' + ', '.join(missing))
    if len(m['description']) > 132:
        sys.exit('the manifest description is over 132 characters')
    hits = [(rel, pat.decode()) for rel, data in names.items() for pat in LEAKS if re.search(pat, data)]
    if hits:
        sys.exit('found text that must not ship:\n' + '\n'.join(f'  {rel}: {pat}' for rel, pat in hits))

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in sorted(names):
            info = zipfile.ZipInfo(rel, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, names[rel])
    data = buf.getvalue()
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f"plamo3-translate-local-{m['version']}.zip")
    with open(out, 'wb') as f:
        f.write(data)
    print(f"{os.path.relpath(out, ROOT)}: {len(names)} files, {len(data) / 1e6:.2f} MB, version {m['version']}, no key")
    print('sha256', hashlib.sha256(data).hexdigest())


if __name__ == '__main__':
    main()

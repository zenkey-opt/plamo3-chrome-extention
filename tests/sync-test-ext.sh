#!/usr/bin/env bash
# Copy an extension dir into the test copy (.work/ext-test), add <all_urls> so CDP-driven tests can inject
# without a user gesture (activeTab), and reload it in the test browser if it is running.
# usage: bash tests/sync-test-ext.sh [extension-dir relative to the project root]   (default: extension)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/${1:-extension}"
S=$ROOT/.work/ext-test
rm -rf "$S" && mkdir -p "$S" && cp -r "$SRC"/. "$S"/
# dev-only pages (engine benchmark in a tab) run with the extension origin, so they ride along in the test copy
mkdir -p "$S/devtest" && cp "$ROOT"/tests/devtest/* "$S/devtest/"
python - "$(cygpath -m "$S/manifest.json")" <<'EOF'
import json, sys
p = sys.argv[1]
m = json.load(open(p, encoding="utf-8"))
m["host_permissions"] = m.get("host_permissions", []) + ["<all_urls>"]
json.dump(m, open(p, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)
EOF
echo "synced $SRC -> $S"
cd "$ROOT/tests"
if node cdp.mjs targets >/dev/null 2>&1; then
  node cdp.mjs targets | grep -q 'chrome://extensions' || { node cdp.mjs open "chrome://extensions/" >/dev/null; sleep 1.5; }
  # without developer mode a reload disables a --load-extension extension (unsupportedDeveloperExtension),
  # and a fresh profile starts with it off
  node cdp.mjs page "chrome://extensions" "new Promise(r => chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true}, () => chrome.developerPrivate.reload('bhkpaambekhpdikhkccbfdappiogpgnc', {failQuietly: true}, () => chrome.management.setEnabled('bhkpaambekhpdikhkccbfdappiogpgnc', true, () => r('reloaded')))))"
  sleep 1.5
fi

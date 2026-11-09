#!/usr/bin/env bash
# Put a local wasm build (tools/build-wllama.sh output) into the test copy and reload it in the test browser.
# usage: bash tests/use-build.sh [build dir under .work/wsrc, default build]   (e.g. build-prof)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="${1:-build}"
bash "$ROOT/tests/sync-test-ext.sh" extension >/dev/null
cd "$ROOT"
EXT_DIR=.work/ext-test node tools/vendor-wllama.mjs --wasm-dir ".work/wsrc/$B" --reuse-index | grep -E '"(builtAt|cmakeArgs)"'
cd "$ROOT/tests"
node cdp.mjs targets | grep -q 'chrome://extensions' || { node cdp.mjs open "chrome://extensions/" >/dev/null; sleep 1.5; }
node cdp.mjs page "chrome://extensions" "new Promise(r => chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true}, () => chrome.developerPrivate.reload('bhkpaambekhpdikhkccbfdappiogpgnc', {failQuietly: true}, () => chrome.management.setEnabled('bhkpaambekhpdikhkccbfdappiogpgnc', true, () => r('reloaded')))))"
sleep 1.5
# extension pages close on reload; one keeps the service worker up
node cdp.mjs open "chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html" >/dev/null
sleep 2

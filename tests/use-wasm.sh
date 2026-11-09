#!/usr/bin/env bash
# Swap a wllama.wasm build into the test copy and reload the extension (A/B runs of engine builds that
# share the same JS glue, e.g. shader-only changes). The engine picks it up when its document starts.
# usage: bash tests/use-wasm.sh <wllama.wasm>
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cp "$1" "$ROOT/.work/ext-test/vendor/wllama/wllama.wasm"
cd "$ROOT/tests"
node cdp.mjs targets | grep -q 'chrome://extensions' || { node cdp.mjs open "chrome://extensions/" >/dev/null; sleep 1.5; }
node cdp.mjs page "chrome://extensions" "new Promise(r => chrome.developerPrivate.reload('bhkpaambekhpdikhkccbfdappiogpgnc', {failQuietly: true}, () => chrome.management.setEnabled('bhkpaambekhpdikhkccbfdappiogpgnc', true, () => r('reloaded'))))" >/dev/null
sleep 1.5
node cdp.mjs open "chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html" >/dev/null
sleep 2
echo "test copy: $(basename "$1") $(sha256sum "$1" | cut -c1-12)"

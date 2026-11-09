#!/usr/bin/env bash
# A/B benchmarks: sync the test copy, then swap in another engine build and/or the swa_full flag there
# (the extension dir itself stays untouched). The engine reads both when its offscreen document starts.
# usage: bash tests/bench_config.sh <wllama.wasm file> <swa_full: true|false>
set -e
S="$(cd "$(dirname "$0")/.." && pwd)/.work/ext-test"
bash "$(dirname "$0")/sync-test-ext.sh" extension >/dev/null
cp "$1" "$S/vendor/wllama/wllama.wasm"
python - "$(cygpath -m "$S/offscreen/engine.js")" "$2" <<'EOF'
import sys
p, v = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
assert s.count('swa_full: true') == 1, 'engine.js no longer sets swa_full: true'
s = s.replace('swa_full: true', 'swa_full: ' + v)
open(p, 'w', encoding='utf-8', newline='\n').write(s)
EOF
echo "test copy: $(sha256sum "$S/vendor/wllama/wllama.wasm" | cut -c1-12) swa_full=$2"

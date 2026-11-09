#!/usr/bin/env bash
# Toggle GPU-side (backend) sampling in the test copy's engine and reload: on | off
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python - "$(cygpath -m "$ROOT/.work/ext-test/offscreen/engine.js")" "$1" <<'EOF'
import sys
p, mode = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
on = "    top_k: 1,\n    backend_sampling: true, // TEST\n    samplers: ['top_k'], // TEST\n"
off = "    top_k: 1,\n"
if mode == 'on' and on not in s:
    assert s.count(off) == 1
    s = s.replace(off, on)
elif mode == 'off' and on in s:
    s = s.replace(on, off)
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('backend sampling', mode)
EOF
bash "$ROOT/tests/use-wasm.sh" "$ROOT/.work/ext-test/vendor/wllama/wllama.wasm" >/dev/null
sleep 2

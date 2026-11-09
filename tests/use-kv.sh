#!/usr/bin/env bash
# KV-cache layout experiments on the test copy: one cache shared by all slots (unified, the default) or
# one stream per slot (split: each slot gets n_ctx / slots cells), and the total n_ctx. Reloads.
# usage: bash tests/use-kv.sh unified|split <n_ctx>
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python - "$(cygpath -m "$ROOT/.work/ext-test/offscreen/engine.js")" "$1" "$2" <<'EOF'
import re, sys
p, mode, n_ctx = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
s, n = re.subn(r'const N_CTX = \d+;', f'const N_CTX = {n_ctx};', s)
assert n == 1
s = re.sub(r' kv_unified: (true|false),', '', s)
s, n = re.subn(r'swa_full: true,', f'swa_full: true, kv_unified: {"true" if mode == "unified" else "false"},', s)
assert n == 1
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('kv', mode, 'n_ctx', n_ctx)
EOF
bash "$ROOT/tests/use-wasm.sh" "$ROOT/.work/ext-test/vendor/wllama/wllama.wasm" >/dev/null

#!/usr/bin/env bash
# Dev-only: A/B engine configurations on the test copy. Each argument is
#   name|<slots>|<ubatch>|<unified|split>|<n_ctx>|<shader-hook json cfg or off>[|<wasm file in .work/bench>]
# The list runs twice in order (interleaved, against drift), each run a bench_speed with 2 rounds;
# results go to .work/bench/cf_<name>_<pass>.json, then every config's texts are compared to the first's.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/tests"
for pass in 1 2; do
  for spec in "$@"; do
    IFS='|' read -r name slots ub kv nctx hook wasm <<< "$spec"
    if [ -n "$wasm" ]; then cp "$ROOT/.work/bench/$wasm" "$ROOT/.work/ext-test/vendor/wllama/wllama.wasm"; fi
    bash use-slots.sh "$slots" "$ub" >/dev/null
    python - "$(cygpath -m "$ROOT/.work/ext-test/offscreen/engine.js")" "$kv" "$nctx" <<'EOF'
import re, sys
p, mode, n_ctx = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
s, n = re.subn(r'const N_CTX = \d+;', f'const N_CTX = {n_ctx};', s)
assert n == 1
s = re.sub(r' kv_unified: (true|false),', '', s)
s, n = re.subn(r'swa_full: true,', f'swa_full: true, kv_unified: {"true" if mode == "unified" else "false"},', s)
assert n == 1
open(p, 'w', encoding='utf-8', newline='\n').write(s)
EOF
    bash use-shader-hook.sh "$hook" >/dev/null
    echo "== $name (pass $pass): slots $slots ubatch $ub kv $kv n_ctx $nctx hook $hook ${wasm:+wasm $wasm}"
    timeout 900 node bench_speed.mjs "cf_$name" "$(cygpath -m "$ROOT/.work/bench/cf_${name}_$pass.json")" 2 2>&1 | grep -E "^\[1\]|Error" || true
  done
done
first=$(echo "$1" | cut -d'|' -f1)
for spec in "${@:2}"; do
  name=$(echo "$spec" | cut -d'|' -f1)
  echo "== identical? $first vs $name: $(node compare_bench.mjs "../.work/bench/cf_${first}_1.json" "../.work/bench/cf_${name}_1.json" 2>&1 | grep -E "identical|differs" | head -1)"
done

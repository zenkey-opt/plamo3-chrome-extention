#!/usr/bin/env bash
# Dev-only: A/B shader variants through the shader hook. Each argument is "name=<json cfg>"; the list is
# run twice in order (interleaved, against drift), each run a bench_speed with 2 rounds.
# Results: .work/bench/sv_<name>_<pass>.json. usage: bash tests/ab-shaders.sh 'base={}' 'x={"wg":...}' ...
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/tests"
for pass in 1 2; do
  for spec in "$@"; do
    name=${spec%%=*}
    cfg=${spec#*=}
    bash use-shader-hook.sh "$cfg" >/dev/null
    echo "== $name (pass $pass)"
    timeout 600 node bench_speed.mjs "sv_$name" "$(cygpath -m "$ROOT/.work/bench/sv_${name}_$pass.json")" 2 2>&1 | grep -E "^\[1\]|Error" || true
  done
done
bash use-shader-hook.sh off >/dev/null
first=${1%%=*}
for spec in "$@"; do
  name=${spec%%=*}
  [ "$name" = "$first" ] && continue
  echo "== identical? $first vs $name"
  node compare_bench.mjs "../.work/bench/sv_${first}_1.json" "../.work/bench/sv_${name}_1.json" 2>&1 | grep -iE "identical|differ|mismatch" | head -3 || true
done

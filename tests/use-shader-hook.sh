#!/usr/bin/env bash
# Dev-only: hook the TEST copy's engine worker with shader-hook.js + shader-variants.js, configured by a
# JSON object (see shader-variants.js), or remove the hook. Reloads the test extension.
# usage: bash tests/use-shader-hook.sh '<json cfg>' | off
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$ROOT/.work/ext-test/vendor/wllama"
W="$V/llama-worker.js"
LINE='import "./shader-hook.js"; // DEV shader hook'
sed -i '/DEV shader hook$/d' "$W"
rm -f "$V/shader-hook.js" "$V/shader-variants.js" "$V/shader-cfg.js"
if [ "$1" != off ]; then
  cp "$ROOT/tests/shader-hook.js" "$ROOT/tests/shader-variants.js" "$V/"
  echo "export default $1;" > "$V/shader-cfg.js"
  sed -i "1i $LINE" "$W"
fi
bash "$ROOT/tests/use-wasm.sh" "$V/wllama.wasm" >/dev/null
echo "shader hook: $1"

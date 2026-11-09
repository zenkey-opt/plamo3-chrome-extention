#!/usr/bin/env bash
# Dev-only: make the TEST copy's engine return per-token logprobs (top 3) with every completion, kept in
# the offscreen document as self.__lp (cleared by the caller). on | off. Reloads the test extension.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python - "$(cygpath -m "$ROOT/.work/ext-test/offscreen/engine.js")" "$1" <<'EOF'
import sys
p, mode = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
A = "    abortSignal: ctrl.signal,\n  };\n"
A2 = A + "  params.logprobs = true; params.top_logprobs = 3; const lpc = []; // DEV logprobs\n"
B = "          if (c?.timings) last = c;\n"
B2 = B + "          if (c?.choices?.[0]?.logprobs?.content) lpc.push(...c.choices[0].logprobs.content); // DEV logprobs\n"
C = "    return { text, timings: last?.timings || null,"
C2 = "    (self.__lp = self.__lp || []).push({ prompt, text, lp: lpc.length ? lpc : last?.choices?.[0]?.logprobs?.content || null }); // DEV logprobs\n" + C
for a, b in ((A, A2), (B, B2), (C, C2)):
    if mode == 'on' and b not in s:
        assert s.count(a) == 1, a
        s = s.replace(a, b)
    elif mode == 'off' and b in s:
        s = s.replace(b, a)
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('logprobs', mode)
EOF
bash "$ROOT/tests/use-wasm.sh" "$ROOT/.work/ext-test/vendor/wllama/wllama.wasm" >/dev/null

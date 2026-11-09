#!/usr/bin/env bash
# Engine slot experiments on the test copy (run tests/use-build.sh first; this does not re-sync):
# set the number of parallel sequences (engine slots = queue limit = page requests in flight) and the
# micro-batch size, then reload the extension in the test browser.
# usage: bash tests/use-slots.sh <parallel> <ubatch>
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
S=$ROOT/.work/ext-test
python - "$(cygpath -m "$S")" "$1" "$2" <<'EOF'
import re, sys
s_dir, par, ub = sys.argv[1], sys.argv[2], sys.argv[3]
def sub(rel, pattern, repl):
    p = f'{s_dir}/{rel}'
    s = open(p, encoding='utf-8').read()
    s2, n = re.subn(pattern, repl, s)
    assert n >= 1, (rel, pattern)
    open(p, 'w', encoding='utf-8', newline='\n').write(s2)
sub('offscreen/engine.js', r'const N_PARALLEL = \d+;', f'const N_PARALLEL = {par};')
sub('offscreen/engine.js', r'n_ubatch: \d+,', f'n_ubatch: {ub},')
sub('background.js', r'Math\.min\(\d+, Number\(s\.concurrency\) \|\| \d+\)', f'Math.min({par}, Number(s.concurrency) || {par})')
sub('background.js', r'new Queue\(\d+\)', f'new Queue({par})')
sub('content/page.js', r'const MAX_OUTSTANDING = \d+;', f'const MAX_OUTSTANDING = {par};')
EOF
cd "$ROOT/tests"
node cdp.mjs targets | grep -q 'chrome://extensions' || { node cdp.mjs open "chrome://extensions/" >/dev/null; sleep 1.5; }
node cdp.mjs page "chrome://extensions" "new Promise(r => chrome.developerPrivate.reload('bhkpaambekhpdikhkccbfdappiogpgnc', {failQuietly: true}, () => chrome.management.setEnabled('bhkpaambekhpdikhkccbfdappiogpgnc', true, () => r('reloaded'))))" >/dev/null
sleep 1.5
node cdp.mjs open "chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html" >/dev/null
sleep 2
node cdp.mjs sw "chrome.storage.local.set({ concurrency: $1 }).then(() => new Promise(r => setTimeout(r, 300))).then(() => 'slots $1, ubatch $2, queue limit ' + self.__plamo.queue.limit)"

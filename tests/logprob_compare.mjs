// Dev-only: compare two engine builds token by token (tests/use-logprobs.sh on first).
//   node tests/logprob_compare.mjs run <label>       translate the 33 fixture texts one by one, save
//                                                    tokens + top-3 logprobs to .work/bench/lp_<label>.json
//   node tests/logprob_compare.mjs diff <labelA> <labelB>
// For every text: how far the two runs agree, how much the logprob of each shared token moved, and,
// where the outputs part, how close the top two candidates were at that token (a near-tie flips on
// tiny numeric differences; a real change would show a wide margin).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [cmd, a, b] = process.argv.slice(2);
const dir = new URL('../.work/bench/', import.meta.url);
const cdp = (...args) => execFileSync('node', [new URL('./cdp.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), ...args], { encoding: 'utf8', maxBuffer: 256 << 20 }).trim();

if (cmd === 'run') {
  const T = JSON.parse(readFileSync(new URL('./fixtures/bench_texts.json', import.meta.url), 'utf8'));
  const texts = [...T.short, ...T.medium, ...T.long, ...T.page].filter((t, i, all) => all.indexOf(t) === i);
  cdp('sw', "chrome.storage.local.set({ model: '2b-q4km' }).then(() => self.__plamo.engineCall('unload')).then(() => self.__plamo.engineCall('load', { modelId: '2b-q4km' })).then(() => 'ok')");
  cdp('offscreen', 'self.__lp = []; 0');
  for (const [i, t] of texts.entries()) {
    cdp('sw', `self.__plamo.translate({ text: ${JSON.stringify(t)}, target: 'ja', useCache: false }).then(r => r.text.length)`);
    if (i % 10 === 9) console.log(`${i + 1}/${texts.length}`);
  }
  const lp = JSON.parse(cdp('offscreen', 'JSON.stringify(self.__lp.map(x => ({ text: x.text, lp: (x.lp || []).map(t => ({ t: t.token, p: t.logprob, top: (t.top_logprobs || []).map(u => [u.token, u.logprob]) })) })))'));
  writeFileSync(new URL(`lp_${a}.json`, dir), JSON.stringify(lp));
  console.log(`saved ${lp.length} completions, ${lp.reduce((s, x) => s + x.lp.length, 0)} tokens with logprobs`);
} else if (cmd === 'diff') {
  const A = JSON.parse(readFileSync(new URL(`lp_${a}.json`, dir), 'utf8'));
  const B = JSON.parse(readFileSync(new URL(`lp_${b}.json`, dir), 'utf8'));
  let same = 0, shared = 0, sumAbs = 0, maxAbs = 0;
  const parts = [];
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const x = A[i].lp, y = B[i].lp;
    let d = 0;
    while (d < x.length && d < y.length && x[d].t === y[d].t) {
      const e = Math.abs(x[d].p - y[d].p);
      sumAbs += e;
      maxAbs = Math.max(maxAbs, e);
      shared++;
      d++;
    }
    if (d === x.length && d === y.length) { same++; continue; }
    const margin = (r) => (r && r.top.length > 1 ? r.top[0][1] - r.top[1][1] : NaN);
    parts.push({ i, at: d, of: x.length, a: x[d]?.t, b: y[d]?.t, marginA: margin(x[d]), marginB: margin(y[d]) });
  }
  console.log(`${same}/${A.length} completions token-identical; ${shared} shared tokens: |dlogprob| mean ${(sumAbs / shared).toExponential(2)}, max ${maxAbs.toExponential(2)}`);
  for (const p of parts) {
    console.log(`#${p.i}: parts at token ${p.at}/${p.of}: ${JSON.stringify(p.a)} vs ${JSON.stringify(p.b)}; top-2 margin ${p.marginA.toFixed(3)} / ${p.marginB.toFixed(3)} nats (prob ratio ${Math.exp(p.marginA).toFixed(2)})`);
  }
} else {
  console.log('usage: node tests/logprob_compare.mjs run <label> | diff <labelA> <labelB>');
}

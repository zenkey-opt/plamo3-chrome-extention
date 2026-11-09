// Translation speed benchmark in the test Brave (2B model). Every request has a new text, as in real use.
// node bench_speed.mjs <label> [out.json] [rounds]
//   sequential: 3 short / 3 medium / 3 long texts one after another (median per class)
//   page:       24 texts of a web page submitted at once (the page translator runs up to 4 at a time)
// Outputs are greedy, so the texts must stay identical between engine builds (compare the JSON files).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const label = process.argv[2] || 'run';
const out = process.argv[3] || `bench_${label}.json`;
const rounds = Number(process.argv[4] || 2);
const T = JSON.parse(readFileSync(new URL('./fixtures/bench_texts.json', import.meta.url), 'utf8'));
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 600000 }).trim();
const sw = (js) => JSON.parse(cdp('sw', js));
const tr = (text) =>
  `self.__plamo.translate({ text: ${JSON.stringify(text)}, target: 'ja', useCache: false }).then(r => JSON.stringify({ ms: r.ms, stats: r.stats, text: r.text }))`;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const MODEL = process.env.MODEL || '2b-q4km'; // MODEL=0.8b-q4km node bench_speed.mjs ...
console.log('load ->', cdp('sw', `chrome.storage.local.set({ model: '${MODEL}' }).then(() => self.__plamo.engineCall('load', { modelId: '${MODEL}' })).then(s => s.state + ' ' + s.info.loadMs + ' ms')`));
sw(tr('Warm up the engine before measuring.'));
const res = { label, at: new Date().toISOString(), rounds: [] };
for (let r = 0; r < rounds; r++) {
  const round = { sequential: {}, page: null };
  for (const cls of ['short', 'medium', 'long']) {
    const runs = T[cls].map((t) => sw(tr(t)));
    const s = (k) => runs.reduce((a, x) => a + x.stats[k], 0);
    round.sequential[cls] = {
      msMedian: med(runs.map((x) => x.ms)),
      ms: runs.map((x) => x.ms),
      promptMsPerTok: +(s('promptMs') / s('promptN')).toFixed(2),
      genTokPerSec: +((s('genN') / s('genMs')) * 1000).toFixed(1),
      promptN: s('promptN'),
      genN: s('genN'),
      texts: runs.map((x) => x.text),
    };
  }
  const page = sw(`(async () => { const t0 = performance.now(); const rs = await Promise.all(${JSON.stringify(T.page)}.map(t => self.__plamo.translate({ text: t, target: 'ja', useCache: false, priority: 'low' }))); return JSON.stringify({ wall: Math.round(performance.now() - t0), gen: rs.reduce((a, r) => a + r.stats.genN, 0), prompt: rs.reduce((a, r) => a + r.stats.promptN, 0), texts: rs.map(r => r.text) }); })()`);
  round.page = { ...page, aggTokPerSec: +((page.gen / page.wall) * 1000).toFixed(1) };
  res.rounds.push(round);
  for (const [cls, v] of Object.entries(round.sequential))
    console.log(`[${r}] ${cls.padEnd(6)} median ${String(v.msMedian).padStart(5)} ms  prompt ${v.promptN} tok @ ${v.promptMsPerTok} ms/tok  gen ${v.genN} tok @ ${v.genTokPerSec} tok/s`);
  console.log(`[${r}] page   24 texts ${page.wall} ms  (${page.prompt} prompt + ${page.gen} generated tokens, ${round.page.aggTokPerSec} tok/s aggregate)`);
}
writeFileSync(out, JSON.stringify(res, null, 2));
console.log('saved', out);

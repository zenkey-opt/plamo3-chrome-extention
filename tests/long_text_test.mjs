// One long input (all fixture paragraphs, ~2k tokens): exercises long prefills (many ubatches in flight).
// node long_text_test.mjs <label> [out.json]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const label = process.argv[2] || 'run';
const out = process.argv[3];
const T = JSON.parse(readFileSync(new URL('./fixtures/bench_texts.json', import.meta.url), 'utf8'));
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 600000 }).trim();
const text = [...T.medium, ...T.long, T.page.slice(3, 20).join(' '), ...T.long, ...T.medium].join('\n\n');
// fresh load: the same empty KV cache (no reused prefix) in every run, so outputs are comparable
cdp('sw', "self.__plamo.engineCall('unload').then(() => 'ok')");
cdp('sw', "chrome.storage.local.set({ model: '2b-q4km' }).then(() => self.__plamo.engineCall('load', { modelId: '2b-q4km' })).then(s => s.state)");
const r = JSON.parse(cdp('sw', `self.__plamo.translate({ text: ${JSON.stringify(text)}, target: 'ja', useCache: false }).then(r => JSON.stringify({ ms: r.ms, stats: r.stats, text: r.text }), e => JSON.stringify({ error: e.code + ' ' + e.message }))`));
if (r.error) {
  console.log('error:', r.error);
  process.exit(1);
}
const s = r.stats;
console.log(`${label}: ${text.length} chars, ${r.ms} ms; prompt ${s.promptN} tok @ ${(s.promptMs / s.promptN).toFixed(2)} ms/tok; gen ${s.genN} tok @ ${((s.genN / s.genMs) * 1000).toFixed(1)} tok/s; output ${r.text.length} chars`);
if (out) writeFileSync(out, JSON.stringify({ label, ...r }, null, 2));

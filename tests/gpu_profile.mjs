// GPU time per shader (profile build only): load, translate a fixed set of texts, then read the cumulative
// per-shader totals that the profile build logs every 64 graphs (tools/wllama-patches/llama.cpp/0002-*).
// Needs: the test copy vendored from a GGML_WEBGPU_GPU_PROFILE build
//   (BUILD_DIR=build-prof EXTRA_CMAKE_ARGS=-DGGML_WEBGPU_GPU_PROFILE=ON bash tools/build-wllama.sh;
//    EXT_DIR=.work/ext-test node tools/vendor-wllama.mjs --wasm-dir .work/wsrc/build-prof --reuse-index)
// and the test browser started with BROWSER_EXTRA_FLAGS=--enable-webgpu-developer-features
// (otherwise timestamps are quantized to 100 us).
// The profile build runs one compute pass per dispatch, so its wall times are not representative;
// compare GPU busy time per graph with the release build's wall time per graph instead.
// node gpu_profile.mjs [modelId] [classes, e.g. long, short,medium, page or all] [out.json]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const modelId = process.argv[2] || '2b-q4km';
const classes = (process.argv[3] || 'long').split(',');
const out = process.argv[4];
const T = JSON.parse(readFileSync(new URL('./fixtures/bench_texts.json', import.meta.url), 'utf8'));
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 600000 }).trim();
const sw = (js) => JSON.parse(cdp('sw', js));

// a fresh load resets the counters (new backend context)
cdp('sw', "self.__plamo.engineCall('unload').then(() => 'ok')");
console.log('load ->', cdp('sw', `chrome.storage.local.set({ model: '${modelId}' }).then(() => self.__plamo.engineCall('load', { modelId: '${modelId}' })).then(s => s.state + ' ' + s.info.loadMs + ' ms')`));
const runs = [];
// 'page' / 'all': the page texts / all fixture texts at once (parallel slots: multi-column products);
// other classes: one text after another
const together = (texts) =>
  sw(`Promise.all(${JSON.stringify(texts)}.map(t => self.__plamo.translate({ text: t, target: 'ja', useCache: false, priority: 'low' }))).then(rs => JSON.stringify(rs.map(r => ({ ms: r.ms, stats: r.stats }))))`);
for (const cls of classes) {
  if (cls === 'page') runs.push(...together(T.page));
  else if (cls === 'all') runs.push(...together([...T.page, ...T.short, ...T.medium, ...T.long]));
  else for (const text of T[cls]) runs.push(sw(`self.__plamo.translate({ text: ${JSON.stringify(text)}, target: 'ja', useCache: false }).then(r => JSON.stringify({ ms: r.ms, stats: r.stats }))`));
}
const logs = sw("self.__plamo.engineCall('logs').then(l => JSON.stringify(l))");
let start = -1;
logs.forEach((l, i) => {
  if (/ggml_webgpu_prof: graphs \d+ total/.test(l)) start = i;
});
if (start < 0) {
  console.log('no GPU profile in the logs; last lines:\n' + logs.slice(-15).join('\n'));
  process.exit(1);
}
const [, graphs, total] = logs[start].match(/graphs (\d+) total ([\d.]+) ms/).map(Number);
const shaders = [];
for (const l of logs.slice(start + 1)) {
  const m = l.match(/ggml_webgpu_prof: (\S+) ([\d.]+) ms (\d+)/);
  if (!m) break;
  shaders.push({ name: m[1], ms: +m[2], n: +m[3] });
}
shaders.sort((a, b) => b.ms - a.ms);
const sum = (k) => runs.reduce((a, r) => a + r.stats[k], 0);
const allGraphs = runs.reduce((a, r) => a + Math.ceil(r.stats.promptN / 4) + r.stats.genN, 0);
const dispatches = shaders.reduce((a, s) => a + s.n, 0);
console.log(`${runs.length} texts: prompt ${sum('promptN')} tok, gen ${sum('genN')} tok (~${allGraphs} graphs); profile covers the first ${graphs} graphs`);
console.log(`GPU busy ${total.toFixed(0)} ms = ${(total / graphs).toFixed(2)} ms per graph, ${(dispatches / graphs).toFixed(0)} dispatches per graph, ${((total / dispatches) * 1000).toFixed(1)} us per dispatch`);
console.log('    ms/graph   share   us/disp  disp/graph  shader');
for (const s of shaders.slice(0, 30))
  console.log(`${(s.ms / graphs).toFixed(3).padStart(11)} ${((s.ms / total) * 100).toFixed(1).padStart(6)}% ${((s.ms / s.n) * 1000).toFixed(1).padStart(9)} ${(s.n / graphs).toFixed(1).padStart(10)}  ${s.name}`);
if (out) writeFileSync(out, JSON.stringify({ modelId, classes, runs, graphs, total, shaders }, null, 2));

// Where does a decode step's wall time go? Instruments the test copy's llama-worker.js (submit, waits,
// writeBuffer) with timestamps, runs one translation and prints the per-step timeline:
//   pre    = previous wait returned -> first submit of the next graph (sampling, graph build, alloc, uploads)
//   encode = first -> last submit of the graph (encoding overlaps with GPU work)
//   tail   = last submit -> wait started
//   wait   = wait for the GPU (GPU work still running + completion notification latency)
// Test copy only (bash use-build.sh first); node worker_timeline.mjs [modelId] [class] [index]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const W = new URL('../.work/ext-test/vendor/wllama/llama-worker.js', import.meta.url);
const modelId = process.argv[2] || '2b-q4km';
const cls = process.argv[3] || 'long';
const idx = Number(process.argv[4] || 0);
const T = JSON.parse(readFileSync(new URL('./fixtures/bench_texts.json', import.meta.url), 'utf8'));
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 300000 }).trim();

// 1) instrument (idempotent)
let src = readFileSync(W, 'utf8');
if (!src.includes('__TL')) {
  const rep = (a, b) => {
    if (src.split(a).length !== 2) throw new Error('pattern not found once: ' + a.slice(0, 60));
    src = src.replace(a, b);
  };
  rep('var _wgpuQueueSubmit=function(queuePtr,commandCount,commands){', 'var _wgpuQueueSubmit=function(queuePtr,commandCount,commands){self.__TL&&self.__TL.push(["s",performance.now()]);');
  rep('function _wgpuQueueWriteBuffer(queuePtr,bufferPtr,bufferOffset,data,size){', 'function _wgpuQueueWriteBuffer(queuePtr,bufferPtr,bufferOffset,data,size){self.__TL&&self.__TL.push(["b",performance.now()]);');
  rep('return Asyncify.handleAsync(async()=>{var promises=[];', 'self.__TL&&self.__TL.push(["w0",performance.now()]);return Asyncify.handleAsync(async()=>{var promises=[];');
  rep('const firstResolvedFuture=await Promise.race(promises);', 'const firstResolvedFuture=await Promise.race(promises);self.__TL&&self.__TL.push(["w1",performance.now()]);');
  writeFileSync(W, src);
  console.log('instrumented; reloading the extension');
  cdp('page', 'chrome://extensions', "new Promise(r => chrome.developerPrivate.reload('bhkpaambekhpdikhkccbfdappiogpgnc', {failQuietly: true}, () => r('reloaded')))");
  execFileSync('node', ['-e', 'setTimeout(()=>{},1500)']);
  cdp('open', 'chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html');
  execFileSync('node', ['-e', 'setTimeout(()=>{},2000)']);
}

// translate() uses the model selected in the settings, so select the one under test
cdp('sw', `chrome.storage.local.set({ model: '${modelId}' }).then(() => self.__plamo.engineCall('load', { modelId: '${modelId}' })).then(s => s.state)`);
cdp('sw', "self.__plamo.translate({ text: 'Warm up the engine.', target: 'ja', useCache: false }).then(r => r.ms)");

// 2) attach to the engine worker (through the offscreen document, flat sessions)
const ts = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const off = ts.find((t) => t.url.includes('offscreen/engine.html'));
const ws = new WebSocket(off.webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let id = 0;
const pending = new Map();
let onEvent = null;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  } else onEvent?.(m);
};
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
  });
const attached = new Promise((res) => (onEvent = (m) => m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'worker' && res(m.params)));
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
const info = await attached;
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }, info.sessionId)).result.value;
await ev('self.__TL = []; 1');
const r = JSON.parse(cdp('sw', `self.__plamo.translate({ text: ${JSON.stringify(T[cls][idx])}, target: 'ja', useCache: false }).then(r => JSON.stringify({ ms: r.ms, stats: r.stats }))`));
const tl = await ev('JSON.stringify(self.__TL)');
await ev('self.__TL = null; 1');
ws.close();

// 3) split into steps at each wait end
const evs = JSON.parse(tl);
const steps = [];
let cur = { s: [], b: [], w0: null, w1: null, start: null };
for (const [k, t] of evs) {
  if (k === 'w1') {
    cur.w1 = t;
    steps.push(cur);
    cur = { s: [], b: [], w0: null, w1: null, start: t };
  } else if (k === 'w0') cur.w0 = t;
  else cur[k].push(t);
}
const graphSteps = steps.filter((x) => x.s.length >= 4 && x.start !== null && x.w0 !== null);
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const rows = graphSteps.map((x) => ({
  pre: x.s[0] - x.start,
  encode: x.s[x.s.length - 1] - x.s[0],
  tail: x.w0 - x.s[x.s.length - 1],
  wait: x.w1 - x.w0,
  total: x.w1 - x.start,
  submits: x.s.length,
}));
const waitsPerStep = steps.length / Math.max(1, graphSteps.length);
console.log(`translation ${r.ms} ms, prompt ${r.stats.promptN} tok, gen ${r.stats.genN} tok; ${evs.length} events, ${steps.length} waits, ${graphSteps.length} graph steps (${waitsPerStep.toFixed(2)} waits per graph)`);
const dec = rows.slice(-Math.min(rows.length, r.stats.genN)); // decode steps are the last ones
for (const k of ['pre', 'encode', 'tail', 'wait', 'total', 'submits'])
  console.log(`${k.padEnd(8)} median ${med(dec.map((x) => x[k])).toFixed(2).padStart(7)}  mean ${(dec.reduce((a, x) => a + x[k], 0) / dec.length).toFixed(2).padStart(7)}`);
writeFileSync(new URL('../.work/bench/timeline.json', import.meta.url), JSON.stringify({ r, evs }, null, 0));

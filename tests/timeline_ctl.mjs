// Engine timeline around any workload (e.g. a real page translation with page_test.mjs):
//   node timeline_ctl.mjs start      (instrumented llama-worker.js required: run worker_timeline.mjs once)
//   ... run the workload ...
//   node timeline_ctl.mjs stop [out.json]
// stop prints how the wall time splits into GPU waits, CPU work between steps and idle gaps (> 30 ms
// without work: the engine was waiting for requests).
import { writeFileSync } from 'node:fs';

const [cmd, out] = process.argv.slice(2);
const ts = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const off = ts.find((t) => t.url.includes('offscreen/engine.html'));
if (!off) throw new Error('engine document not running');
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

if (cmd === 'start') {
  console.log('instrumented:', await ev("typeof self.__TL !== 'undefined' || /__TL/.test(String(_wgpuQueueSubmit))"));
  await ev('self.__TL = []; 1');
  ws.close();
  process.exit(0);
}
const evs = JSON.parse(await ev('JSON.stringify(self.__TL || [])'));
await ev('self.__TL = null; 1');
ws.close();
if (!evs.length) throw new Error('no events (not instrumented, or not started)');
const steps = [];
let cur = { s: [], w0: null, start: null };
for (const [k, t] of evs) {
  if (k === 'w1') {
    if (cur.start !== null && cur.s.length && cur.w0 !== null) steps.push({ pre: cur.s[0] - cur.start, encode: cur.s[cur.s.length - 1] - cur.s[0], tail: cur.w0 - cur.s[cur.s.length - 1], wait: t - cur.w0, submits: cur.s.length });
    cur = { s: [], w0: null, start: t };
  } else if (k === 'w0') cur.w0 = t;
  else if (k === 's') cur.s.push(t);
}
const wall = evs[evs.length - 1][1] - evs[0][1];
const sum = (f) => steps.reduce((a, x) => a + f(x), 0);
const idle = steps.filter((x) => x.pre > 30);
const r = {
  wallMs: Math.round(wall),
  steps: steps.length,
  waitMs: Math.round(sum((x) => x.wait)),
  cpuMs: Math.round(sum((x) => (x.pre > 30 ? 0 : x.pre) + x.encode + x.tail)),
  idleMs: Math.round(idle.reduce((a, x) => a + x.pre, 0)),
  idleGaps: idle.length,
  longestGapMs: Math.round(Math.max(0, ...idle.map((x) => x.pre))),
};
console.log(JSON.stringify(r));
if (out) writeFileSync(out, JSON.stringify({ ...r, evs }));

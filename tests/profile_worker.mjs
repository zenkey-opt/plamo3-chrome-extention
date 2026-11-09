// CPU profile of the llama.cpp worker during one translation (where does a token's time go?).
// node profile_worker.mjs [out.json] [nPredictHint]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:9333';
const out = process.argv[2] || 'worker_profile.json';
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 120000 }).trim();
const TEXT =
  'Machine translation is use of computational techniques to translate text or speech from one language to another, including the contextual, idiomatic and pragmatic nuances of both languages. While some language models are capable of generating comprehensible results, machine translation tools remain the most reliable option for people who need accurate translations.';

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  const api = {
    onEvent: null,
    send: (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, { res, rej });
        ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
      }),
    close: () => ws.close(),
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else api.onEvent?.(m);
  };
  return api;
}

console.log('load ->', cdp('sw', "self.__plamo.engineCall('load', { modelId: '2b-q4km' }).then(s => s.state + ' ' + JSON.stringify(s.info))"));
// warm-up (first decode compiles pipelines)
console.log('warm-up ->', cdp('sw', `self.__plamo.translate({ text: 'Warm up the engine.', target: 'ja', useCache: false }).then(r => r.ms + ' ms')`));
// attach to the engine's dedicated worker through the offscreen document (flat sessions)
const ts = await (await fetch(BASE + '/json/list')).json();
const off = ts.find((t) => t.url.includes('offscreen/engine.html'));
const page = await connect(off.webSocketDebuggerUrl);
const attached = new Promise((res) => (page.onEvent = (m) => m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'worker' && res(m.params)));
await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
const info = await Promise.race([attached, new Promise((_, rej) => setTimeout(() => rej(new Error('no worker attached')), 5000))]);
console.log('worker:', info.targetInfo.url);
const c = { send: (method, params = {}) => page.send(method, params, info.sessionId), close: () => page.close() };
console.log('eval in worker ->', JSON.stringify(await c.send('Runtime.evaluate', { expression: 'typeof Module + " " + (self.location && self.location.pathname)' })));
await c.send('Profiler.enable');
await c.send('Profiler.setSamplingInterval', { interval: 100 });
await c.send('Profiler.start');
const t0 = Date.now();
const r = cdp('sw', `self.__plamo.translate({ text: ${JSON.stringify(TEXT)}, target: 'ja', useCache: false }).then(r => JSON.stringify({ ms: r.ms, timings: r.timings, t: r.t, text: r.text }))`);
const wall = Date.now() - t0;
const { profile } = await c.send('Profiler.stop');
c.close();
writeFileSync(out, JSON.stringify(profile));
console.log('translate ->', r, '| wall', wall, 'ms');

// aggregate self time
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const f = n.callFrame;
  const key = (f.functionName || '(anonymous)') + ' ' + (f.url ? f.url.split('/').pop() : '') ;
  self.set(key, (self.get(key) || 0) + (dt[i + 1] || 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log(`total sampled ${(total / 1000).toFixed(0)} ms`);
for (const [k, v] of top) console.log(`${(v / 1000).toFixed(1).padStart(8)} ms ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k.slice(0, 110)}`);

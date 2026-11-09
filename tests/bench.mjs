// Engine benchmark through the extension's service worker (CDP).
// usage: node bench.mjs <threads> [n] [model]
//   threads: llama.cpp CPU threads for the next model load (engine reloads the model)
const [threads = '1', n = '24', model = '', reload = '1'] = process.argv.slice(2);
const PORT = process.env.CDP_PORT || 9333;
const BASE = `http://127.0.0.1:${PORT}`;

async function sw() {
  for (let i = 0; i < 40; i++) {
    const t = (await (await fetch(BASE + '/json/list')).json()).find((x) => x.type === 'service_worker' && x.url.includes('background.js'));
    if (t) return t;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('service worker not found');
}

async function evalSW(expr) {
  const t = await sw();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  const r = await new Promise((res) => {
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) res(m.result);
    };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

const expr = `(async () => {
  const P = self.__plamo;
  ${model ? `await chrome.storage.local.set({ model: '${model}' }); await new Promise(r => setTimeout(r, 300));` : ''}
  await P.engineCall('config', { threads: ${Number(threads)} });
  if (${reload === '1'}) await P.engineCall('unload');
  const t0 = performance.now();
  await P.engineCall('load', { modelId: (await P.getStatus()).modelId });
  const loadMs = performance.now() - t0;
  const base = ['Our privacy policy explains how we collect and use data', 'Click the button below to download the latest version', 'Researchers found that regular exercise improves memory', 'The quick brown fox jumps over the lazy dog', 'Please restart your computer to complete the installation', 'This feature is available for all premium subscribers'];
  const texts = Array.from({ length: ${Number(n)} }, (_, i) => base[i % base.length] + ' (run ${Date.now() % 100000} case ' + i + ').');
  const t1 = performance.now();
  const marks = [];
  const rs = await Promise.all(texts.map(async (x, i) => { const s = performance.now() - t1; const r = await P.translate({ text: x, target: 'ja', priority: 'low', useCache: false }); marks.push([i, Math.round(s), Math.round(performance.now() - t1)]); return r; }));
  const ms = performance.now() - t1;
  const st = await P.getStatus();
  return { threads: st.info && st.info.threads, model: st.model, loadMs: Math.round(loadMs), n: rs.length, totalMs: Math.round(ms), perItemMs: Math.round(ms / rs.length), sample: rs[2].text, finishOrder: marks.map((m) => m[2]).sort((a, b) => a - b) };
})()`;

console.log(JSON.stringify(await evalSW(expr), null, 1));

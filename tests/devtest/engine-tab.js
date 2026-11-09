// Dev-only: run the same wllama build + OPFS model in a visible tab, to compare with the offscreen engine.
import { Wllama } from '../vendor/wllama/index.js';
import { MODELS } from '../lib/models.js';
import { openModel } from '../lib/store.js';
let w = null;
const LOG = [];
const L = (...a) => { LOG.push([Math.round(performance.now()), a.map(String).join(' ')]); if (LOG.length > 5000) LOG.splice(0, 1000); };
window.logsTab = (from = 0, to = Infinity, re = '') => LOG.filter(([t, l]) => t >= from && t <= to && (!re || new RegExp(re).test(l))).map(([t, l]) => t + ' ' + l.slice(0, 220));
window.nowTab = () => Math.round(performance.now());
window.loadTab = async (id = '0.8b-q4km', threads = 1, extra = {}) => {
  const file = await openModel(MODELS[id]);
  w = new Wllama({ default: chrome.runtime.getURL('vendor/wllama/wllama.wasm') }, { logger: { debug: L, log: L, info: L, warn: L, error: L }, suppressNativeLog: false });
  w.setCompat(null);
  const t = performance.now();
  await w.loadModel([file], { n_ctx: 8192, n_parallel: 4, n_gpu_layers: 999, n_threads: threads, ...extra });
  return Math.round(performance.now() - t);
};
window.benchTab = async (n = 16) => {
  const mk = (i) => '<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:msg|>Our privacy policy explains how we collect data (tab ' + i + ' ' + Date.now() + ').<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>';
  let next = 0;
  const rows = [];
  const T0 = performance.now();
  const worker = async () => {
    while (next < n) {
      const i = next++;
      const t = performance.now();
      const r = await w.createCompletion({ prompt: mk(i), max_tokens: 240, temperature: 0, top_k: 1, repeat_penalty: 1.0, stop: ['<|plamo:tag|>', '<|plamo:bos|>'], cache_prompt: true });
      const tm = r.timings || {};
      rows.push([i, Math.round(t - T0), Math.round(performance.now() - t), Math.round(tm.prompt_ms), Math.round(tm.predicted_ms)].join(','));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { total: Math.round(performance.now() - T0), rows };
};
// one long prompt (~300 tokens) alone: prefill cost per token
window.prefillTab = async (text) => {
  const prompt = '<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:msg|>' + text + ' (' + Date.now() + ')<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>';
  const t = performance.now();
  const r = await w.createCompletion({ prompt, max_tokens: 64, temperature: 0, top_k: 1, repeat_penalty: 1.0, stop: ['<|plamo:tag|>', '<|plamo:bos|>'], cache_prompt: true });
  const tm = r.timings || {};
  return { wall: Math.round(performance.now() - t), prompt_n: tm.prompt_n, prompt_ms: Math.round(tm.prompt_ms), msPerPromptTok: +(tm.prompt_ms / tm.prompt_n).toFixed(2), gen_n: tm.predicted_n, msPerGenTok: +(tm.predicted_ms / tm.predicted_n).toFixed(2) };
};
window.completeTab = async (text, max = 1200) => {
  const prompt = '<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:msg|>' + text + '<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>';
  const r = await w.createCompletion({ prompt, max_tokens: max, temperature: 0, top_k: 1, repeat_penalty: 1.0, stop: ['<|plamo:tag|>', '<|plamo:bos|>'] });
  return r?.choices?.[0]?.text || '';
};
window.unloadTab = async () => { await w?.exit(); w = null; return 'ok'; };

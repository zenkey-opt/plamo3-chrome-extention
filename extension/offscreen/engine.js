// PLaMo 3 Translate engine — runs in the offscreen document.
//
// llama.cpp (vendored wllama: WebAssembly + WebGPU) loads the GGUF from OPFS and serves
// completions to the service worker over a runtime port named 'engine'. The same document
// downloads models from Hugging Face (resumable, part by part) and unloads the model after
// an idle period so the VRAM is given back.
//
// Port protocol (service worker <-> engine):
//   sw -> engine  { k: 'rpc', n, method, params }   reply { k: 'rpc', n, ok, result | error }
//   sw -> engine  { k: 'cancel', rid }               abort a running completion
//   engine -> sw  { k: 'delta', rid, text }          streamed text so far (accumulated)
//   engine -> sw  { k: 'event', type: 'state'|'dl', status }

import { Wllama } from '../vendor/wllama/index.js';
import { MODELS, modelUrl } from '../lib/models.js';
import { PART_SIZE, partName, modelDir, readMeta, writeMeta, openModel, deleteModel } from '../lib/store.js';
import { STOP } from '../lib/pfml.js';

const WASM_URL = chrome.runtime.getURL('vendor/wllama/wllama.wasm');
const N_CTX = 8192; // shared by all slots (unified KV cache)
const N_PARALLEL = 4;
const DL_STREAMS = 3;

class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const st = {
  state: 'unloaded', // unloaded | loading | ready | error
  modelId: null,
  info: null, // { backend, gpu, offloaded, loadMs, libllama, nCtx, slots }
  error: null,
  dl: null, // { id, state: downloading|done|error|canceled, done, total, bps, error }
};
let w = null;
let loadP = null;
let idleMin = 10;
// CPU threads for llama.cpp. All layers run on the GPU, so more threads only add spin-waiting
// (measured: 16 threads -> ~4-6 cores busy during translation). Overridable via config for tests.
let nThreads = 1;
let idleTimer = 0;
let dlCtrl = null;
const active = new Map(); // rid -> { ctrl, port }
const ports = new Set();
const nativeLog = [];

const status = () => ({ ...st, active: active.size });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(port, msg) {
  try {
    port.postMessage(msg);
  } catch {}
}
function emit(type) {
  const s = status();
  for (const p of ports) post(p, { k: 'event', type, status: s });
}
function setState(patch) {
  Object.assign(st, patch);
  emit('state');
}

// llama.cpp log lines (kept short; used for the offload summary and for debugging)
function keep(args) {
  let s = args.map((x) => (typeof x === 'string' ? x : safeJson(x))).join(' ');
  if (s.length > 600) s = s.slice(0, 600) + '…';
  nativeLog.push(s);
  if (nativeLog.length > 500) nativeLog.splice(0, 100);
}
function safeJson(x) {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}
const logger = { debug: (...a) => keep(a), log: (...a) => keep(a), info: (...a) => keep(a), warn: (...a) => keep(a), error: (...a) => keep(a) };

async function gpuInfo() {
  try {
    const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return null;
    const i = a.info || {};
    const label = [i.vendor, i.architecture, i.description].filter(Boolean).join(' · ');
    return { label: label || 'WebGPU', f16: a.features.has('shader-f16') };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Model lifecycle

async function load(modelId) {
  const m = MODELS[modelId];
  if (!m) throw new EngineError('BAD_MODEL', `不明なモデルです: ${modelId}`);
  while (loadP) await loadP.catch(() => {});
  if (w && st.state === 'ready' && st.modelId === modelId) return;
  loadP = (async () => {
    await unload(true);
    const file = await openModel(m);
    if (!file) {
      throw new EngineError('NO_MODEL', `翻訳モデル（${m.label}）がまだダウンロードされていません。拡張機能の設定画面からダウンロードしてください。`);
    }
    setState({ state: 'loading', modelId, error: null, info: null });
    const gpu = await gpuInfo();
    const t0 = performance.now();
    nativeLog.length = 0;
    const inst = new Wllama({ default: WASM_URL }, { logger, suppressNativeLog: false });
    inst.setCompat(null); // never fetch the CDN compat build (Chromium has JSPI + Memory64)
    try {
      // n_ubatch 4: on ggml-webgpu, micro-batches of <=4 tokens take the fast mat-vec path
      // (prompt 5.8 ms/token vs 7.8 at the default 512, 16.5 at 16, 31 at 8 — measured, 2B Q4_K_M);
      // parallel decoding is unaffected and greedy outputs match (one near-tie word in a long text)
      // swa_full: the SWA cache already spans all 8192 cells here (2048 window x 4 slots), so this costs
      // no memory; it tells the server that sequences can be truncated, which stops it from saving a
      // "context checkpoint" (a chain of GPU readbacks) at the end of every prompt
      await inst.loadModel([file], { n_ctx: N_CTX, n_parallel: N_PARALLEL, n_ubatch: 4, swa_full: true, n_gpu_layers: gpu ? 999 : 0, n_threads: gpu ? nThreads : Math.max(1, (navigator.hardwareConcurrency || 2) >> 1) });
    } catch (e) {
      try {
        await inst.exit();
      } catch {}
      throw new EngineError('LOAD_FAILED', 'モデルを読み込めませんでした: ' + (e?.message || e));
    }
    w = inst;
    const off = nativeLog.map((l) => l.match(/offloaded (\d+)\/(\d+) layers to GPU/)).find(Boolean);
    const onGpu = !!off && Number(off[1]) > 0;
    setState({
      state: 'ready',
      info: {
        backend: onGpu ? 'WebGPU' : 'CPU（WebAssembly）',
        gpu: onGpu ? gpu?.label || null : null,
        offloaded: off ? `${off[1]}/${off[2]}` : null,
        loadMs: Math.round(performance.now() - t0),
        // CI/local builds use a shallow llama.cpp checkout, so the "b<N>" build number is meaningless
        libllama: String(Wllama.getLibllamaVersion() || '').replace(/^b\d+-/, ''),
        nCtx: N_CTX,
        slots: N_PARALLEL,
        threads: inst.isMultithread() ? inst.getNumThreads() : 1,
      },
    });
    touch();
  })();
  try {
    await loadP;
  } catch (e) {
    w = null;
    // a model that is simply not downloaded is not an engine failure: the status already says so
    const failed = e.code !== 'NO_MODEL';
    setState({ state: failed ? 'error' : 'unloaded', modelId: null, error: failed ? { code: e.code || 'LOAD_FAILED', message: e.message } : null });
    throw e;
  } finally {
    loadP = null;
  }
}

async function unload(quiet = false) {
  clearTimeout(idleTimer);
  for (const { ctrl } of active.values()) ctrl.abort();
  const inst = w;
  w = null;
  if (inst) {
    try {
      await inst.exit();
    } catch {}
  }
  if (!quiet || st.state !== 'unloaded') setState({ state: 'unloaded', modelId: null, info: null });
}

function touch() {
  clearTimeout(idleTimer);
  if (idleMin > 0) idleTimer = setTimeout(onIdle, idleMin * 60_000);
}

async function onIdle() {
  if (active.size || loadP || st.dl?.state === 'downloading') return touch();
  await unload();
  // Nothing left to do here: ask the service worker to close this document (frees all memory).
  chrome.runtime.sendMessage({ type: 'engine:closeMe' }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Completion

async function complete({ rid, modelId, prompt, nPredict, stream }, port) {
  const t0 = performance.now();
  await load(modelId);
  const t1 = performance.now();
  if (!w) throw new EngineError('ENGINE_GONE', 'モデルが解放されました');
  const ctrl = new AbortController();
  active.set(rid, { ctrl, port });
  clearTimeout(idleTimer);
  let text = '';
  let last = null;
  const params = {
    prompt,
    max_tokens: nPredict,
    temperature: 0,
    top_k: 1,
    repeat_penalty: 1.0,
    stop: STOP,
    cache_prompt: true,
    abortSignal: ctrl.signal,
  };
  try {
    if (stream) {
      await w.createCompletion({
        ...params,
        stream: true,
        onData: (c) => {
          const t = c?.choices?.[0]?.text;
          if (t) {
            text += t;
            post(port, { k: 'delta', rid, text });
          }
          if (c?.timings) last = c;
        },
      });
    } else {
      last = await w.createCompletion(params);
      text = last?.choices?.[0]?.text || '';
    }
    return { text, timings: last?.timings || null, t: { load: Math.round(t1 - t0), infer: Math.round(performance.now() - t1) } };
  } catch (e) {
    if (ctrl.signal.aborted) throw new EngineError('ABORTED', '中断しました');
    throw new EngineError('ENGINE', '推論エラー: ' + (e?.message || e));
  } finally {
    active.delete(rid);
    touch();
  }
}

// ---------------------------------------------------------------------------
// Download (Hugging Face -> OPFS, part by part, resumable)

function setDl(dl) {
  st.dl = dl ? { ...dl } : null;
  emit('dl');
}

async function probeTotal(url, signal) {
  const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal, cache: 'no-store' });
  const cr = r.headers.get('content-range');
  await r.body?.cancel().catch(() => {});
  const total = Number((cr || '').split('/')[1]);
  if (!r.ok || !total) throw new EngineError('DOWNLOAD_FAILED', `モデルのサイズを取得できません（HTTP ${r.status}）`);
  return total;
}

async function fetchPart(url, dir, i, start, len, signal, onBytes) {
  for (let attempt = 0; ; attempt++) {
    let got = 0;
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${start + len - 1}` }, signal, cache: 'no-store' });
      if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
      const buf = new Uint8Array(len);
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        if (got + value.byteLength > len) throw new Error('想定より大きい応答');
        buf.set(value, got);
        got += value.byteLength;
        onBytes(value.byteLength);
      }
      if (got !== len) throw new Error(`途中で切断（${got}/${len} バイト）`);
      const ws = await (await dir.getFileHandle(partName(i), { create: true })).createWritable();
      await ws.write(buf);
      await ws.close();
      return;
    } catch (e) {
      onBytes(-got);
      if (signal.aborted) throw e;
      if (attempt >= 5) throw new EngineError('DOWNLOAD_FAILED', `ダウンロードに失敗しました（パート ${i}）: ${e.message || e}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function download(modelId) {
  const m = MODELS[modelId];
  if (!m) throw new EngineError('BAD_MODEL', `不明なモデルです: ${modelId}`);
  dlCtrl = new AbortController();
  const { signal } = dlCtrl;
  const url = modelUrl(m);
  const prog = { id: modelId, state: 'downloading', done: 0, total: 0, bps: 0, error: null };
  setDl(prog);
  try {
    const total = await probeTotal(url, signal);
    let meta = await readMeta(m);
    if (meta?.complete && meta.total === total) {
      setDl({ ...prog, state: 'done', done: total, total });
      return;
    }
    if (!meta || meta.total !== total || meta.partSize !== PART_SIZE || meta.url !== url) {
      if (st.modelId === modelId) await unload();
      await deleteModel(m); // stale or different upstream file: start over
      meta = { total, partSize: PART_SIZE, parts: Math.ceil(total / PART_SIZE), complete: false, url };
      await writeMeta(m, meta);
    }
    const dir = await modelDir(m, true);
    const expect = (i) => Math.min(PART_SIZE, total - i * PART_SIZE);
    const todo = [];
    let have = 0;
    for (let i = 0; i < meta.parts; i++) {
      let size = -1;
      try {
        size = (await (await dir.getFileHandle(partName(i))).getFile()).size;
      } catch {}
      if (size === expect(i)) have += size;
      else todo.push(i);
    }
    Object.assign(prog, { total, done: have });
    setDl(prog);
    let winStart = performance.now();
    let winBytes = 0;
    const onBytes = (n) => {
      prog.done += n;
      winBytes += n;
      const now = performance.now();
      if (now - winStart >= 1000) {
        prog.bps = Math.max(0, winBytes) / ((now - winStart) / 1000);
        winStart = now;
        winBytes = 0;
        setDl(prog);
      }
    };
    const worker = async () => {
      while (todo.length) {
        const i = todo.shift();
        await fetchPart(url, dir, i, i * PART_SIZE, expect(i), signal, onBytes);
      }
    };
    await Promise.all(Array.from({ length: DL_STREAMS }, worker));
    const magic = await (await (await dir.getFileHandle(partName(0))).getFile()).slice(0, 4).text();
    if (magic !== 'GGUF') throw new EngineError('BAD_FILE', 'ダウンロードしたファイルが GGUF 形式ではありません。');
    await writeMeta(m, { ...meta, complete: true, savedAt: Date.now() });
    setDl({ ...prog, state: 'done', done: total, bps: 0 });
  } catch (e) {
    const canceled = signal.aborted;
    setDl({ ...prog, state: canceled ? 'canceled' : 'error', bps: 0, error: canceled ? null : { code: e.code || 'DOWNLOAD_FAILED', message: e.message || String(e) } });
  } finally {
    dlCtrl = null;
    // a finished download is a good moment to let the service worker refresh its state
    chrome.runtime.sendMessage({ type: 'engine:dl', dl: st.dl }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// RPC

const handlers = {
  status: () => status(),
  config: ({ idleMin: v, threads }) => {
    if (threads != null && Number(threads) >= 1) nThreads = Math.floor(Number(threads));
    if (v != null && Number.isFinite(Number(v))) {
      idleMin = Number(v);
      if (w) touch();
    }
    return status();
  },
  load: async ({ modelId }) => {
    await load(modelId);
    return status();
  },
  unload: async () => {
    await unload();
    return status();
  },
  complete: (p, port) => complete(p, port),
  download: ({ modelId }) => {
    if (st.dl?.state === 'downloading') {
      if (st.dl.id === modelId) return status();
      throw new EngineError('BUSY', '別のモデルをダウンロード中です。');
    }
    download(modelId); // progress is reported through 'dl' events and status()
    return status();
  },
  cancelDownload: () => {
    dlCtrl?.abort();
    return status();
  },
  delete: async ({ modelId }) => {
    const m = MODELS[modelId];
    if (!m) throw new EngineError('BAD_MODEL', `不明なモデルです: ${modelId}`);
    if (st.dl?.state === 'downloading' && st.dl.id === modelId) {
      dlCtrl?.abort();
      while (dlCtrl) await sleep(50);
    }
    if (st.modelId === modelId) await unload();
    await deleteModel(m);
    if (st.dl?.id === modelId) setDl(null);
    return status();
  },
  logs: () => nativeLog.slice(-200),
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'engine') return;
  ports.add(port);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    for (const [, a] of active) if (a.port === port) a.ctrl.abort();
  });
  port.onMessage.addListener(async (msg) => {
    if (msg?.k === 'cancel') {
      active.get(msg.rid)?.ctrl.abort();
      return;
    }
    if (msg?.k !== 'rpc') return;
    const fn = handlers[msg.method];
    try {
      if (!fn) throw new EngineError('BAD_RPC', 'unknown method ' + msg.method);
      post(port, { k: 'rpc', n: msg.n, ok: true, result: await fn(msg.params || {}, port) });
    } catch (e) {
      post(port, { k: 'rpc', n: msg.n, ok: false, error: { code: e?.code || 'ENGINE', message: String(e?.message || e) } });
    }
  });
});

// The service worker waits for this after creating the document.
chrome.runtime.sendMessage({ type: 'engine:hello' }).catch(() => {});

// debug handle (inspect the offscreen document from chrome://inspect)
self.__engine = { status, load, unload, download, logs: () => nativeLog };

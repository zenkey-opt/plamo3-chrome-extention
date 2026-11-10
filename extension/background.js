// PLaMo 3 Translate Local — service worker.
// Runs PLaMo 3 Translate inside the browser: the model is executed by llama.cpp (WebAssembly +
// WebGPU) in an offscreen document (offscreen/engine.js). This worker owns the request queue,
// the cache and the UI plumbing for the popup, the selection card and the page translator.

import { buildPrompt, relevantGlossary, cleanOutput } from './lib/pfml.js';
import { DEFAULTS, OBSOLETE_KEYS, AUTO_ORIGINS, getSettings, onSettingsChanged, parseGlossary, siteSkipped, toggleSite } from './lib/settings.js';
import { LANGS, LANG_NAME, looksJapanese, normalizeLang } from './lib/langs.js';
import { MODELS, DEFAULT_MODEL, licenseConsent } from './lib/models.js';
import { modelStatus, deleteModel } from './lib/store.js';

const OFFSCREEN_URL = 'offscreen/engine.html';

let settings = { ...DEFAULTS };
let glossary = [];
const settingsReady = getSettings().then((s) => applySettings(s));
onSettingsChanged(applySettings);

// settings that do not change any translation (the cache survives them)
const NOT_FOR_CACHE = new Set(['autoPage', 'autoPageSkip', 'pageGlow']);

function applySettings(s, changes) {
  const prevModel = settings.model;
  settings = s;
  glossary = parseGlossary(s.glossary);
  queue.setLimit(Math.max(1, Math.min(8, Number(s.concurrency) || 8)));
  if (!changes || Object.keys(changes).some((k) => !NOT_FOR_CACHE.has(k))) cache.clear();
  if (changes?.idleUnloadMin) engineConfig();
  if (changes?.model && prevModel !== s.model) engineUnloadIfLoaded();
  if (changes?.autoPage) syncDetector();
}

const currentModel = () => MODELS[settings.model] || MODELS[DEFAULT_MODEL];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// For engine calls that must answer quickly (status checks): a stuck engine must not leave the
// popup / options page waiting forever.
function withTimeout(p, ms) {
  return Promise.race([p, sleep(ms).then(() => Promise.reject(new TranslateError('TIMEOUT', 'timeout')))]);
}

class TranslateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Request queue (bounded concurrency, two priorities)

// A worker without events stops after 30 s, and the engine sends none while it loads a model or decodes
// without streaming. The pages waiting on it would never hear back (their port also reaches the engine
// document, so it stays open and they never retry), so the worker holds on while work is outstanding.
let holdTimer = 0;
function holdWorker() {
  if (holdTimer) return;
  holdTimer = setInterval(() => {
    if (queue.active || queue.pending || rpcPending.size) chrome.runtime.getPlatformInfo().catch(() => {});
    else {
      clearInterval(holdTimer);
      holdTimer = 0;
    }
  }, 20000);
}

class Queue {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.high = [];
    this.low = [];
  }
  setLimit(n) {
    this.limit = n;
    this.pump();
  }
  run(fn, { priority = 'low', signal } = {}) {
    holdWorker();
    return new Promise((resolve, reject) => {
      (priority === 'high' ? this.high : this.low).push({ fn, resolve, reject, signal });
      this.pump();
    });
  }
  pump() {
    while (this.active < this.limit && (this.high.length || this.low.length)) {
      const job = this.high.shift() || this.low.shift();
      if (job.signal?.aborted) {
        job.reject(new DOMException('Aborted', 'AbortError'));
        continue;
      }
      this.active++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
  get pending() {
    return this.high.length + this.low.length;
  }
}

const queue = new Queue(8);

// Small LRU cache of finished translations.
class LRU {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }
  get(k) {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k, v) {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  clear() {
    this.map.clear();
  }
}
const cache = new LRU(3000);
const inflight = new Map();

// ---------------------------------------------------------------------------
// Engine (offscreen document) client

let enginePort = null;
let rpcSeq = 0;
const rpcPending = new Map(); // n -> { resolve, reject }
const streams = new Map(); // rid -> onDelta(textSoFar)
let engineStatus = null; // last status pushed by the engine
let creating = null;
let helloWaiter = null;

async function hasOffscreen() {
  const ctx = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return ctx.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = (async () => {
      const hello = new Promise((res) => {
        helloWaiter = res;
        setTimeout(res, 5000);
      });
      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: ['WORKERS'],
          justification: 'PLaMo 3 Translate をブラウザ内で実行します（llama.cpp / WebAssembly + WebGPU）。',
        });
      } catch (e) {
        if (!/single offscreen|only a single/i.test(String(e?.message))) throw e;
      }
      await hello;
    })().finally(() => {
      creating = null;
      helloWaiter = null;
    });
  }
  await creating;
}

async function getEnginePort() {
  if (enginePort) return enginePort;
  await ensureOffscreen();
  if (enginePort) return enginePort;
  const port = chrome.runtime.connect({ name: 'engine' });
  enginePort = port;
  port.onMessage.addListener(onEngineMessage);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (enginePort === port) enginePort = null;
    const err = new TranslateError('ENGINE_GONE', '翻訳エンジンとの接続が切れました。');
    for (const p of rpcPending.values()) p.reject(err);
    rpcPending.clear();
    streams.clear();
    engineStatus = null;
  });
  safePost(port, { k: 'rpc', n: ++rpcSeq, method: 'config', params: { idleMin: settings.idleUnloadMin } });
  return port;
}

function engineCall(method, params = {}, { onDelta, signal } = {}) {
  return getEnginePort().then(
    (port) =>
      new Promise((resolve, reject) => {
        const n = ++rpcSeq;
        const rid = params.rid;
        const done = () => {
          rpcPending.delete(n);
          if (rid) streams.delete(rid);
        };
        rpcPending.set(n, {
          resolve: (v) => (done(), resolve(v)),
          reject: (e) => (done(), reject(e)),
        });
        if (onDelta && rid) streams.set(rid, onDelta);
        holdWorker();
        if (signal) {
          if (signal.aborted) {
            done();
            return reject(new DOMException('Aborted', 'AbortError'));
          }
          signal.addEventListener('abort', () => safePost(port, { k: 'cancel', rid }), { once: true });
        }
        try {
          port.postMessage({ k: 'rpc', n, method, params });
        } catch (e) {
          done();
          reject(new TranslateError('ENGINE_GONE', String(e?.message || e)));
        }
      }),
  );
}

function onEngineMessage(msg) {
  if (msg.k === 'rpc') {
    const p = rpcPending.get(msg.n);
    if (!p) return;
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new TranslateError(msg.error?.code || 'ENGINE', msg.error?.message || 'engine error'));
  } else if (msg.k === 'delta') {
    streams.get(msg.rid)?.(msg.text);
  } else if (msg.k === 'event') {
    const prev = engineStatus?.state;
    engineStatus = msg.status;
    if (msg.type === 'state' && engineStatus?.state !== prev) {
      broadcast({ type: 'engine', state: engineStatus.state, model: MODELS[engineStatus.modelId]?.label || null });
    }
  }
}

async function engineConfig() {
  if (enginePort || (await hasOffscreen())) engineCall('config', { idleMin: settings.idleUnloadMin }).catch(() => {});
}

async function engineUnloadIfLoaded() {
  if (!(await hasOffscreen())) return;
  try {
    await engineCall('unload');
  } catch {}
}

async function closeEngine() {
  try {
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  } catch {}
  enginePort = null;
  engineStatus = null;
}

// open ports (popup, selection cards, page translators) are told when the model is being loaded
const openPorts = new Set();
function broadcast(msg) {
  for (const p of openPorts) safePost(p, msg);
}

let ridSeq = 0;

// One completion. Streams when onDelta is given. If the engine went away (idle unload closed
// the offscreen document, or the worker restarted), it is recreated once.
async function complete(prompt, { nPredict, onDelta, signal }) {
  const rid = `${Date.now().toString(36)}-${++ridSeq}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await engineCall(
        'complete',
        { rid, modelId: currentModel().id, prompt, nPredict, stream: !!onDelta },
        { onDelta: onDelta && ((t) => onDelta(cleanOutput(t))), signal },
      );
      return { text: r.text || '', timings: r.timings || null };
    } catch (e) {
      if (signal?.aborted || e?.code === 'ABORTED' || e?.name === 'AbortError') throw new DOMException('Aborted', 'AbortError');
      if (e?.code === 'ENGINE_GONE' && attempt < 2) {
        await sleep(150);
        continue;
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Language helpers

// CLD (chrome.i18n.detectLanguage) copes with mixed text; the kana ratio is the fallback
// for short strings CLD is unsure about.
async function detectLang(text) {
  try {
    const r = await chrome.i18n.detectLanguage(text.slice(0, 4000));
    const top = r?.languages?.[0];
    if (top && (r.isReliable || top.percentage >= 70)) {
      const l = normalizeLang(top.language);
      if (l) return l;
    }
  } catch {}
  return looksJapanese(text) ? 'ja' : null;
}

const baseLang = (c) => (c === 'ja(easy)' ? 'ja' : c);

async function resolveTarget(text, requested) {
  if (requested && requested !== 'auto') return requested;
  const detected = await detectLang(text);
  if (detected && detected === baseLang(settings.targetLang)) return settings.altTargetLang;
  return settings.targetLang;
}

// ---------------------------------------------------------------------------
// Translation

function splitLongText(text, max = 2400) {
  if (text.length <= max) return [text];
  const parts = text.split(/(\n+)/); // keep separators
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max && cur.trim()) {
      chunks.push(cur);
      cur = '';
    }
    if (p.length > max) {
      // a single huge paragraph: cut at sentence ends
      const sentences = p.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [p];
      for (const s of sentences) {
        if ((cur + s).length > max && cur) {
          chunks.push(cur);
          cur = '';
        }
        cur += s;
      }
    } else {
      cur += p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// the context window is 8192 tokens shared by all slots; keep a single answer well below that
const nPredictFor = (text) => Math.min(4096, Math.ceil(text.length * 3) + 64);

/**
 * Translate one piece of text. Long text is split into chunks and translated in order,
 * each chunk seeing the previous pair as history.
 */
async function translate({ text, target, source, context, onDelta, signal, priority = 'high', useCache = true }) {
  await settingsReady;
  const src = (text || '').replace(/\r\n?/g, '\n');
  if (!src.trim()) return { text: '', target: target || settings.targetLang };
  const tgt = await resolveTarget(src, target);
  const form = tgt === 'ja' ? settings.form || '' : ''; // the model supports form only for 'ja'
  const ctx = context || '';
  const key = JSON.stringify([currentModel().id, tgt, source || '', form, ctx, settings.glossary, src]);

  const cached = useCache ? cache.get(key) : undefined;
  if (cached !== undefined) {
    onDelta?.(cached.text);
    return { ...cached, cached: true };
  }
  if (!onDelta && inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const t0 = performance.now();
    const chunks = splitLongText(src);
    let out = '';
    let lastPair = null;
    let genTokens = 0;
    let genMs = 0;
    let promptTokens = 0;
    let promptMs = 0;
    for (const chunk of chunks) {
      const lead = chunk.match(/^\s*/)[0];
      const trail = chunk.match(/\s*$/)[0];
      const body = chunk.trim();
      if (!body) {
        out += chunk;
        continue;
      }
      const prompt = buildPrompt({
        text: body,
        target: tgt,
        source: source || undefined,
        form: form || undefined,
        context: ctx,
        glossary: relevantGlossary(glossary, body),
        history: lastPair ? [lastPair] : [],
      });
      const prefix = out + lead;
      const r = await queue.run(
        () => complete(prompt, { nPredict: nPredictFor(body), signal, onDelta: onDelta && ((t) => onDelta(prefix + t)) }),
        { priority, signal },
      );
      const piece = cleanOutput(r.text).trim();
      out = prefix + piece + trail;
      onDelta?.(out);
      if (r.timings) {
        genTokens += r.timings.predicted_n || 0;
        genMs += r.timings.predicted_ms || 0;
        promptTokens += r.timings.prompt_n || 0;
        promptMs += r.timings.prompt_ms || 0;
      }
      lastPair = body.length < 1500 ? { source: body, target: piece } : null;
    }
    const result = {
      text: out.trim(),
      target: tgt,
      ms: Math.round(performance.now() - t0),
      tokPerSec: genMs > 0 ? Math.round((genTokens / genMs) * 1000) : null,
      // engine timings (diagnostics / benchmarks)
      stats: { promptN: promptTokens, promptMs: Math.round(promptMs), genN: genTokens, genMs: Math.round(genMs) },
    };
    if (useCache) cache.set(key, result);
    return result;
  })();

  if (!onDelta) {
    inflight.set(key, job);
    job.finally(() => inflight.delete(key)).catch(() => {});
  }
  return job;
}

function errorPayload(e) {
  if (e?.name === 'AbortError') return { code: 'ABORTED', message: '中断しました' };
  return { code: e?.code || 'ERROR', message: String(e?.message || e) };
}

// ---------------------------------------------------------------------------
// Ports: 'stream' (popup / selection card) and 'page' (page translator)

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'stream' && port.name !== 'page') return;
  openPorts.add(port);
  port.onDisconnect.addListener(() => openPorts.delete(port));
  if (port.name === 'stream') handleStreamPort(port);
  else handlePagePort(port);
  if (engineStatus?.state === 'loading') safePost(port, { type: 'engine', state: 'loading', model: MODELS[engineStatus.modelId]?.label || null });
});

function handleStreamPort(port) {
  let ctrl = null;
  port.onDisconnect.addListener(() => ctrl?.abort());
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'cancel') {
      ctrl?.abort();
      return;
    }
    if (msg.type !== 'translate') return;
    ctrl?.abort();
    const my = (ctrl = new AbortController());
    const reqId = msg.reqId;
    try {
      const tgt = await resolveTarget(msg.text || '', msg.target);
      if (my.signal.aborted) return;
      safePost(port, { type: 'start', reqId, target: tgt });
      let last = 0;
      const r = await translate({
        text: msg.text,
        target: tgt,
        source: msg.source && msg.source !== 'auto' ? msg.source : undefined,
        context: msg.context,
        signal: my.signal,
        priority: 'high',
        onDelta: (t) => {
          // throttle UI updates a little
          const now = performance.now();
          if (now - last > 30) {
            last = now;
            safePost(port, { type: 'delta', reqId, text: t });
          }
        },
      });
      safePost(port, { type: 'done', reqId, ...r });
    } catch (e) {
      if (my.signal.aborted) return;
      safePost(port, { type: 'error', reqId, ...errorPayload(e) });
    }
  });
}

function handlePagePort(port) {
  const ctrl = new AbortController();
  port.onDisconnect.addListener(() => ctrl.abort());
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'cancel') {
      ctrl.abort();
      return;
    }
    if (msg.type !== 'tr') return;
    try {
      const r = await translate({
        text: msg.text,
        target: msg.target,
        context: msg.context,
        signal: ctrl.signal,
        priority: 'low',
      });
      safePost(port, { type: 'res', id: msg.id, text: r.text, cached: !!r.cached });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      safePost(port, { type: 'err', id: msg.id, ...errorPayload(e) });
    }
  });
}

function safePost(port, msg) {
  try {
    port.postMessage(msg);
  } catch {}
}

// ---------------------------------------------------------------------------
// Status / model management

async function allModels() {
  const out = {};
  for (const m of Object.values(MODELS)) {
    try {
      out[m.id] = await modelStatus(m);
    } catch {
      out[m.id] = { present: false };
    }
  }
  return out;
}

async function getStatus() {
  await settingsReady;
  const m = currentModel();
  let eng = null;
  let engineHung = false;
  if (enginePort || (await hasOffscreen())) {
    try {
      eng = await withTimeout(engineCall('status'), 4000);
    } catch (e) {
      engineHung = e?.code === 'TIMEOUT';
    }
  }
  const models = await allModels();
  const dl = eng?.dl || null;
  let state;
  if (eng?.state === 'loading') state = 'loading';
  else if (eng?.state === 'ready' && eng.modelId === m.id) state = 'ready';
  else if (dl?.state === 'downloading' && dl.id === m.id) state = 'downloading';
  else if (!models[m.id]?.present) state = 'nomodel';
  else if (eng?.state === 'error' || engineHung) state = 'error';
  else state = 'idle';
  let storage = null;
  try {
    storage = await navigator.storage.estimate();
  } catch {}
  return {
    state,
    modelId: m.id,
    model: m.label,
    loadedModel: eng?.state === 'ready' ? MODELS[eng.modelId]?.label || null : null,
    info: eng?.state === 'ready' ? eng.info : null,
    // Not called "error": the pages read { error } as "this request failed" (see errorPayload).
    engineError: engineHung
      ? { code: 'ENGINE_HUNG', message: '翻訳エンジンが応答しません。設定画面の「VRAM を解放」を押すと、エンジンを作り直せます。' }
      : eng?.state === 'error'
        ? eng.error || null
        : null,
    dl,
    models,
    storageUsed: storage?.usage ?? null,
    webgpu: 'gpu' in navigator,
    idleUnloadMin: settings.idleUnloadMin,
    queue: { active: queue.active, pending: queue.pending },
  };
}

async function loadModelNow() {
  await settingsReady;
  await engineCall('load', { modelId: currentModel().id });
  return getStatus();
}

async function unloadModelNow() {
  if (await hasOffscreen()) {
    try {
      const s = await withTimeout(engineCall('status'), 4000);
      if (s?.dl?.state === 'downloading') {
        // keep the document (and the download) alive, only give the VRAM back
        await withTimeout(engineCall('unload'), 15000);
        return getStatus();
      }
    } catch {}
    // closing the document frees everything, and also recovers an engine that stopped answering
    await closeEngine();
  }
  return getStatus();
}

async function downloadModel(modelId) {
  if (!MODELS[modelId]) throw new TranslateError('BAD_MODEL', '不明なモデルです');
  // the options page asks for the agreement first; this keeps every other caller from skipping it
  if (!(await licenseConsent())) {
    throw new TranslateError('LICENSE_NOT_ACCEPTED', 'ダウンロードするには、PLaMo コミュニティライセンス契約への同意が必要です。');
  }
  await engineCall('download', { modelId });
  return getStatus();
}

async function cancelDownload() {
  if (await hasOffscreen()) await engineCall('cancelDownload');
  return getStatus();
}

async function removeModel(modelId) {
  const m = MODELS[modelId];
  if (!m) throw new TranslateError('BAD_MODEL', '不明なモデルです');
  if (await hasOffscreen()) await engineCall('delete', { modelId });
  else await deleteModel(m);
  return getStatus();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'engine:hello':
        helloWaiter?.();
        return undefined;
      case 'engine:closeMe': {
        // idle unload finished in the engine; close the document unless something started meanwhile
        const s = enginePort ? await engineCall('status').catch(() => null) : null;
        if (!s || (s.state === 'unloaded' && !s.active && s.dl?.state !== 'downloading')) await closeEngine();
        return undefined;
      }
      case 'engine:dl':
        return undefined;
      case 'status':
        return getStatus();
      case 'loadModel':
        return loadModelNow();
      case 'unloadModel':
        return unloadModelNow();
      case 'downloadModel':
        return downloadModel(msg.modelId || currentModel().id);
      case 'cancelDownload':
        return cancelDownload();
      case 'deleteModel':
        return removeModel(msg.modelId);
      case 'pageState': {
        const tabId = msg.tabId ?? sender.tab?.id;
        return queryPageState(tabId);
      }
      case 'togglePage': {
        const tab = await chrome.tabs.get(msg.tabId);
        return togglePage(tab, msg.force);
      }
      case 'autoPage':
        // content/detect.js: this page is not in the target language
        return sender.tab && sender.frameId === 0 ? autoPage(sender.tab, msg.lang) : undefined;
      case 'autoPageSkip': {
        await settingsReady;
        const autoPageSkip = toggleSite(settings.autoPageSkip, msg.host, !!msg.skip);
        await chrome.storage.local.set({ autoPageSkip });
        return { ok: true, autoPageSkip };
      }
      case 'setPageMode': {
        await chrome.storage.local.set({ pageMode: msg.mode });
        try {
          await chrome.tabs.sendMessage(msg.tabId, { type: 'plamo:setMode', mode: msg.mode }, { frameId: 0 });
        } catch {}
        return { ok: true };
      }
      case 'pageStateChanged':
        if (sender.tab) await setTabState(sender.tab.id, msg.active);
        return { ok: true };
      case 'pageSettings':
        await settingsReady;
        return { targetLang: settings.targetLang, altTargetLang: settings.altTargetLang, pageMode: settings.pageMode, pageGlow: settings.pageGlow, useTitleContext: settings.useTitleContext };
      case 'detectLang':
        return { lang: await detectLang(msg.text || '') };
      case 'openOptions':
        chrome.runtime.openOptionsPage();
        return { ok: true };
      default:
        return undefined;
    }
  })().then(
    (r) => sendResponse(r),
    (e) => sendResponse({ error: errorPayload(e) }),
  );
  return true;
});

// ---------------------------------------------------------------------------
// Page translation control

async function inject(tabId, files, frameId = 0) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files });
}

async function queryPageState(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'plamo:pageState' }, { frameId: 0 });
    return r || { active: false };
  } catch {
    return { active: false, injected: false };
  }
}

// pageLang: the page language when the caller already knows it (content/detect.js)
async function togglePage(tab, force, pageLang) {
  await settingsReady;
  try {
    await inject(tab.id, ['content/page.js']);
  } catch (e) {
    return { error: { code: 'NO_ACCESS', message: 'このページは翻訳できません。' } };
  }
  const r = await chrome.tabs.sendMessage(tab.id, { type: 'plamo:togglePage', force, pageLang }, { frameId: 0 });
  await setTabState(tab.id, !!r?.active);
  return r;
}

async function setTabState(tabId, active) {
  try {
    await chrome.action.setBadgeText({ tabId, text: active ? '訳' : '' });
    if (active) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#165e83' });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
  } catch {}
  await chrome.storage.session.set({ ['tab:' + tabId]: !!active });
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id === tabId) updatePageMenu(active);
}

function updatePageMenu(active) {
  chrome.contextMenus.update('plamo-page', { title: active ? '原文に戻す' : 'PLaMo でこのページを翻訳' }, () => void chrome.runtime.lastError);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const s = await chrome.storage.session.get('tab:' + tabId);
  updatePageMenu(!!s['tab:' + tabId]);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    chrome.storage.session.remove('tab:' + tabId);
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => {
      if (t?.id === tabId) updatePageMenu(false);
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove('tab:' + tabId));

// ---------------------------------------------------------------------------
// Pages in another language (settings.autoPage). content/detect.js runs on every page while the
// setting is on and the optional access to all sites is granted; it reports pages that are not in
// the target language, and this either offers page translation in the page's pill or starts it.

const DETECT = { id: 'plamo-detect', matches: AUTO_ORIGINS, js: ['content/detect.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true };
let detectorSync = Promise.resolve();

// register / unregister to match the setting and the granted access; refresh rewrites it after an update
function syncDetector(refresh = false) {
  detectorSync = detectorSync
    .then(async () => {
      await settingsReady;
      const on = settings.autoPage === 'ask' || settings.autoPage === 'auto';
      const granted = on && (await chrome.permissions.contains({ origins: AUTO_ORIGINS }));
      const have = (await chrome.scripting.getRegisteredContentScripts({ ids: [DETECT.id] })).length > 0;
      if (granted && !have) await chrome.scripting.registerContentScripts([DETECT]);
      else if (granted && refresh) await chrome.scripting.updateContentScripts([DETECT]);
      else if (!granted && have) await chrome.scripting.unregisterContentScripts({ ids: [DETECT.id] });
    })
    .catch((e) => console.warn('content script registration:', e));
  return detectorSync;
}
syncDetector();
chrome.permissions.onAdded.addListener(() => syncDetector());
chrome.permissions.onRemoved.addListener(() => syncDetector());

function webHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : '';
  } catch {
    return '';
  }
}

async function autoPage(tab, lang) {
  await settingsReady;
  const mode = settings.autoPage;
  if (mode !== 'ask' && mode !== 'auto') return { skipped: 'off' };
  const host = webHost(tab.url);
  if (!host || siteSkipped(host, settings.autoPageSkip)) return { skipped: 'site' };
  const from = normalizeLang(lang);
  // a language the model does not know, or the target language after all
  if (!from || from === baseLang(settings.targetLang)) return { skipped: 'lang' };
  if (!(await modelStatus(currentModel()).catch(() => null))?.present) return { skipped: 'nomodel' };
  if (mode === 'auto') return togglePage(tab, 'on', from);
  await inject(tab.id, ['content/page.js']);
  const to = LANG_NAME[settings.targetLang] || settings.targetLang;
  return chrome.tabs.sendMessage(tab.id, { type: 'plamo:offer', lang: from, from: LANG_NAME[from], to }, { frameId: 0 });
}

// ---------------------------------------------------------------------------
// Selection translation

// fromKey: invoked by the keyboard shortcut -> with nothing selected, toggle page translation instead
async function showSelection(tab, info = {}, fromKey = false) {
  const frameId = info.frameId || 0;
  try {
    await inject(tab.id, ['content/selection.js'], frameId);
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'plamo:showSelection', fallbackText: info.selectionText || '', langs: LANGS }, { frameId });
    if (r?.empty) {
      if (fromKey) await togglePage(tab);
      else {
        try {
          await chrome.action.openPopup();
        } catch {}
      }
    }
  } catch {
    // PDF viewer, store pages, chrome:// … -> standalone window
    if (info.selectionText) openTranslateWindow(info.selectionText);
    else {
      try {
        await chrome.action.openPopup();
      } catch {}
    }
  }
}

async function openTranslateWindow(text) {
  await chrome.storage.session.set({ pendingText: text });
  await chrome.windows.create({ url: chrome.runtime.getURL('popup/popup.html?window=1'), type: 'popup', width: 460, height: 620 });
}

// ---------------------------------------------------------------------------
// Context menus & keyboard commands

chrome.runtime.onInstalled.addListener(async (details) => {
  syncDetector(true);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'plamo-selection', title: 'PLaMo で翻訳「%s」', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'plamo-page', title: 'PLaMo でこのページを翻訳', contexts: ['page', 'frame', 'link', 'image'] });
  });
  await chrome.storage.local.remove(OBSOLETE_KEYS);
  if (details.reason === 'install' || details.reason === 'update') {
    await settingsReady;
    const st = await modelStatus(currentModel()).catch(() => ({ present: false }));
    if (!st.present) chrome.runtime.openOptionsPage(); // the model has to be downloaded once
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'plamo-selection') showSelection(tab, info);
  else if (info.menuItemId === 'plamo-page') togglePage(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab) return;
  if (command === 'translate-selection') showSelection(tab, {}, true);
  else if (command === 'translate-page') togglePage(tab);
});

// Debug / test hooks (inspectable from the service worker console).
self.__plamo = { translate, getStatus, engineCall, closeEngine, togglePage, showSelection, queue, cache, detectLang, resolveTarget, autoPage, syncDetector };

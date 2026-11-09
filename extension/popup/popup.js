import { LANGS, langName } from '../lib/langs.js';
import { getSettings, saveSettings } from '../lib/settings.js';

const $ = (s) => document.querySelector(s);
const isWindow = new URLSearchParams(location.search).has('window');
if (isWindow) document.body.classList.add('window');

const el = {
  status: $('#status'),
  statusLabel: $('#status .label'),
  opts: $('#opts'),
  src: $('#src'),
  tgt: $('#tgt'),
  swap: $('#swap'),
  input: $('#input'),
  output: $('#output'),
  meta: $('#meta'),
  copy: $('#copy'),
  pageBtn: $('#pageBtn'),
  seg: [...document.querySelectorAll('.seg button')],
  model: $('#model'),
  keys: $('#keys'),
};

let settings;
let port = null;
let reqId = 0;
let pending = null; // last request (re-sent if the service worker restarts mid-way)
let lastResult = '';
let tab = null;
let pageActive = false;
let debounce = 0;
let composing = false;

const STATUS_TEXT = {
  checking: '確認中…',
  ready: '準備完了',
  idle: '待機中',
  loading: 'モデル読み込み中…',
  downloading: 'ダウンロード中…',
  nomodel: 'モデル未取得',
  error: 'エラー',
};

init();

async function init() {
  settings = await getSettings();
  fillLangs();
  const sess = await chrome.storage.session.get(['popupInput', 'popupSrc', 'popupTgt', 'pendingText']);
  if (sess.pendingText) {
    el.input.value = sess.pendingText;
    chrome.storage.session.remove('pendingText');
  } else if (sess.popupInput) {
    el.input.value = sess.popupInput;
  }
  el.src.value = sess.popupSrc && hasOption(el.src, sess.popupSrc) ? sess.popupSrc : 'auto';
  el.tgt.value = sess.popupTgt && hasOption(el.tgt, sess.popupTgt) ? sess.popupTgt : 'auto';
  autoGrow();
  setModeButtons(settings.pageMode);
  bind();
  el.input.focus();
  el.input.setSelectionRange(el.input.value.length, el.input.value.length);
  if (el.input.value.trim()) translateNow();
  showShortcuts();
  refreshStatus();
  setInterval(refreshStatus, 1500);
  if (!isWindow) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    refreshPage();
  }
}

// footer: the shortcuts actually bound (the user may change them in brave://extensions/shortcuts)
async function showShortcuts() {
  const cmds = await chrome.commands.getAll();
  const kbd = (s) => s.split('+').map((k) => `<kbd>${k}</kbd>`).join('+');
  const parts = [];
  const sel = cmds.find((c) => c.name === 'translate-selection')?.shortcut;
  const page = cmds.find((c) => c.name === 'translate-page')?.shortcut;
  if (sel) parts.push(`${kbd(sel)} 選択`);
  if (page) parts.push(`${kbd(page)} ページ`);
  el.keys.innerHTML = parts.join(' · ');
  el.keys.title = '未選択で ' + (sel || '選択翻訳キー') + ' を押すとページ翻訳を切り替えます';
}

function hasOption(select, v) {
  return [...select.options].some((o) => o.value === v);
}

function fillLangs() {
  const opts = LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  el.src.innerHTML = `<option value="auto">自動検出</option>${opts}`;
  el.tgt.innerHTML =
    `<option value="auto">自動（${langName(settings.targetLang)} ⇄ ${langName(settings.altTargetLang)}）</option>` + opts;
}

function bind() {
  el.input.addEventListener('compositionstart', () => (composing = true));
  el.input.addEventListener('compositionend', () => {
    composing = false;
    schedule();
  });
  el.input.addEventListener('input', () => {
    autoGrow();
    chrome.storage.session.set({ popupInput: el.input.value });
    if (!composing) schedule();
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      translateNow();
    }
  });
  for (const s of [el.src, el.tgt]) {
    s.addEventListener('change', () => {
      chrome.storage.session.set({ popupSrc: el.src.value, popupTgt: el.tgt.value });
      translateNow();
    });
  }
  el.swap.addEventListener('click', () => {
    const s = el.src.value;
    const t = el.tgt.value;
    if (lastResult) el.input.value = lastResult;
    if (s !== 'auto' && t !== 'auto') {
      el.src.value = t;
      el.tgt.value = s;
    } else if (t !== 'auto') {
      el.src.value = t;
      el.tgt.value = 'auto';
    } else if (s !== 'auto') {
      el.tgt.value = s;
      el.src.value = 'auto';
    }
    chrome.storage.session.set({ popupInput: el.input.value, popupSrc: el.src.value, popupTgt: el.tgt.value });
    autoGrow();
    translateNow();
  });
  el.copy.addEventListener('click', async () => {
    if (!lastResult) return;
    await navigator.clipboard.writeText(lastResult);
    const old = el.meta.textContent;
    el.meta.textContent = 'コピーしました';
    setTimeout(() => (el.meta.textContent = old), 1100);
  });
  el.opts.addEventListener('click', () => chrome.runtime.openOptionsPage());
  el.status.addEventListener('click', () => {
    if (el.status.dataset.action === 'options') chrome.runtime.openOptionsPage();
  });
  el.pageBtn.addEventListener('click', async () => {
    if (!tab) return;
    el.pageBtn.disabled = true;
    const r = await chrome.runtime.sendMessage({ type: 'togglePage', tabId: tab.id });
    if (r?.error) {
      el.pageBtn.disabled = false;
      el.pageBtn.title = r.error.message;
      showError(r.error.message);
      return;
    }
    window.close();
  });
  for (const b of el.seg) {
    b.addEventListener('click', async () => {
      setModeButtons(b.dataset.mode);
      if (pageActive && tab) await chrome.runtime.sendMessage({ type: 'setPageMode', tabId: tab.id, mode: b.dataset.mode });
      else await saveSettings({ pageMode: b.dataset.mode });
    });
  }
}

function setModeButtons(mode) {
  for (const b of el.seg) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
}

function autoGrow() {
  if (isWindow) return;
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(220, Math.max(92, el.input.scrollHeight)) + 'px';
}

function schedule() {
  clearTimeout(debounce);
  debounce = setTimeout(translateNow, 450);
}

function getPort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: 'stream' });
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    if (pending) setTimeout(() => pending && send(pending), 200);
  });
  return port;
}

function send(req) {
  pending = req;
  getPort().postMessage(req);
}

function translateNow() {
  clearTimeout(debounce);
  const text = el.input.value;
  if (!text.trim()) {
    reqId++;
    pending = null;
    try {
      port?.postMessage({ type: 'cancel' });
    } catch {}
    el.output.textContent = '';
    el.output.className = 'output';
    el.meta.textContent = '';
    el.copy.disabled = true;
    lastResult = '';
    return;
  }
  reqId++;
  el.output.classList.add('streaming');
  el.output.classList.remove('err');
  send({ type: 'translate', reqId, text, target: el.tgt.value, source: el.src.value });
}

function onMessage(m) {
  if (m.type === 'engine') {
    if (m.state === 'loading') {
      el.meta.textContent = '翻訳モデルを読み込んでいます（数秒）…';
      setStatus({ state: 'loading' });
    } else refreshStatus();
    return;
  }
  if (m.reqId !== reqId) return;
  if (m.type === 'start') {
    el.meta.textContent = `→ ${langName(m.target)}`;
  } else if (m.type === 'delta') {
    el.output.textContent = m.text;
  } else if (m.type === 'done') {
    pending = null;
    lastResult = m.text;
    el.output.className = 'output';
    el.output.textContent = m.text;
    el.copy.disabled = !m.text;
    const parts = [`→ ${langName(m.target)}`];
    if (m.cached) parts.push('キャッシュ');
    else {
      if (m.ms != null) parts.push(`${(m.ms / 1000).toFixed(2)} 秒`);
      if (m.tokPerSec) parts.push(`${m.tokPerSec} tok/s`);
    }
    el.meta.textContent = parts.join(' · ');
  } else if (m.type === 'error') {
    pending = null;
    showError(m.message);
  }
}

function showError(message) {
  el.output.className = 'output err';
  el.output.textContent = message;
  el.copy.disabled = true;
  lastResult = '';
}

function setStatus(s) {
  const state = s.state || 'error';
  el.status.dataset.state = state;
  el.statusLabel.textContent = state === 'downloading' && s.dl?.total ? `ダウンロード中 ${Math.floor((s.dl.done / s.dl.total) * 100)}%` : STATUS_TEXT[state] || state;
  el.status.dataset.action = ['nomodel', 'error', 'downloading'].includes(state) ? 'options' : '';
  const lines = [];
  if (s.info) lines.push(`${s.info.backend}${s.info.gpu ? `（${s.info.gpu}）` : ''} · 読み込み ${(s.info.loadMs / 1000).toFixed(1)} 秒`);
  if (state === 'idle') lines.push('モデルは未読み込み。次の翻訳で自動的に読み込みます（数秒）。');
  if (state === 'nomodel') lines.push('翻訳モデルがまだダウンロードされていません。クリックで設定画面を開きます。');
  if (state === 'downloading') lines.push('クリックで設定画面（進み具合）を開きます。');
  const err = s.engineError || s.error;
  if (state === 'error' && err) lines.push(err.message);
  if (s.queue && (s.queue.active || s.queue.pending)) lines.push(`処理中 ${s.queue.active} / 待ち ${s.queue.pending}`);
  el.status.title = lines.join('\n') || 'PLaMo 3 Translate（ブラウザ内で実行）';
  if (s.model) el.model.textContent = `PLaMo 3 Translate ${s.model}`;
}

async function refreshStatus() {
  try {
    // bounded: a worker that never answers must not leave the pill at "確認中…"
    const s = await Promise.race([
      chrome.runtime.sendMessage({ type: 'status' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('拡張機能から応答がありません')), 8000)),
    ]);
    setStatus(typeof s?.state === 'string' ? s : { state: 'error', error: s?.error || { message: '状態を取得できませんでした' } });
  } catch (e) {
    setStatus({ state: 'error', error: { message: String(e?.message || e) } });
  }
}

async function refreshPage() {
  const url = tab?.url || '';
  const ok = /^(https?|file):/.test(url) && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
  if (!ok) {
    el.pageBtn.disabled = true;
    el.pageBtn.title = 'このページでは使えません';
    return;
  }
  const st = await chrome.runtime.sendMessage({ type: 'pageState', tabId: tab.id });
  pageActive = !!st?.active;
  el.pageBtn.textContent = pageActive ? '原文に戻す' : 'このページを翻訳';
  el.pageBtn.dataset.on = String(pageActive);
  if (pageActive && st.mode) setModeButtons(st.mode);
}

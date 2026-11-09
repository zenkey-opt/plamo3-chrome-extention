import { LANGS } from '../lib/langs.js';
import { DEFAULTS, getSettings, saveSettings, parseGlossary } from '../lib/settings.js';
import { MODELS, fmtBytes } from '../lib/models.js';

const $ = (s) => document.querySelector(s);
let settings;
let savedTimer = 0;
let last = null; // last status
let busy = false; // an action button is running

const STATUS_TEXT = {
  checking: '確認中…',
  ready: '準備完了（読み込み済み）',
  idle: '待機中（次の翻訳で自動的に読み込みます）',
  loading: 'モデル読み込み中…',
  downloading: 'ダウンロード中…',
  nomodel: 'モデル未ダウンロード',
  error: 'エラー',
};

init();

async function init() {
  settings = await getSettings();
  const opts = LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  $('#targetLang').innerHTML = opts;
  $('#altTargetLang').innerHTML = opts;
  $('#targetLang').value = settings.targetLang;
  $('#altTargetLang').value = settings.altTargetLang;
  $('#concurrency').value = settings.concurrency;
  $('#idleUnloadMin').value = settings.idleUnloadMin;
  $('#useTitleContext').checked = !!settings.useTitleContext;
  $('#glossary').value = settings.glossary;
  setSeg('#form', settings.form);
  setSeg('#pageMode', settings.pageMode);
  renderModels();

  $('#targetLang').addEventListener('change', (e) => save({ targetLang: e.target.value }));
  $('#altTargetLang').addEventListener('change', (e) => save({ altTargetLang: e.target.value }));
  $('#useTitleContext').addEventListener('change', (e) => save({ useTitleContext: e.target.checked }));
  $('#concurrency').addEventListener('change', (e) => {
    const n = Math.max(1, Math.min(8, Math.round(Number(e.target.value) || DEFAULTS.concurrency)));
    e.target.value = n;
    save({ concurrency: n });
  });
  $('#idleUnloadMin').addEventListener('change', (e) => {
    const n = Math.max(0, Math.min(240, Math.round(Number(e.target.value))));
    e.target.value = Number.isFinite(n) ? n : DEFAULTS.idleUnloadMin;
    save({ idleUnloadMin: Number(e.target.value) });
  });
  let gTimer = 0;
  $('#glossary').addEventListener('input', (e) => {
    clearTimeout(gTimer);
    gTimer = setTimeout(() => {
      const n = parseGlossary(e.target.value).length;
      save({ glossary: e.target.value }, `用語集を保存しました（${n} 語）`);
    }, 500);
  });
  bindSeg('#form', (v) => save({ form: v }));
  bindSeg('#pageMode', (v) => save({ pageMode: v }));

  $('#btnLoad').addEventListener('click', () =>
    act('モデルを読み込んでいます…', { type: 'loadModel' }, (s) => (s.info ? `読み込みました（${(s.info.loadMs / 1000).toFixed(1)} 秒）` : '')),
  );
  $('#btnUnload').addEventListener('click', () => act('解放しています…', { type: 'unloadModel' }, () => '解放しました'));
  $('#dlCancel').addEventListener('click', () => act('', { type: 'cancelDownload' }, () => 'ダウンロードを中止しました'));
  $('#btnShortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

  const cmds = await chrome.commands.getAll();
  const sc = (name) => cmds.find((c) => c.name === name)?.shortcut || '未設定';
  $('#scSel').textContent = sc('translate-selection');
  $('#scPage').textContent = sc('translate-page');

  refresh();
  setInterval(refresh, 1000);
}

// ---------------------------------------------------------------------------
// Models

function renderModels() {
  $('#models').innerHTML = Object.values(MODELS)
    .map(
      (m) => `
    <div class="model" data-id="${m.id}">
      <label class="mpick">
        <input type="radio" name="model" value="${m.id}" />
        <span class="mtext"><span class="mname">PLaMo 3 Translate ${m.label}</span><span class="mnote">${m.note}</span></span>
      </label>
      <span class="mstate">—</span>
      <span class="mbtns">
        <button class="ghost small" data-act="download" hidden>ダウンロード</button>
        <button class="ghost small" data-act="delete" hidden>削除</button>
      </span>
    </div>`,
    )
    .join('');
  for (const r of document.querySelectorAll('#models input[type=radio]')) {
    r.checked = r.value === settings.model;
    r.addEventListener('change', () => {
      save({ model: r.value }, 'モデルを切り替えました（次の翻訳から使います）');
      refresh();
    });
  }
  for (const b of document.querySelectorAll('#models button')) {
    b.addEventListener('click', () => {
      const id = b.closest('.model').dataset.id;
      if (b.dataset.act === 'download') {
        act('', { type: 'downloadModel', modelId: id }, () => '');
      } else if (confirm(`PLaMo 3 Translate ${MODELS[id].label} を削除しますか？（再度使うにはダウンロードが必要です）`)) {
        act('削除しています…', { type: 'deleteModel', modelId: id }, () => '削除しました');
      }
    });
  }
}

function showModels(s) {
  for (const row of document.querySelectorAll('#models .model')) {
    const id = row.dataset.id;
    const m = MODELS[id];
    const ms = s.models?.[id] || {};
    const dl = s.dl?.id === id && s.dl.state === 'downloading';
    row.dataset.selected = String(id === settings.model);
    row.querySelector('input').checked = id === settings.model;
    const stEl = row.querySelector('.mstate');
    if (dl) stEl.textContent = 'ダウンロード中';
    else if (ms.present) stEl.innerHTML = `<span class="ok">ダウンロード済み</span>（${fmtBytes(ms.size)}）`;
    else if (ms.partial) stEl.textContent = '途中まで（再開できます）';
    else stEl.textContent = `未ダウンロード（約 ${fmtBytes(m.approxBytes)}）`;
    const bDl = row.querySelector('[data-act=download]');
    const bDel = row.querySelector('[data-act=delete]');
    bDl.hidden = !!ms.present || dl;
    bDl.textContent = ms.partial ? '再開' : 'ダウンロード';
    bDl.disabled = busy || s.dl?.state === 'downloading';
    bDel.hidden = !(ms.present || ms.partial) || dl;
    bDel.disabled = busy;
  }
}

function showDownload(s) {
  const box = $('#dl');
  const d = s.dl;
  if (!d || d.state === 'done' || d.state === 'canceled') {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const name = MODELS[d.id]?.label || d.id;
  if (d.state === 'error') {
    $('#dlBar').style.width = '0%';
    $('#dlText').innerHTML = `<span class="bad">${escapeHtml(name)} のダウンロードに失敗しました: ${escapeHtml(d.error?.message || '')}</span>`;
    $('#dlCancel').hidden = true;
    return;
  }
  const pct = d.total ? (d.done / d.total) * 100 : 0;
  $('#dlBar').style.width = pct.toFixed(1) + '%';
  const parts = [`${name}: ${fmtBytes(d.done)} / ${fmtBytes(d.total)}（${pct.toFixed(0)}%）`];
  if (d.bps > 0) {
    parts.push(`${(d.bps / 1048576).toFixed(1)} MB/s`);
    const rest = (d.total - d.done) / d.bps;
    if (Number.isFinite(rest)) parts.push(`残り約 ${rest >= 60 ? Math.ceil(rest / 60) + ' 分' : Math.ceil(rest) + ' 秒'}`);
  }
  $('#dlText').textContent = parts.join(' · ');
  $('#dlCancel').hidden = false;
}

// ---------------------------------------------------------------------------
// Status

function showStatus(s) {
  last = s;
  const st = $('#st');
  st.dataset.state = s.state || 'error';
  st.querySelector('.label').textContent = STATUS_TEXT[s.state] || s.state;
  const known = !!s.models; // false: the status request itself failed, nothing below is known
  if (s.info) {
    $('#stBackend').textContent = `${s.info.backend}${s.info.gpu ? `（${s.info.gpu}）` : ''}${s.info.offloaded ? ` · GPU に ${s.info.offloaded} 層` : ''}`;
    $('#stBuild').textContent = `${s.info.libllama}（wllama・WebGPU）· コンテキスト ${s.info.nCtx} · ${s.info.slots} 並列 · 読み込み ${(s.info.loadMs / 1000).toFixed(1)} 秒`;
  } else {
    $('#stBackend').textContent = !known ? '—' : s.webgpu ? 'WebGPU（モデル読み込み時に使用）' : 'WebGPU 非対応のブラウザです（CPU で実行・低速）';
    $('#stBuild').textContent = '—';
  }
  $('#stStorage').textContent = s.storageUsed != null ? fmtBytes(s.storageUsed) : '—';
  const err = s.engineError || s.error;
  if (s.state === 'error' && err) $('#stMsg').textContent = err.message;
  else if (s.state === 'nomodel' && !busy) $('#stMsg').textContent = '使うモデルを選んで「ダウンロード」を押してください。';
  else if ($('#stMsg').dataset.sticky !== '1') $('#stMsg').textContent = '';
  $('#btnLoad').disabled = busy || !['idle', 'error'].includes(s.state);
  $('#btnUnload').disabled = busy || !['ready', 'error'].includes(s.state);
  if (!known) {
    // nothing is known about the models: no stale states, no buttons to act on them
    for (const row of document.querySelectorAll('#models .model')) {
      row.querySelector('.mstate').textContent = '—';
      for (const b of row.querySelectorAll('.mbtns button')) b.hidden = true;
    }
    return;
  }
  showModels(s);
  showDownload(s);
}

// sendMessage never settles if the worker does not answer: bound it, so the page never sits at
// "確認中…" without saying why
function ask(msg, ms) {
  return Promise.race([
    chrome.runtime.sendMessage(msg),
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { timeout: true })), ms)),
  ]);
}

let polling = false;
async function refresh() {
  if (polling) return; // one status request at a time (the poll runs every second)
  polling = true;
  try {
    const s = await ask({ type: 'status' }, 8000);
    if (typeof s?.state === 'string') showStatus(s);
    else showStatus({ state: 'error', error: { message: '状態を取得できませんでした: ' + (s?.error?.message || '応答が空です') } });
  } catch (e) {
    let message = String(e?.message || e);
    if (e?.timeout) {
      // is the service worker itself alive? (unknown message types are answered right away)
      const alive = await ask({ type: 'ping' }, 3000).then(() => true, () => false);
      message = alive
        ? '翻訳エンジンが応答しません（8 秒以上）。'
        : '拡張機能のバックグラウンド処理が応答しません。brave://extensions でこの拡張機能を再読み込みしてください。';
    }
    showStatus({ state: 'error', error: { message } });
  } finally {
    polling = false;
  }
}

async function act(pendingMsg, msg, okMsg) {
  busy = true;
  const m = $('#stMsg');
  m.dataset.sticky = '1';
  m.textContent = pendingMsg;
  if (last) showStatus(last);
  try {
    const r = await chrome.runtime.sendMessage(msg);
    if (r?.error && typeof r.state !== 'string') m.textContent = r.error.message;
    else {
      m.textContent = okMsg(r) || '';
      if (r) showStatus(r);
    }
  } catch (e) {
    m.textContent = String(e?.message || e);
  } finally {
    busy = false;
    setTimeout(() => (m.dataset.sticky = ''), 4000);
    refresh();
  }
}

// ---------------------------------------------------------------------------

function setSeg(sel, v) {
  for (const b of document.querySelectorAll(`${sel} button`)) b.setAttribute('aria-pressed', String(b.dataset.v === v));
}
function bindSeg(sel, cb) {
  for (const b of document.querySelectorAll(`${sel} button`)) {
    b.addEventListener('click', () => {
      setSeg(sel, b.dataset.v);
      cb(b.dataset.v);
    });
  }
}

async function save(patch, msg = '保存しました') {
  await saveSettings(patch);
  Object.assign(settings, patch);
  const s = $('#saved');
  s.textContent = msg;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (s.textContent = ''), 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// the page-mode toggle also lives in the popup / page pill
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.pageMode) setSeg('#pageMode', ch.pageMode.newValue);
});

// Minimal CDP driver for testing the extension in an isolated Brave profile.
// usage: node cdp.mjs <cmd> [...args]   (CDP_PORT env, default 9333)
//   targets | open <url> | close <match> | sw <js> | page <match> <js> | iso <match> <js>
//   shot <match> <file> [w h] | key <match> <key> [modifiers] | click <match> <x> <y>
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9333;
const BASE = `http://127.0.0.1:${PORT}`;
const EXT_NAME = 'PLaMo 3 Translate Local';

async function list() {
  return (await fetch(BASE + '/json/list')).json();
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error('ws error ' + (e?.message || '')));
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else listeners.forEach((l) => l(m));
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, on: (f) => listeners.push(f), close: () => ws.close() };
}

async function findTarget(match, type) {
  const ts = await list();
  const t = ts.find((t) => (!type || t.type === type) && (t.url.includes(match) || t.title.includes(match) || t.id === match || (match.length >= 8 && t.id.startsWith(match))));
  if (!t) throw new Error(`no target matching ${match}\n` + ts.map((t) => `${t.type} ${t.url}`).join('\n'));
  return t;
}

// The MV3 service worker stops after ~30 s idle; wake it with a message from any extension page.
async function swTarget() {
  for (let i = 0; i < 20; i++) {
    const ts = await list();
    const sw = ts.find((t) => t.type === 'service_worker' && t.url.includes('background.js'));
    if (sw) return sw;
    const pg = ts.find((t) => /^chrome-extension:\/\/[^/]+\/(?!offscreen)/.test(t.url) && (t.type === 'page' || t.type === 'background_page'));
    if (!pg) throw new Error('service worker is stopped and no extension page is open to wake it');
    if (i === 0) await evalIn(pg, "chrome.runtime.sendMessage({ type: 'status' }).then(() => 1, () => 0)").catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('service worker did not start');
}

function unwrap(r) {
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('JS exception: ' + (d.exception?.description || d.text));
  }
  return r.result?.value;
}

async function evalIn(t, js, contextId) {
  const c = await connect(t.webSocketDebuggerUrl);
  try {
    const r = await c.send('Runtime.evaluate', {
      expression: js,
      awaitPromise: true,
      returnByValue: true,
      ...(contextId ? { contextId } : {}),
    });
    return unwrap(r);
  } finally {
    c.close();
  }
}

async function isoEval(t, js) {
  const c = await connect(t.webSocketDebuggerUrl);
  try {
    const ctxs = [];
    c.on((m) => {
      if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
    });
    const tree = await c.send('Page.getFrameTree');
    const mainFrame = tree.frameTree.frame.id;
    await c.send('Runtime.enable');
    await new Promise((r) => setTimeout(r, 300));
    const ctx = ctxs.find((x) => x.auxData?.type === 'isolated' && x.name === EXT_NAME && x.auxData?.frameId === mainFrame);
    if (!ctx) throw new Error('isolated world not found: ' + ctxs.map((x) => `${x.name}/${x.auxData?.type}`).join(', '));
    const r = await c.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true, contextId: ctx.id });
    return unwrap(r);
  } finally {
    c.close();
  }
}

const [cmd, ...args] = process.argv.slice(2);
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

try {
  if (cmd === 'targets') {
    out((await list()).map((t) => `${t.type.padEnd(15)} ${t.id.slice(0, 8)} ${t.url}`).join('\n'));
  } else if (cmd === 'open') {
    const r = await fetch(BASE + '/json/new?' + encodeURI(args[0]), { method: 'PUT' });
    out(await r.json());
  } else if (cmd === 'close') {
    const t = await findTarget(args[0], 'page');
    await fetch(BASE + '/json/close/' + t.id);
    out('closed ' + t.url);
  } else if (cmd === 'activate') {
    const t = await findTarget(args[0], 'page');
    await fetch(BASE + '/json/activate/' + t.id);
    out('activated ' + t.url);
  } else if (cmd === 'sw') {
    out(await evalIn(await swTarget(), args[0]));
  } else if (cmd === 'page') {
    const t = await findTarget(args[0], 'page');
    out(await evalIn(t, args[1]));
  } else if (cmd === 'offscreen') {
    // evaluate in the extension's offscreen document (target type background_page)
    const t = await findTarget('offscreen/', 'background_page');
    out(await evalIn(t, args[0]));
  } else if (cmd === 'iso') {
    const t = await findTarget(args[0], 'page');
    out(await isoEval(t, args[1]));
  } else if (cmd === 'shot') {
    const t = await findTarget(args[0], 'page');
    const c = await connect(t.webSocketDebuggerUrl);
    if (args[2]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: +args[2], height: +args[3], deviceScaleFactor: 1, mobile: false });
    }
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(args[1], Buffer.from(r.data, 'base64'));
    c.close();
    out('saved ' + args[1]);
  } else if (cmd === 'key') {
    const t = await findTarget(args[0], 'page');
    const c = await connect(t.webSocketDebuggerUrl);
    const mods = Number(args[2] || 0);
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: args[1], modifiers: mods });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: args[1], modifiers: mods });
    c.close();
    out('ok');
  } else if (cmd === 'press') {
    // press <match> <letter> <modifiers: Alt=1 Ctrl=2 Meta=4 Shift=8>
    const t = await findTarget(args[0], 'page');
    const c = await connect(t.webSocketDebuggerUrl);
    const ch = args[1].toLowerCase();
    const vk = ch.toUpperCase().charCodeAt(0);
    const ev = { key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: Number(args[2] || 0) };
    await c.send('Page.bringToFront');
    await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ev });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev });
    c.close();
    out('pressed');
  } else if (cmd === 'click') {
    const t = await findTarget(args[0], 'page');
    const c = await connect(t.webSocketDebuggerUrl);
    const x = +args[1];
    const y = +args[2];
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    c.close();
    out('clicked');
  } else if (cmd === 'quit') {
    // close the whole test browser (never use taskkill: the user's Brave has the same image name)
    const v = await (await fetch(BASE + '/json/version')).json();
    const c = await connect(v.webSocketDebuggerUrl);
    await c.send('Browser.close').catch(() => {});
    c.close();
    out('closed');
  } else if (cmd === 'window') {
    // window <minimized|normal|offscreen> — keep the test browser out of the user's way.
    // 'offscreen' = a normal (rendering, IntersectionObserver-active) window placed outside every
    // monitor: minimised pages are hidden and page translation never sees anything "visible".
    const mode = args[0] || 'minimized';
    const v = await (await fetch(BASE + '/json/version')).json();
    const c = await connect(v.webSocketDebuggerUrl);
    const pages = (await list()).filter((t) => t.type === 'page');
    const seen = new Set();
    for (const p of pages) {
      const { windowId } = await c.send('Browser.getWindowForTarget', { targetId: p.id });
      if (seen.has(windowId)) continue;
      seen.add(windowId);
      if (mode === 'offscreen') {
        await c.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
        // this PC's virtual desktop spans x -1265..2167 (4 monitors); x=4000 is outside all of them
        await c.send('Browser.setWindowBounds', { windowId, bounds: { left: Number(args[1] || 4000), top: 100, width: 1280, height: 900 } });
      } else {
        await c.send('Browser.setWindowBounds', { windowId, bounds: { windowState: mode } });
      }
    }
    const b = seen.size ? (await c.send('Browser.getWindowBounds', { windowId: [...seen][0] })).bounds : null;
    c.close();
    out(`${mode}: ${seen.size} window(s)${b ? ` ${JSON.stringify(b)}` : ''}`);
  } else {
    out('unknown command');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(String(e?.stack || e));
  process.exitCode = 1;
}

// Unloading the model while translations run must not leave them hanging. wllama's exit() terminates its
// worker without settling the calls in progress, so a translation that was running never answered and kept
// its slot in the service worker's queue (8 slots); with every slot taken nothing was translated again.
// Here 8 translations run in the service worker (no page re-sends them), then the model is unloaded
// (「VRAM を解放」). Pass: all 8 settle within 10 s, the queue drains, and a translation afterwards works.
// node unload_busy_test.mjs   (test browser on CDP 9333, an extension page open)
import { execFileSync } from 'node:child_process';

const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 90000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let fails = 0;
const expect = (name, cond, detail) => { log((cond ? 'PASS ' : 'FAIL ') + name, detail ? JSON.stringify(detail) : ''); if (!cond) fails++; };
const queue = () => JSON.parse(cdp('sw', 'self.__plamo.getStatus().then((s) => JSON.stringify(s.queue))'));

log('load:', cdp('sw', "self.__plamo.engineCall('load', { modelId: '2b-q4km' }).then((s) => s.state)"));
// long enough to still be decoding a few seconds in; a different text each so nothing is shared
log('start:', cdp('sw', `(() => {
  const text = 'The committee reviewed every proposal in detail, compared the expected costs with the benefits for each district, and asked the planners to explain how the new routes would serve people who travel at night. ';
  self.__settled = [];
  for (let i = 0; i < 8; i++) {
    self.__plamo.translate({ text: '(' + i + ') ' + text.repeat(3), target: 'ja', useCache: false })
      .then(() => 'done', (e) => 'rejected ' + (e?.name === 'AbortError' ? 'AbortError' : e?.code || e?.message))
      .then((r) => self.__settled.push(i + ' ' + r));
  }
  return 'started 8';
})()`));
let q = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  q = queue();
  if (q.active >= 8) break;
}
await sleep(1500);
log('queue while decoding:', JSON.stringify(q), 'settled so far:', cdp('sw', 'self.__settled.length'));
log('unload:', cdp('sw', "Promise.race([self.__plamo.engineCall('unload').then((s) => s.state), new Promise((r) => setTimeout(() => r('unload did not answer'), 20000))])"));
const tU = Date.now();
let settled = [];
for (let i = 0; i < 20; i++) {
  await sleep(500);
  settled = JSON.parse(cdp('sw', 'JSON.stringify(self.__settled)'));
  if (settled.length === 8) break;
}
q = queue();
expect('all 8 translations settle within 10 s of the unload', settled.length === 8, { settled, afterMs: Date.now() - tU });
expect('the queue drains', q.active === 0 && q.pending === 0, q);
const r = cdp('sw', "Promise.race([self.__plamo.translate({ text: 'The engine works again.', target: 'ja', useCache: false }).then((r) => 'ok ' + r.text), new Promise((r) => setTimeout(() => r('no answer in 60 s'), 60000))])");
expect('a translation afterwards works', r.startsWith('ok '), r);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);

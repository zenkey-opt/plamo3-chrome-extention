// Print the raw event pattern of a few decode steps from .work/bench/timeline.json
import { readFileSync } from 'node:fs';
const { evs } = JSON.parse(readFileSync(new URL('../.work/bench/timeline.json', import.meta.url), 'utf8'));
// find decode region: last 30% of events
const start = Math.floor(evs.length * 0.7);
let line = [];
let t0 = evs[start][1];
let prev = t0;
for (let i = start; i < Math.min(evs.length, start + 220); i++) {
  const [k, t] = evs[i];
  line.push(`${k}+${(t - prev).toFixed(2)}`);
  prev = t;
  if (line.length === 12) {
    console.log(line.join(' '));
    line = [];
  }
}
console.log(line.join(' '));
// wait durations histogram
const waits = [];
let w0 = null;
for (const [k, t] of evs) {
  if (k === 'w0') w0 = t;
  else if (k === 'w1' && w0 !== null) {
    waits.push(t - w0);
    w0 = null;
  }
}
const s = [...waits].sort((a, b) => a - b);
const q = (p) => s[Math.floor(p * (s.length - 1))].toFixed(3);
console.log(`waits ${waits.length}: p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} sum ${waits.reduce((a, b) => a + b, 0).toFixed(0)} ms; >1ms: ${waits.filter((w) => w > 1).length}`);

// Summarize bench_speed result files: node tests/bench_table.mjs <prefix> [names...]
// prints, per name, the last round's numbers of each pass file .work/bench/<prefix>_<name>_<pass>.json
import { readFileSync, existsSync } from 'node:fs';

const [prefix, ...names] = process.argv.slice(2);
const dir = new URL('../.work/bench/', import.meta.url);
const pad = (s, n) => String(s).padStart(n);
console.log('name'.padEnd(10), 'pass', pad('short', 6), pad('medium', 7), pad('long', 6), pad('gen t/s', 8), pad('page', 6), pad('all', 6));
for (const name of names) {
  for (const pass of [1, 2, 3]) {
    const f = new URL(`${prefix}_${name}_${pass}.json`, dir);
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const r = j.rounds[j.rounds.length - 1];
    const s = r.sequential;
    console.log(name.padEnd(10), pad(pass, 4), pad(s.short.msMedian, 6), pad(s.medium.msMedian, 7), pad(s.long.msMedian, 6),
      pad(s.long.genTokPerSec.toFixed(1), 8), pad(r.page.wall, 6), pad(r.pageAll ? r.pageAll.wall : '-', 6));
  }
}

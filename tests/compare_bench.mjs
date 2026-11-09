// Compare the translations of two bench_speed.mjs result files (greedy decoding: a faithful
// engine change gives identical texts). node compare_bench.mjs a.json b.json
import { readFileSync } from 'node:fs';

const [A, B] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
const texts = (r, i) => {
  const x = r.rounds[i];
  return [...['short', 'medium', 'long'].flatMap((c) => x.sequential[c].texts), ...x.page.texts];
};
let same = 0;
let total = 0;
for (let i = 0; i < Math.min(A.rounds.length, B.rounds.length); i++) {
  const a = texts(A, i);
  const b = texts(B, i);
  a.forEach((t, k) => {
    total++;
    if (t === b[k]) same++;
    else console.log(`round ${i} #${k} differs:\n  A: ${t}\n  B: ${b[k]}`);
  });
}
console.log(`${same}/${total} identical`);
const fmt = (r) =>
  r.rounds
    .map((x) => {
      const s = x.sequential;
      return `short ${s.short.msMedian} ms, medium ${s.medium.msMedian} ms (${s.medium.genTokPerSec} tok/s), long ${s.long.msMedian} ms (${s.long.genTokPerSec} tok/s, prompt ${s.long.promptMsPerTok} ms/tok), page ${x.page.wall} ms`;
    })
    .join('\n    ');
console.log(`A ${A.label}: ${fmt(A)}\nB ${B.label}: ${fmt(B)}`);

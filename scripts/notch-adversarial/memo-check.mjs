// memo-check.mjs — lib.mjs's notch-level memo must reproduce the un-memoized
// worker message for message (2026-10-05 follow-up).
//   node scripts/notch-adversarial/memo-check.mjs [variants=B,V14,V16] [every=23] [sr=16000,48000]
import { heldScenarios } from "./scenarios.mjs";
import { runWorker, runWorkerRaw } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";
const [vs = "B,V14,V16", every = "23", srs = "16000,48000"] = process.argv.slice(2);
let n = 0, mis = 0, runs = 0;
const list = heldScenarios().filter((_, i) => i % +every === 0);
for (const sr of srs.split(",").map(Number)) for (const sc of list) {
  const { x } = sc.build(sr);
  for (const v of vs.split(",")) {
    const a = runWorker(VARIANTS[v], x, sr), b = runWorkerRaw(VARIANTS[v], x, sr).map((r) => r);
    runs++;
    for (let i = 0; i < Math.max(a.length, b.length); i++) { n++; if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) mis++; }
  }
}
console.log(`memo vs raw (${vs}): ${mis} mismatches in ${n} messages (${runs} runs, ${list.length} scenarios x ${srs})`);
process.exit(mis ? 1 : 0);

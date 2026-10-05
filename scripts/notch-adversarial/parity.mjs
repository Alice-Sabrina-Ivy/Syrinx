// parity.mjs — message-level equality of two variants over a scenario sample
//   node scripts/notch-adversarial/parity.mjs A B [every=11] [sr=16000]
import { heldScenarios } from "./scenarios.mjs";
import { runWorker } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";
const [A, B, every = "11", srs = "16000"] = process.argv.slice(2);
let n = 0, mis = 0;
const list = heldScenarios().filter((_, i) => i % +every === 0);
for (const sr of srs.split(",").map(Number)) for (const sc of list) {
  const { x } = sc.build(sr);
  const a = runWorker(VARIANTS[A], x, sr), b = runWorker(VARIANTS[B], x, sr);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    n++;
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) mis++;
  }
}
console.log(`${A} vs ${B}: ${mis} mismatches in ${n} messages (${list.length} scenarios x ${srs})`);

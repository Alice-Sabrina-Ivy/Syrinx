// dbgheld.mjs NAME SR VARIANT FREQ — notch debug events for one held scenario
import { heldScenarios } from "./scenarios.mjs";
import { runWorker } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";
const [name, sr, vn, f] = process.argv.slice(2);
const sc = heldScenarios().find((s) => s.name === name);
const { x } = sc.build(+sr);
globalThis.__NOTCH_DBG = [];
runWorker(VARIANTS[vn], x, +sr);
for (const e of globalThis.__NOTCH_DBG) if (Math.abs(e.f / +f - 1) < 0.03) console.log(JSON.stringify({ ...e, t: +(e.obs / 10 + 0.512).toFixed(2) }));

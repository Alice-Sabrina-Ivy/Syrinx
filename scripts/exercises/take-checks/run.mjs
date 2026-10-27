// run.mjs — every take of one set through the real chain (chain.mjs), one JSON row per
// take x condition (positives) or per take (negatives).
//
//   SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs \
//     scripts/exercises/take-checks/run.mjs --set=sel|conf|neg [--shard=i/n] \
//     [--src=build/exercise-take-checks/tree/src] [--out=build/exercise-take-checks]
//
// -> <out>/parts/rows-<set>.<i>of<n>.jsonl (merge.mjs joins them into rows-<set>.jsonl).
// Positives are sharded by reader (a reader's utterances are decoded once per shard).
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadChain, runWorkers, driveHookTap, inWindow, counts } from "./chain.mjs";
import { positiveTakes, negativeTakes, renderPositive, renderNegative, CONDITIONS, RATE, MAX_SPEECH_S } from "./stimuli.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const SET = args.set;
if (!["sel", "conf", "neg"].includes(SET)) throw new Error("--set=sel|conf|neg");
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
const OUT = resolve(args.out ?? "build/exercise-take-checks");
const SRC = args.src ?? "build/exercise-take-checks/tree/src";
mkdirSync(resolve(OUT, "parts"), { recursive: true });
const outFile = resolve(OUT, "parts", `rows-${SET}.${shI}of${shN}.jsonl`);
// resume: skip rows already written
const done = new Set();
if (existsSync(outFile)) for (const l of readFileSync(outFile, "utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l); done.add(`${r.takeId}|${r.cond}`); }

const CH = await loadChain(SRC);
const t0 = Date.now();
let nRows = 0;

async function measure(rendered) {
  const W = await runWorkers(CH, rendered.samples, RATE);
  const tapped = await driveHookTap(CH, W);
  const win = inWindow(tapped, rendered.takeStartS, rendered.takeEndS);
  const c = counts(CH, win, { capS: 8.0, takeStartS: rendered.takeStartS });
  return { c, stats: W.stats, total: tapped.length };
}

if (SET === "neg") {
  const takes = negativeTakes().filter((_, i) => i % shN === shI);
  for (const t of takes) {
    if (done.has(`${t.id}|-`)) continue;
    const R = renderNegative(t);
    const { c, stats } = await measure(R);
    const row = { set: "neg", cls: t.cls, takeId: t.id, cond: "-", seed: t.seed, reader: t.reader ?? null, sex: t.sex ?? null, utts: t.utts ?? null, takeS: +R.takeS.toFixed(4), ...c, det: stats };
    appendFileSync(outFile, JSON.stringify(row) + "\n");
    nRows++;
  }
} else {
  const { takes } = positiveTakes(SET);
  const rdrs = [...new Set(takes.map((t) => t.reader))];
  const mine = new Set(rdrs.filter((_, i) => i % shN === shI));
  for (const r of rdrs) {
    if (!mine.has(r)) continue;
    const cache = new Map();
    for (const t of takes.filter((x) => x.reader === r)) {
      for (const cond of CONDITIONS) {
        if (done.has(`${t.id}|${cond}`)) continue;
        const R = renderPositive(t, cond, cache);
        if (R.speechS > MAX_SPEECH_S + 1e-9) throw new Error(`speech over the cap: ${t.id}`);
        const { c, stats } = await measure(R);
        const row = {
          set: SET, split: t.split, sex: t.sex, reader: t.reader, type: t.type, idx: t.idx, takeId: t.id, cond, utts: t.utts,
          speechS: +R.speechS.toFixed(4), takeS: +R.takeS.toFixed(4), speechRmsDb: +(20 * Math.log10(R.speechRms)).toFixed(2),
          ...c, det: stats,
        };
        appendFileSync(outFile, JSON.stringify(row) + "\n");
        nRows++;
      }
    }
  }
}
console.log(`${SET} ${shI}/${shN}: ${nRows} rows in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outFile}`);
// the detector's ONNX session keeps the event loop alive
process.exit(0);

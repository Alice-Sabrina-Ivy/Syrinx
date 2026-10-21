// switch-fixture.mjs — writes tests/resonance/fixtures/switch-up-bins.json
// (the up-switch fixture of tests/resonance/switch-restart-test.js) from a
// dev run of switch-asymmetry.mjs (measurements/resonance-switch-asymmetry-
// 2026-10-21.md): the admitted vtln bins (arm on) of one dev-clean reader,
// darker → brighter → darker at 18 / 36 s, and the all-brighter control.
//
//   node scripts/resonance/switch-fixture.mjs [--runs=build/resonance-switch/run-dev-0of2.jsonl,build/resonance-switch/run-dev-1of2.jsonl] [--reader=ls2078]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const runs = arg("runs", "build/resonance-switch/run-dev-0of2.jsonl,build/resonance-switch/run-dev-1of2.jsonl").split(",");
const reader = arg("reader", "ls2078");
const rows = runs.flatMap((f) => readFileSync(path.resolve(repo, f), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)));
const get = (id) => { const r = rows.find((x) => x.id === id); if (!r) throw new Error(`no ${id} in --runs`); return r; };
// admitted bins as the cue's readout saw them: [te s, voiced stamp less dropped voiced time, value]
const adm = (r) => {
  const bins = [];
  let last = null, dropped = 0;
  for (const [te, st, v, a] of r.on.bins) {
    const d = last === null ? 0 : Math.max(0, st - last);
    last = st;
    if (!a) { dropped += d; continue; }
    if (v === null) continue;
    bins.push([te, +(st - dropped).toFixed(3), v]);
  }
  return bins;
};
const fx = {
  about: `Admitted vtln bins [te s, voiced stamp s, value] from the real chain (arm on) on LibriSpeech dev-clean speaker ${reader.replace(/^ls/, "")}, re-rendered by the Voice Shaper's WORLD engine with formants -8 % (darker) and +9 % (brighter), pitch kept. switch: darker 0-18 s, brighter 18-36 s, darker 36-54 s. brighter: the same 54 s all brighter (the control). scripts/resonance/switch-fixture.mjs, measurements/resonance-switch-asymmetry-2026-10-21.md`,
  joinS: 18,
  endS: 36,
  switch: adm(get(`dev__${reader}__ak__DBD`)),
  brighter: adm(get(`dev__${reader}__ak__BBB`)),
};
const out = path.join(repo, "tests/resonance/fixtures/switch-up-bins.json");
writeFileSync(out, JSON.stringify(fx) + "\n");
console.log(`${out}: ${fx.switch.length} + ${fx.brighter.length} bins`);

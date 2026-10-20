// parity-test.js — every voice-preview render from src/voice-preview/engine/ is
// bit-identical (sha256 of the finished float32 PCM) to the Phase 0 spike's own code
// (tests/voice-preview/fixtures/spike-parity.json, written by
// scripts/voice-preview/make-spike-parity.mjs from the spike commit with the committed
// .wasm). measurements/voice-preview-phase1-2026-10-19.md §5, §14 item 2.
//
// For every input (three LibriSpeech clips at 16 / 44.1 / 48 kHz, one at 96 kHz) and both
// builds (SIMD, non-SIMD): one analysis, whose first render (the unchanged rebuild) must
// equal the spike's (0, 0) cell, then the other cells. The spike's expected value for each
// cell comes from a fresh analysis with that cell rendered first, so a render that
// depended on earlier renders would fail here. Render orders: the two builds take the
// cells in opposite orders (forward / reversed, the reversed order ending with (0, 0)
// again), swapped from one input to the next, so each build runs both orders across the
// inputs. (Every build x order x input would take
// about 80 s; the voice-preview unit tests have a 60 s budget together —
// measurements/voice-preview-phase1-2026-10-19.md, Deviations.)
// Inputs and posted tracks are checked against their recorded hashes first.
//
//   node tests/voice-preview/parity-test.js
import { readFileSync } from "node:fs";
import {
  PARITY_JSON, CELLS, cellKey, INPUT_SPECS, inputName, makeInput, sha256, loadWorld, makeChecker,
} from "./vp-test-lib.js";
import { PreviewEngine } from "../../src/voice-preview/engine/preview.js";

const T = makeChecker();
const fx = JSON.parse(readFileSync(PARITY_JSON, "utf8"));
const t00 = Date.now();

T.check("fixture cells are the design's seven", JSON.stringify(fx.cells) === JSON.stringify(CELLS));
T.check("fixture inputs match the input list", fx.inputs.map((i) => i.name).join() === INPUT_SPECS.map(inputName).join());

const worlds = { simd: await loadWorld("simd"), nosimd: await loadWorld("nosimd") };
for (const [ii, spec] of INPUT_SPECS.entries()) {
  const f = fx.inputs.find((i) => i.name === inputName(spec));
  const { pcm, rate } = makeInput(spec);
  const track = Float32Array.from(f.track);
  console.log(`\n${f.name} (engine ${f.engineRate} Hz)`);
  const inputOk = sha256(pcm) === f.pcmSha256 && sha256(track) === f.trackSha256;
  T.check("input PCM and posted track match their recorded hashes", inputOk,
    inputOk ? "" : `pcm ${sha256(pcm).slice(0, 12)} vs ${f.pcmSha256.slice(0, 12)} — did the lab's sinc resampler change?`);
  if (!inputOk) continue;
  for (const [bi, b] of ["simd", "nosimd"].entries()) {
    const orders = [(ii + bi) % 2 === 0 ? "forward" : "reverse"];
    const eng = new PreviewEngine(worlds[b]);
    const a = eng.analyse(pcm, rate, track);
    const exp = f.expected[b];
    const bad = [];
    if (a.rate !== f.engineRate) bad.push(`engine rate ${a.rate}`);
    if (sha256(a.rebuild) !== exp[cellKey(0, 0)]) bad.push("first render (rebuild)");
    for (const order of orders) {
      // forward skips (0, 0): the rebuild just rendered it; reversed ends with it
      const cells = order === "forward" ? CELLS.filter(([st, pct]) => st !== 0 || pct !== 0) : [...CELLS].reverse();
      for (const [st, pct] of cells) {
        const r = eng.render(st, pct);
        if (r.pcm.length !== a.rebuild.length) bad.push(`${order} ${cellKey(st, pct)} length`);
        else if (sha256(r.pcm) !== exp[cellKey(st, pct)]) bad.push(`${order} ${cellKey(st, pct)}`);
      }
    }
    eng.free();
    T.check(`${b}: rebuild + the cells ${orders.join(", then ")} bit-identical to the spike`, bad.length === 0, bad.join(", "));
  }
}
console.log(`\n(${((Date.now() - t00) / 1000).toFixed(1)} s)`);
T.done();

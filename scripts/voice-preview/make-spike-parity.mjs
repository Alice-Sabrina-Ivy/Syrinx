// make-spike-parity.mjs — expected outputs for tests/voice-preview/parity-test.js,
// computed by the Phase 0 spike's OWN code, so the app's engine (src/voice-preview/engine/)
// is held to the spike's renders bit for bit (measurements/voice-preview-phase1-2026-10-19.md §5).
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/make-spike-parity.mjs
//        [--spike=3f7603f]
// Note 2026-10-21: branch voice-preview-spike (3f7603f) was deleted on 2026-10-21 by the
// owner's decision and not kept, so the spike commit no longer exists and this script
// cannot run as written; tests/voice-preview/fixtures/spike-parity.json stays as committed.
//
// 1. Extracts the spike's scripts/voice-preview/lib/ and the lab's sinc resampler from the
//    spike commit with `git archive` into build/voice-preview/spike-<commit>/ (gitignored).
// 2. Builds the inputs (tests/voice-preview/vp-test-lib.js makeInput: the three committed
//    LibriSpeech 16 kHz clips at 16 / 44.1 / 48 kHz, one at 96 kHz; whole capture chunks).
// 3. Posted tracks from the REAL pitch chain (scripts/session-oracle/lib/chain.mjs
//    runWorkers) at each input rate, with the app's capture chunk floor(0.025 x rate);
//    committed in the JSON, so the parity test does not depend on later pitch-worker changes.
// 4. For each input, build (simd, nosimd) and cell (st, pct): the spike's Preview
//    (engine "world", front end "S", frame period 5, first = that cell) with the committed
//    .wasm; sha256 of the finished float32 render.
// Writes tests/voice-preview/fixtures/spike-parity.json.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  REPO, CELLS, cellKey, INPUT_SPECS, inputName, makeInput, sha256, PARITY_JSON, GLUE_URL, WASM_URLS,
} from "../../tests/voice-preview/vp-test-lib.js";
import { engineRateFor } from "../../src/voice-preview/engine/preview.js";
import { formantScale } from "../../src/voice-preview/controls.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const SPIKE = args.spike ?? "3f7603f";
const spikeFull = execFileSync("git", ["rev-parse", SPIKE], { cwd: REPO, encoding: "utf8" }).trim();

// the spike's literals for the formant scale; the app computes (100 + pct) / 100
const A_LITERAL = { 0: 1, 3: 1.03, [-3]: 0.97, 6: 1.06, 26: 1.26, [-21]: 0.79 };
for (const [, pct] of CELLS) {
  if (formantScale(pct) !== A_LITERAL[pct]) throw new Error(`formantScale(${pct}) = ${formantScale(pct)} is not the literal ${A_LITERAL[pct]}`);
}

// 1. the spike's code
const dir = path.join(REPO, "build", "voice-preview", `spike-${spikeFull.slice(0, 7)}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const tarFile = path.join(dir, "spike.tar");
execFileSync("git", ["archive", "-o", tarFile, spikeFull, "scripts/voice-preview/lib", "src/resonance-lab/sinc-resampler.js"], { cwd: REPO });
execFileSync("tar", ["-xf", "spike.tar"], { cwd: dir });
const imp = (p) => import(pathToFileURL(path.join(dir, p)).href);
const { createWorld } = await imp("scripts/voice-preview/lib/world-engine.js");
const { Preview } = await imp("scripts/voice-preview/lib/preview-core.js");

// the committed module, loaded through the spike's binding
const { default: factory } = await import(GLUE_URL);
const worlds = {};
for (const b of ["simd", "nosimd"]) worlds[b] = createWorld(await factory({ locateFile: () => WASM_URLS[b] }));

// 3. the real pitch chain
const { loadSrc, runWorkers } = await import(pathToFileURL(path.join(REPO, "scripts/session-oracle/lib/chain.mjs")).href);
const S = await loadSrc(path.join(REPO, "src"));

const out = {
  note: "Expected renders from the Phase 0 spike's own code (scripts/voice-preview/make-spike-parity.mjs). " +
    "Inputs: tests/resonance-lab/fixtures LibriSpeech clips (CC BY 4.0), upsampled by the engine's resampleClip, cut to whole capture chunks. " +
    "track: the real pitch chain's posted value per capture chunk (Hz, 0 = unvoiced; float32 values).",
  spikeCommit: spikeFull,
  srcCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
  cells: CELLS,
  inputs: [],
};
const t00 = Date.now();
for (const spec of INPUT_SPECS) {
  const { pcm, rate, chunk } = makeInput(spec);
  const W = runWorkers(S, pcm, rate, { chunkMs: chunk / rate * 1000 });
  if (W.C !== chunk || W.n !== pcm.length / chunk) throw new Error(`${inputName(spec)}: chain chunking ${W.C} x ${W.n}, expected ${chunk} x ${pcm.length / chunk}`);
  const track = Float32Array.from(W.col.post);
  const nnotch = W.col.nnotch.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
  const r = engineRateFor(rate);
  const expected = {};
  for (const b of ["simd", "nosimd"]) {
    expected[b] = {};
    for (const [st, pct] of CELLS) {
      const p = new Preview({ engine: "world", world: worlds[b] });
      const res = p.analyse(pcm, rate, { rate: r, frontEnd: "S", posted: track, framePeriod: 5, first: { st, a: A_LITERAL[pct] } });
      expected[b][cellKey(st, pct)] = sha256(res.pcm);
      p.free();
    }
  }
  const same = CELLS.every(([st, pct]) => expected.simd[cellKey(st, pct)] === expected.nosimd[cellKey(st, pct)]);
  out.inputs.push({
    name: inputName(spec), clip: spec.clip, rate, engineRate: r, chunk, samples: pcm.length,
    pcmSha256: sha256(pcm), voicedHops: track.filter((v) => v > 0).length, notchedHops: nnotch,
    track: Array.from(track), trackSha256: sha256(track), expected, simdEqualsNosimd: same,
  });
  console.log(`${inputName(spec)}: ${pcm.length} samples, ${track.length} hops (${track.filter((v) => v > 0).length} voiced), engine ${r} Hz, simd == nosimd: ${same} (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
}
mkdirSync(path.dirname(PARITY_JSON), { recursive: true });
writeFileSync(PARITY_JSON, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${path.relative(REPO, PARITY_JSON)}`);
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

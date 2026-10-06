// parity-test.js — the resonance lab's JS finalists vs the Python / scored
// prototypes, on fixed LibriSpeech fixtures (tests/resonance-lab/fixtures/,
// regenerate with scripts/resonance-lab/lab_fixtures.py).
//
// The WHOLE streaming engine (src/resonance-lab/lab-engine.js) is driven
// exactly as in the app — 25 ms capture chunks at 48 kHz — except that the
// 16 kHz analysis stream and the 10 ms F0 track are injected so the inputs
// equal the prototypes' (bench audio is 16 kHz; fv's bench upsamples it to
// 48 kHz with extract_app.mjs's band-limited upsampler, reused here).
//
//   le    le_ens_h64 (Python)                 -> per-150 ms bin scores
//   vtln  vtln_warp v3 (Python + pyworld)     -> per-150 ms bin ln(alpha)
//   fv    fv_..._bw800 (fvtl_js.mjs, scored)  -> per-150 ms bin values
//   pnml  pnml_head_scalesex_none0 (Python ORT, float32 embeddings) -> per-window
//         raw head score + gated EMA. Runs the DEPLOYED q8-v2 model patched in JS
//         (onnx-patch.js) through transformers.js / onnxruntime-node; skipped when
//         the model isn't in the transformers.js cache (run tests/ml/* once).
// Plus: the engine's internal pitch path vs prodf0.mjs (production-detector
// emulation used by the critic's production-F0 runs) — must match exactly.
//
//   node tests/resonance-lab/parity-test.js [--no-pnml]

import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLabEngine } from "../../src/resonance-lab/lab-engine.js";
import { concatIntoOutput } from "../../src/resonance-lab/onnx-patch.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const FIX = path.join(here, "fixtures");
const ASSETS = path.join(repo, "public", "resonance-lab");
const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);

const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const models = {
  le: json(path.join(ASSETS, "le_ens_h64.json")),
  vtln: json(path.join(ASSETS, "vtln_warp.json")),
  fv: json(path.join(ASSETS, "fv_model.json")),
  pnmlHead: json(path.join(ASSETS, "pnml_head.json")),
};
const reference = json(path.join(ASSETS, "reference.json"));
const gapOf = (k) => reference[k].womenMedian - reference[k].menMedian;

// Tolerances (absolute, in each finalist's native units; G = men-women gap):
//   le / fv: same arithmetic in float64            -> 1e-6
//   vtln: the prototype scores its GMM in float32  -> 2e-3 ln(alpha) (~0.02 G)
//   pnml: onnxruntime-node vs Python onnxruntime on a dynamically-quantised graph -> 0.01 (G ~ 0.11)
const TOL = { le: 1e-6, fv: 1e-6, vtln: 2e-3, pnml: 1e-2 };

function readWav16(p) {
  const b = readFileSync(p);
  let off = 12;
  let data = null, sr = 0;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === "fmt ") sr = b.readUInt32LE(off + 12);
    if (id === "data") { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  const x = new Float32Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return { x, sr };
}

let pnmlModel = null;
let Tensor = null;
let tmpRoot = null;
async function loadPnml() {
  const id = "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2";
  const cache = path.join(repo, "node_modules/@huggingface/transformers/.cache", id);
  const onnx = path.join(cache, "onnx/model_quantized.onnx");
  if (!existsSync(onnx)) return `model not cached at ${onnx}`;
  tmpRoot = mkdtempSync(path.join(tmpdir(), "reslab-pnml-"));
  const dst = path.join(tmpRoot, id);
  mkdirSync(path.join(dst, "onnx"), { recursive: true });
  for (const f of ["config.json", "preprocessor_config.json"]) copyFileSync(path.join(cache, f), path.join(dst, f));
  writeFileSync(path.join(dst, "onnx/model_quantized.onnx"), concatIntoOutput(new Uint8Array(readFileSync(onnx))));
  const T = await import("@huggingface/transformers");
  T.env.allowRemoteModels = false;
  T.env.allowLocalModels = true;
  T.env.localModelPath = tmpRoot;
  T.env.useFSCache = false; // else the unpatched copy in the transformers.js cache wins
  Tensor = T.Tensor;
  pnmlModel = await T.AutoModelForAudioClassification.from_pretrained(id, { dtype: "q8" });
  return null;
}

function compare(name, got, exp, tol, g) {
  // got: Map te -> value|null ; exp: {t, s}
  let n = 0, maxd = 0, nullMismatch = 0, missing = 0;
  exp.t.forEach((t, i) => {
    const key = Math.round(t * 1000);
    if (!got.has(key)) { missing++; return; }
    const a = got.get(key), b = exp.s[i];
    if ((a === null) !== (b === null)) { nullMismatch++; return; }
    if (a === null) return;
    n++;
    maxd = Math.max(maxd, Math.abs(a - b));
  });
  const ok = nullMismatch === 0 && missing === 0 && maxd <= tol && n > 0;
  return { name, n, maxd, maxdG: maxd / g, nullMismatch, missing, ok };
}

const fixtures = ["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"];
const noPnml = process.argv.includes("--no-pnml");
let pnmlSkip = noPnml ? "--no-pnml" : await loadPnml();
let fail = 0;
const rows = [];

for (const name of fixtures) {
  const exp = json(path.join(FIX, `${name}.expected.json`));
  const { x } = readWav16(path.join(FIX, `${name}.wav`));
  const y48 = upsample(x);
  const got = { le: new Map(), vtln: new Map(), fv: new Map(), pnml: new Map() };
  const rawGot = new Map();
  const b2Got = new Map();
  const eng = createLabEngine({
    sampleRate: 48000,
    models: pnmlSkip ? { le: models.le, vtln: models.vtln, fv: models.fv } : models,
    reference,
    externalF0: Float32Array.from(exp.f0),
    pnmlMaxPending: Infinity,
    nativeFloat64: true,
    onBin: (fin, te, s) => got[fin].set(Math.round(te * 1000), s),
  });
  async function servePnml() {
    for (let r = eng.takePnmlRequest(); r; r = eng.takePnmlRequest()) {
      const out = await pnmlModel({ input_values: new Tensor("float32", r.win, [1, r.win.length]) });
      const d = out.logits.data;
      eng.pnmlDone(r.k, d);
      rawGot.set(Math.round(r.k * 150), models.pnmlHead.b + models.pnmlHead.w.reduce((a, w, i) => a + w * d[2 + i], 0));
      b2Got.set(Math.round(r.k * 150), d[1] - d[0]); // the deployed meter's logit, same inference
    }
  }
  for (let s = 0; s < x.length; s += 400) {
    eng.pushChunk(y48.subarray(3 * s, 3 * Math.min(x.length, s + 400)), x.subarray(s, Math.min(x.length, s + 400)));
    if (!pnmlSkip) await servePnml();
  }
  eng.finish();
  if (!pnmlSkip) await servePnml();

  for (const fin of ["le", "vtln", "fv"]) rows.push({ fixture: name, ...compare(fin, got[fin], exp[fin], TOL[fin], gapOf(fin)) });
  if (!pnmlSkip) {
    rows.push({ fixture: name, ...compare("pnml(ema)", got.pnml, { t: exp.pnml.t, s: exp.pnml.ema }, TOL.pnml, gapOf("pnml")) });
    rows.push({ fixture: name, ...compare("pnml(raw)", new Map([...got.pnml.keys()].map((k) => [k, rawGot.has(k) ? rawGot.get(k) : null])),
      { t: exp.pnml.t, s: exp.pnml.raw }, TOL.pnml, gapOf("pnml")) });
    rows.push({ fixture: name, ...compare("deployed fc7 logit", new Map([...got.pnml.keys()].map((k) => [k, b2Got.has(k) ? b2Got.get(k) : null])),
      { t: exp.pnml.t, s: exp.pnml.b2_logit }, TOL.pnml, 1) });
  }

  // internal pitch path vs prodf0.mjs (16 kHz input, 400-sample chunks, as prodf0 runs)
  const engP = createLabEngine({ sampleRate: 16000, models: {}, reference });
  for (let s = 0; s + 400 <= x.length; s += 400) engP.pushChunk(x.subarray(s, s + 400));
  const tr = engP.gridTrack();
  let same = 0, cmp = 0, maxHz = 0;
  for (let j = 0; j < Math.min(tr.length, exp.prodf0.length); j++) {
    cmp++;
    if ((tr[j] > 0) === (exp.prodf0[j] > 0)) same++;
    if (tr[j] > 0 && exp.prodf0[j] > 0) maxHz = Math.max(maxHz, Math.abs(tr[j] - exp.prodf0[j]));
  }
  const pitchOk = cmp > 300 && same === cmp && maxHz < 1e-3;
  rows.push({ fixture: name, name: "pitch path vs prodf0", n: cmp, maxd: maxHz, maxdG: NaN, nullMismatch: cmp - same, missing: 0, ok: pitchOk });
}

// ---- live path (informational + one ordering check): 48 kHz chunks, the engine's own
// anti-aliased resampler and production-replica pitch tracker, no injected inputs.
const live = {};
for (const name of fixtures) {
  const { x } = readWav16(path.join(FIX, `${name}.wav`));
  const y48 = Float32Array.from(upsample(x));
  const eng = createLabEngine({ sampleRate: 48000, models: { le: models.le, vtln: models.vtln, fv: models.fv }, reference });
  for (let s = 0; s < y48.length; s += 1200) eng.pushChunk(y48.subarray(s, Math.min(y48.length, s + 1200)));
  live[name] = eng.snapshot();
}
console.log("live path (48 kHz chunks, internal pitch), readout position u (0 = LibriSpeech men median, 1 = women median):");
for (const fin of ["vtln", "le", "fv"]) {
  const u = fixtures.map((f) => live[f].finalists[fin]?.u);
  const ok = u[0] > u[1];
  if (!ok) fail++;
  console.log(`  ${fin.padEnd(5)} ${fixtures.map((f, i) => `${f} ${u[i] === null || u[i] === undefined ? "-" : u[i].toFixed(2)}`).join("   ")}   woman_high > man_low: ${ok ? "PASS" : "FAIL"}`);
}
console.log("");
console.log("fixture            finalist              bins  max|diff|     in G   null-mismatch  missing  result");
for (const r of rows) {
  if (!r.ok) fail++;
  console.log(
    `${r.fixture.padEnd(18)} ${r.name.padEnd(20)} ${String(r.n).padStart(5)}  ${r.maxd.toExponential(2).padStart(9)}  ${Number.isFinite(r.maxdG) ? r.maxdG.toExponential(1).padStart(8) : "       -"}  ${String(r.nullMismatch).padStart(13)}  ${String(r.missing).padStart(7)}  ${r.ok ? "PASS" : "FAIL"}`,
  );
}
if (pnmlSkip) console.log(`pnml: SKIPPED (${pnmlSkip})`);
if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
console.log(fail ? `\n${fail} parity check(s) FAILED` : "\nall parity checks passed");
process.exit(fail ? 1 : 0);

// weight-test.js — the resonance lab's experimental weight × clarity view
// (measurements/weight-lab-prototype-2026-10-08.md §5, checks 1–3).
//
//  1. Port parity: src/resonance-lab/weight-features.js vs the Python reference
//     (scripts/resonance-lab/weight/v5_ref.py) on the committed LibriSpeech
//     fixtures (CC BY 4.0) at the reference's Praat AC frames
//     (tests/resonance-lab/fixtures/weight_v5.expected.json, make_fixture.py).
//  2. Voice map / reading / gates (weight-map.js) on synthetic bin streams.
//  3. Engine glue: a frame tap does not change the engine's own outputs, and
//     the weight analysis produces 1-s bins from the internal pitch path.
//
//   node tests/resonance-lab/weight-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWeightFeatures, FEATURE_NAMES } from "../../src/resonance-lab/weight-features.js";
import { createWeightMap, cellOf, REASONS, PROMPTS, PROMPT_BINS } from "../../src/resonance-lab/weight-map.js";
import { createWeightLab } from "../../src/resonance-lab/weight-lab.js";
import { createLabEngine } from "../../src/resonance-lab/lab-engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const FIX = path.join(here, "fixtures");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const model = json(path.join(repo, "public/resonance-lab/weight_v5.json"));

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

function readWav16(p, Arr = Float64Array) {
  const b = readFileSync(p);
  let off = 12;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === "data") {
      const x = new Arr(len / 2);
      for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(off + 8 + 2 * i) / 32768;
      return x;
    }
    off += 8 + len;
  }
  throw new Error(`no data chunk in ${p}`);
}

// ---------------------------------------------------------------- 1. parity
{
  const exp = json(path.join(FIX, "weight_v5.expected.json"));
  check("feature layout matches the reference", JSON.stringify(exp.names) === JSON.stringify(FEATURE_NAMES));
  const wf = createWeightFeatures(model);
  const dW = [], dC = [];
  let worstFeat = 0, worstFormant = 0, nanMismatch = 0, n = 0;
  const formantIdx = new Set(["F1", "F2", "F3", "F4", "B1", "B2", "B3", "B4"].map((k) => FEATURE_NAMES.indexOf(k)));
  for (const [name, rows] of Object.entries(exp.items)) {
    const x = readWav16(path.join(FIX, name));
    for (const r of rows) {
      const out = wf.frame(x.subarray(r.i0, r.i0 + 800), r.f0);
      if (!out) { nanMismatch++; continue; }
      n++;
      dW.push(Math.abs(out.w - r.w));
      dC.push(Math.abs(out.c - r.c));
      r.feats.forEach((ref, i) => {
        const v = out.features[i];
        if (ref === null) { if (!Number.isNaN(v)) nanMismatch++; return; }
        const d = Math.abs(v - ref);
        if (formantIdx.has(i)) worstFormant = Math.max(worstFormant, d);
        else worstFeat = Math.max(worstFeat, d);
      });
    }
  }
  const share = (a, tol) => a.filter((d) => d <= tol).length / a.length;
  check(`parity: ${n} frames over ${Object.keys(exp.items).length} fixtures`, n >= 90 && nanMismatch === 0, `undefined-feature mismatches ${nanMismatch}`);
  check("parity: |Δw| <= 1e-3 on >= 99 % of frames, <= 0.01 on all", share(dW, 1e-3) >= 0.99 && Math.max(...dW) <= 0.01, `max ${Math.max(...dW).toExponential(2)}`);
  check("parity: |Δc| <= 1e-3 on >= 99 % of frames, <= 0.01 on all", share(dC, 1e-3) >= 0.99 && Math.max(...dC) <= 0.01, `max ${Math.max(...dC).toExponential(2)}`);
  check("parity: every non-formant feature within 1e-6 dB", worstFeat <= 1e-6, `max ${worstFeat.toExponential(2)}`);
  check("parity: formant frequencies / bandwidths within 1e-4 Hz", worstFormant <= 1e-4, `max ${worstFormant.toExponential(2)}`);
  check("no features below 4 harmonics", wf.frame(new Float64Array(800).fill(0.1), 1900) === null);
  check("no features on an all-zero frame", wf.frame(new Float64Array(800), 150) === null);
}

// ---------------------------------------------------------------- 2. map logic
// Deterministic pseudo-random values.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;

/**
 * Feed `secs` seconds of 25 ms frames from t0. Running speech: in every second
 * frames 0..29 voiced, 30..39 unvoiced (voiced fraction 0.75). held: all voiced.
 */
function feed(m, t0, secs, { f0 = 200, w = 0, c = 0, level = -30, vtln = 0, held = false, jitter = 0.2 } = {}) {
  for (let k = 0; k < secs * 40; k++) {
    const t = t0 + k * 0.025 + 0.0125;
    const voiced = held || k % 40 < 30;
    m.frame(t, voiced ? f0 : 0, voiced ? { w: w + jitter * rnd(), c: c + jitter * rnd(), level } : null);
    if (voiced && k % 6 === 5) m.vtln(t, vtln);
  }
  return t0 + secs;
}

{
  check("cell index: 200 Hz, -30 dBFS -> (45, -8)", JSON.stringify(cellOf(Math.log2(200), -30)) === "[45,-8]");
  const m = createWeightMap();
  check("mapping refused while gain control is unknown", m.startMapping() === false);
  m.setCapture({ autoGainControl: true, deviceId: "mic-A" });
  check("mapping refused with gain control on", m.startMapping() === false);
  let t = feed(m, 0, 8);
  check("no reading with gain control on", m.snapshot().reason === REASONS.agc);

  m.setCapture({ autoGainControl: false, deviceId: "mic-A" });
  t = feed(m, t, 8);
  check("not mapped yet", m.snapshot().reason === REASONS.unmapped);
  check("mapping starts with gain control off", m.startMapping() === true && m.snapshot().phase === "mapping");
  t = feed(m, t, PROMPT_BINS + 4);
  const sp = m.snapshot();
  check("prompt advances after 30 running-speech bins", sp.prompt.index === 1 && sp.prompt.label === PROMPTS[1].label, JSON.stringify(sp.prompt));
  check("cell ready after >= 5 bins", sp.cells.some((x) => x.pi === 45 && x.li === -8 && x.ready));
  // softer prompt: a different loudness cell; a held vowel there does not count
  // the 3-of-5 rule (and the 1.5 s close lag) lets the first held seconds after speech through
  t = feed(m, t, 5, { level: -38, held: true });
  const have0 = m.snapshot().prompt.have;
  t = feed(m, t, 6, { level: -38, held: true });
  check("held vowels are not mapped (beyond the 3-of-5 window)", m.snapshot().prompt.have === have0, `+${m.snapshot().prompt.have - have0}`);
  t = feed(m, t, 10, { level: -38 });
  m.nextPrompt(); m.nextPrompt(); m.nextPrompt();
  t = feed(m, t, 3);
  m.nextPrompt();
  const fm = m.snapshot();
  check("map frozen after the last prompt", fm.phase === "mapped" && fm.map?.nReady >= 2, JSON.stringify(fm.map));
  const sdW = fm.map.sdW;
  check("units = pooled within-cell SD of the bins", sdW > 0.005 && sdW < 0.05, `sdW ${sdW.toFixed(4)}`);

  // usual voice -> reading near 0; heavier by 3 own-SD -> ~ +3 after the 3-bin median
  t = feed(m, t, 6);
  const r0 = m.snapshot().reading;
  check("usual voice reads near the centre (noise ~0.6 units)", r0 && Math.abs(r0.rw) < 2 && Math.abs(r0.rc) < 2, JSON.stringify(r0));
  t = feed(m, t, 6, { w: 3 * sdW, c: -2 * fm.map.sdC });
  const r1 = m.snapshot().reading;
  check("heavier / breathier change reads as +3 / -2 own units", r1 && Math.abs(r1.rw - 3) < 0.8 && Math.abs(r1.rc + 2) < 0.8, JSON.stringify(r1));
  check("display = median of the last 3 bins", r1.n === 3);
  check("10-s trail kept", m.snapshot().trail.length >= 5 && m.snapshot().trail.every((p) => p.age >= 0 && p.age < 10));

  t = feed(m, t, 6, { f0: 300 });
  check("unmapped pitch -> no reading", m.snapshot().reading === null && m.snapshot().reason === REASONS.cell);
  t = feed(m, t, 6, { vtln: 0.08 });
  check("resonance moved > 0.05 ln -> paused", m.snapshot().reason === REASONS.resonance);
  t = feed(m, t, 6, { held: true });
  check("held vowel -> speak in sentences", m.snapshot().reason === REASONS.speech);
  t = feed(m, t, 6);
  check("reading back after running speech", m.snapshot().reading !== null);

  const saved = m.exportMap();
  m.setCapture({ autoGainControl: false, deviceId: "mic-B" });
  feed(m, t, 4);
  check("different microphone -> map again", m.snapshot().reason === REASONS.device);

  const m2 = createWeightMap();
  m2.setCapture({ autoGainControl: false, deviceId: "mic-A" });
  check("restore a saved map", m2.restore(saved) && m2.snapshot().phase === "mapped");
  let t2 = feed(m2, 100, 6, { w: 3 * sdW });
  const r2 = m2.snapshot().reading;
  check("restored map reads the same", r2 && Math.abs(r2.rw - 3) < 0.8, JSON.stringify(r2));
  feed(m2, t2, 2, { f0: 0.0001 });
  m2.finish();
  check("pause counters are kept", m2.snapshot().counts.readable > 0);

  const m3 = createWeightMap();
  m3.setCapture({ autoGainControl: false, deviceId: "x" });
  m3.startMapping();
  feed(m3, 0, 3);
  m3.finishMapping();
  check("too little speech: map not made, note shown", m3.snapshot().phase === "unmapped" && !!m3.snapshot().note);
}

// ---------------------------------------------------------------- 3. engine glue
{
  const assets = path.join(repo, "public/resonance-lab");
  const vtlnModel = json(path.join(assets, "vtln_warp.json"));
  const reference = json(path.join(assets, "reference.json"));
  const x = readWav16(path.join(FIX, "ls_woman_high.wav"), Float32Array);
  const run = (withTap) => {
    const eng = createLabEngine({ sampleRate: 16000, models: { vtln: vtlnModel }, reference });
    const bins = [];
    const wl = withTap ? createWeightLab(model) : null;
    if (wl) { wl.map.setCapture({ autoGainControl: false, deviceId: "d" }); eng.setFrameTap(wl); }
    const orig = [];
    for (let rep = 0; rep < 3; rep++) {
      for (let i = 0; i + 400 <= x.length; i += 400) {
        eng.pushChunk(x.subarray(i, i + 400));
        const sn = eng.snapshot().finalists.vtln;
        orig.push(sn ? sn.raw : null);
      }
    }
    eng.finish();
    if (wl) { wl.map.finish(); bins.push(wl.map.snapshot().counts); }
    return { orig, bins, wl };
  };
  const a = run(false), b = run(true);
  check("engine outputs unchanged with the tap attached", a.orig.length === b.orig.length && a.orig.every((v, i) => v === b.orig[i]));
  const counts = b.bins[0];
  check("weight bins at 1-s spacing from the internal pitch path", counts.bins >= 13 && counts.bins <= 16 && counts.valid >= 10, JSON.stringify(counts));
  check("feature frames computed", b.wl.featureFrames > 300, `${b.wl.featureFrames} frames, ${(b.wl.cpuMs / 15).toFixed(1)} ms CPU per s of audio (Node)`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall weight-lab checks passed");
process.exit(failures ? 1 : 0);

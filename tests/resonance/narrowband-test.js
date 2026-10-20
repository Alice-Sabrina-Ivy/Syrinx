// narrowband-test.js — the shipped phone-quality audio detector
// (src/resonance/narrowband.js) is exactly the one measured in
// measurements/resonance-narrowband-2026-10-19.md (round 4, held-out PASS).
//
//   A  module fixtures (synthetic 16 kHz noise): wideband noise decides
//      "off" at 3 s of voiced frames; 3.4 kHz low-passed noise turns on at
//      exactly 3 s, not before; the 6 dB hysteresis holds the notice while F
//      sits between T_on and T_on + H and clears it only above; it comes
//      back on when narrowband audio returns. Every frame equals
//      scripts/resonance-narrowband/detector.mjs (pair C, selected point)
//      bit for bit (===).
//   B  shipped path vs measured harness: the three committed 5 s LibriSpeech
//      lab fixtures (tests/resonance-lab/fixtures/) concatenated, at 48 kHz
//      (the lab's band-limited upsample), wideband and 3.4 kHz low-passed
//      (a phone-band stand-in). The measured harness
//      (scripts/resonance-narrowband/extract.mjs, a subprocess: REAL pitch
//      worker + REAL lab engine) gives per-voiced-frame band energies, run
//      through detector.mjs's decision; the REAL resonance worker
//      (src/resonance/resonance-worker.js, fake `self`, fetch reading
//      public/) fed the same chunks and the REAL pitch worker's posts must
//      post the same { n, decided, on, f } (===) in every state message.
//      Fails on code without the detector (no narrowband field). Also: the
//      low-passed stream ends with the notice on and no resonance reading
//      (the cue drops its bins), the wideband stream with the notice off and
//      a reading.
//
//   node tests/resonance/narrowband-test.js

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { createNarrowbandDetector, NARROWBAND } = await imp("src/resonance/narrowband.js");
const H = await imp("scripts/resonance-narrowband/detector.mjs");
const { upsample } = await imp("scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs");

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

// The selected point (round 4): band C, τ 8 s, V_min 3 s, H 6 dB, T_on −34 dB.
check("shipped constants = the selected point",
  NARROWBAND.band === "C" && NARROWBAND.tauS === 8 && NARROWBAND.vMinS === 3 && NARROWBAND.hystDb === 6 && NARROWBAND.tOnDb === -34);

// ---- signals ----
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
const noise = (n, g = 0.3) => { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = g * rnd(); return x; };
// windowed-sinc low-pass (Blackman), zero-phase, same length
function lowpass(x, fcHz, sr, half = 200) {
  const fc = fcHz / sr, taps = new Float64Array(2 * half + 1);
  let s = 0;
  for (let t = -half; t <= half; t++) {
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const w = 0.42 + 0.5 * Math.cos((Math.PI * t) / half) + 0.08 * Math.cos((2 * Math.PI * t) / half);
    taps[t + half] = sinc * w; s += sinc * w;
  }
  for (let i = 0; i < taps.length; i++) taps[i] /= s;
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let a = 0;
    for (let t = -half; t <= half; t++) { const k = i - t; if (k >= 0 && k < x.length) a += taps[t + half] * x[k]; }
    y[i] = a;
  }
  return y;
}

// ---- A: module fixtures ----
console.log("\nA  module fixtures (synthetic, 16 kHz)");
{
  // Segments of 160 samples per voiced 10 ms frame; window = the 512 samples before c.
  const seg = (frames, gen) => gen(frames * 160);
  const wb = (n) => noise(n);
  const nbN = (n) => lowpass(noise(n), 3400, 16000);
  const mid = (n) => { const a = nbN(n), b = noise(n, 0.3 * 0.02); for (let i = 0; i < n; i++) a[i] += b[i]; return a; };
  // One stream: narrowband from the start, then a mix whose long-term F
  // settles between T_on and T_on + H, then wideband, then narrowband again.
  const plan = [["nb", 600, nbN], ["mid", 3000, mid], ["wb", 300, wb], ["nb2", 7000, nbN]];
  const parts = [new Float64Array(512)];
  for (const [, f, g] of plan) parts.push(seg(f, g));
  const x = new Float64Array(parts.reduce((a, p) => a + p.length, 0));
  { let o = 0; for (const p of parts) { x.set(p, o); o += p.length; } }
  const get = (i) => (i >= 0 && i < x.length ? x[i] : 0);

  const ship = createNarrowbandDetector();
  const ref = H.createNarrowbandDetector({ band: "C", tauS: 8, vMinS: 3, hystDb: 6, tOnDb: -34 });
  const win = new Float64Array(H.N);
  let c = 512, exact = true, frames = 0;
  const trace = {};
  for (const [name, f] of plan) {
    trace[name] = [];
    for (let k = 0; k < f; k++) {
      c += 160;
      for (let i = 0; i < H.N; i++) win[i] = get(c - H.N + i);
      const a = { ...ship.frame(get, c) }, b = ref.frame(win);
      if (a.f !== b.f || a.on !== b.on || a.decided !== b.decided || a.n !== b.n) exact = false;
      trace[name].push(a);
      frames++;
    }
  }
  check("every frame === detector.mjs (pair C, selected point)", exact, `${frames} frames`);
  const n0 = trace.nb;
  check("narrowband from the start: on at exactly 3 s voiced, not before",
    n0.slice(0, 299).every((s) => !s.on && !s.decided) && n0.slice(299).every((s) => s.on), `F at 3 s ${n0[299].f.toFixed(1)} dB`);
  const m = trace.mid;
  check("hysteresis: stays on while −34 < F ≤ −28 dB", m.every((s) => s.on) && m[m.length - 1].f > -34 && m[m.length - 1].f <= -28,
    `F settles at ${m[m.length - 1].f.toFixed(1)} dB`);
  const off = trace.wb.findIndex((s) => !s.on);
  check("clears once F > −28 dB when wideband audio returns",
    off >= 0 && trace.wb[off].f > -28 && (off === 0 ? m[m.length - 1].f : trace.wb[off - 1].f) <= -28 && trace.wb.slice(off).every((s) => !s.on),
    `after ${off + 1} voiced frames`);
  // From a wideband history the long-term F falls slowly (τ 8 s of voiced audio).
  const back = trace.nb2.findIndex((s) => s.on);
  check("wideband → narrowband mid-stream: on once F < −34 dB (slow: τ is 8 voiced s)",
    back > 0 && trace.nb2[back].f < -34 && trace.nb2[back - 1].f >= -34 && trace.nb2.slice(back).every((s) => s.on),
    `after ${((back + 1) / 100).toFixed(1)} s voiced`);

  // Fresh wideband stream: decided off at V_min.
  const wb0 = noise(500 * 160 + 512);
  const d0 = createNarrowbandDetector();
  const r0 = H.createNarrowbandDetector({ band: "C", tauS: 8, vMinS: 3, hystDb: 6, tOnDb: -34 });
  const gw = (i) => (i >= 0 && i < wb0.length ? wb0[i] : 0);
  const sw = [];
  let ex0 = true;
  for (let k = 1; k <= 500; k++) {
    for (let i = 0; i < H.N; i++) win[i] = gw(512 + 160 * k - H.N + i);
    const a = { ...d0.frame(gw, 512 + 160 * k) }, b = r0.frame(win);
    if (a.f !== b.f || a.on !== b.on || a.decided !== b.decided) ex0 = false;
    sw.push(a);
  }
  check("wideband from the start: undecided before 3 s voiced, then off; === detector.mjs",
    ex0 && sw.slice(0, 299).every((s) => !s.decided) && sw.slice(299).every((s) => s.decided && !s.on), `F at 5 s ${sw[499].f.toFixed(1)} dB`);
}

// ---- B: shipped path vs measured harness ----
console.log("\nB  real resonance worker vs measured harness (LibriSpeech lab fixtures)");
function readWav16(p) {
  const b = readFileSync(p);
  let off = 12, data = null;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === "data") { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  const x = new Float32Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return x;
}
const FIX = path.join(repo, "tests/resonance-lab/fixtures");
const parts16 = ["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"].map((n) => readWav16(path.join(FIX, `${n}.wav`)));
const x16 = new Float64Array(parts16.reduce((a, p) => a + p.length, 0));
{ let o = 0; for (const p of parts16) { x16.set(p, o); o += p.length; } }
const streams = {
  wideband: Float32Array.from(upsample(x16)),
  lowpass34: Float32Array.from(upsample(lowpass(x16, 3400, 16000))),
};

// measured harness (subprocess)
const tmp = mkdtempSync(path.join(tmpdir(), "syrinx-nb-"));
const harness = {};
try {
  const items = [];
  for (const [name, y] of Object.entries(streams)) {
    const f = path.join(tmp, `${name}.f32`);
    writeFileSync(f, Buffer.from(y.buffer, y.byteOffset, y.byteLength));
    items.push(`${name}=${f}`);
  }
  const out = path.join(tmp, "feat.f64");
  const r = spawnSync(process.execPath, [path.join(repo, "scripts/resonance-narrowband/extract.mjs"), out, "48000", ...items], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`extract.mjs failed: ${r.stderr}`);
  const b = readFileSync(out);
  const f = new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8);
  const names = Object.keys(streams);
  let o = 0;
  while (o < f.length) {
    const k = f[o], nv = f[o + 2];
    o += 3;
    const dec = H.createDecision({ tauS: 8, vMinS: 3, hystDb: 6, tOnDb: -34 });
    const [hi, ref] = H.PAIRS.C;
    const st = [null]; // st[n] = state after n voiced frames
    for (let v = 0; v < nv; v++, o += 5) st.push({ ...dec.push(f[o + 1 + hi], f[o + 1 + ref]) });
    harness[names[k]] = st;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// real workers
let sink = [];
globalThis.self = { postMessage: (m) => sink.push(m) };
globalThis.fetch = async (url) => {
  const name = String(url).split("/").pop();
  try {
    const body = readFileSync(path.join(repo, "public", "resonance-lab", name), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => null };
  }
};
await imp("src/resonance/resonance-worker.js");
const resOnMessage = self.onmessage;
let inst = 0;

for (const [name, y] of Object.entries(streams)) {
  // a fresh pitch worker module per stream, as extract.mjs runs it
  await import(pathToFileURL(path.join(repo, "src/dsp/pitch-worker.js")).href + `?nb=${inst++}`);
  const pitchOnMessage = self.onmessage;
  pitchOnMessage({ data: { type: "init", inputSampleRate: 48000 } });
  const pport = {};
  pitchOnMessage({ data: { type: "audioPort", port: pport } });
  sink = [];
  await resOnMessage({ data: { type: "init", sampleRate: 48000, assetBase: "/" } });
  const rport = {};
  resOnMessage({ data: { type: "audioPort", port: rport } });
  const states = [];
  for (let s = 0; s < y.length; s += 1200) {
    const x = y.slice(s, Math.min(y.length, s + 1200));
    const contextTime = Math.min(y.length, s + 1200) / 48000;
    sink = [];
    pport.onmessage({ data: { buffer: x.slice().buffer, contextTime } });
    const posts = sink.filter((m) => m.type === "pitch");
    sink = [];
    rport.onmessage({ data: { buffer: x.slice().buffer, contextTime } });
    for (const m of posts) resOnMessage({ data: { type: "pitch-hint", voiced: m.voiced, pitch: m.pitch, contextTime: m.contextTime } });
    states.push(...sink.filter((m) => m.type === "state"));
  }
  const ref = harness[name];
  const hasField = states.length > 0 && states.every((s) => s.narrowband && typeof s.narrowband.n === "number");
  check(`${name}: every state post carries the detector state`, hasField, `${states.length} posts`);
  let compared = 0, exact = hasField;
  for (const s of states) {
    if (!hasField || s.narrowband.n === 0) continue;
    const r = ref[s.narrowband.n];
    compared++;
    if (!r || r.f !== s.narrowband.f || r.on !== s.narrowband.on || r.decided !== s.narrowband.decided) exact = false;
  }
  const last = states[states.length - 1];
  check(`${name}: posted { n, decided, on, f } === measured harness`, exact && compared > 10,
    `${compared} posts compared, harness ${ref.length - 1} voiced frames`);
  if (name === "wideband") {
    check("wideband: decided, notice off, resonance reading present",
      last?.narrowband?.decided === true && last.narrowband.on === false && last.u !== null,
      `F ${last?.narrowband?.f?.toFixed(1)} dB, u ${last?.u?.toFixed(3)}`);
  } else {
    check("3.4 kHz low-pass: notice on, resonance reading withheld",
      last?.narrowband?.on === true && last.u === null,
      `F ${last?.narrowband?.f?.toFixed(1)} dB, first on at post ${states.findIndex((s) => s.narrowband?.on)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

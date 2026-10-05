// synth-cases.mjs — synthetic cases for the steadiness readout, through the
// REAL chain (pitch worker + DSP worker) and the REAL hook (every pitch
// message through handlePitchMessage, every DSP frame through
// handleAnalysisResult; chainlib.mjs driveHookMessages).
//
// Families (known smooth F0 contour = truth; per-cycle jitter excluded):
//   flat     held note, jitter/shimmer/aspiration only (truth SD 0)
//   vib      vibrato 4.5 / 5.5 / 6.5 Hz, extent +-25 / 50 / 100 cents
//   drift    linear slide 0.5–4 st/s
//   siren    sinusoidal +-6 st (2 s period), +-3 st (3 s), linear 12 st sweep
//   jump     held note, then an abrupt (or 80 ms) jump of +12 / +7 / -12 st
//   short    0.5 / 0.8 / 1.2 s notes separated by 0.4 s gaps
//   noisy    slow-wander note in pink / fan-hum / white noise at 20 / 10 / 5 dB SNR
//   noise    noise only (every committed noise-synth class + babble + resonant
//            Q5 / Q2), 30 s, several seeds — the readout must show "—"
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/steadiness/synth-cases.mjs \
//        [--src=src] [--out=build/steady/synth] [--shard=i/n] [--families=flat,vib,...]
// Output: <out>/cases_<i>.json — per case: params, hop, L, post (posted Hz,
// 0 = unvoiced, detection-column convention), hook steady/held per display
// hop, truth contour (tTruth / fTruth on a 5 ms grid, 0 = silent).
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadSrc, runWorkers } from "../session-oracle/lib/chain.mjs";
import { synth, wander, rng } from "../pitch-precision/lib.mjs";
import { NOISE_TYPES, babble } from "../noise-synth.js";
import { driveHookMessages } from "./chainlib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const S = await loadSrc(args.src ?? "src");
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
const FAM = new Set((args.families ?? "flat,vib,drift,siren,jump,short,noisy,noise").split(","));
const OUT = resolve(args.out ?? "build/steady/synth");

const cases = [];
let id = 0;
const add = (c) => cases.push({ id: id++, sr: 48000, jitter: 0.005, shimmer: 0.03, snrDb: 30, vowel: "aieu"[id % 4], seed: 2000 + id, dur: 5, ...c });
if (FAM.has("flat")) for (const f0 of [90, 120, 165, 225, 300, 380]) for (const jitter of [0.003, 0.01]) for (const snrDb of [40, 20])
  add({ fam: "flat", f0, jitter, shimmer: jitter * 6, snrDb, contour: { k: "flat" } });
if (FAM.has("vib")) for (const f0 of [120, 225, 330]) for (const rate of [4.5, 5.5, 6.5]) for (const ext of [25, 50, 100])
  add({ fam: "vib", f0, contour: { k: "vib", rate, ext } });
if (FAM.has("drift")) for (const f0 of [110, 220]) for (const rate of [0.5, 1, 2, 4])
  add({ fam: "drift", f0, dur: 4, contour: { k: "drift", rate } });
if (FAM.has("siren")) for (const f0 of [150, 250]) {
  add({ fam: "siren", f0, dur: 6, contour: { k: "sine", amp: 600, period: 2 } });
  add({ fam: "siren", f0, dur: 6, contour: { k: "sine", amp: 300, period: 3 } });
  add({ fam: "siren", f0: f0 / 2, dur: 5, contour: { k: "sweep", st: 12, t0: 1.5, t1: 2.5 } });
}
if (FAM.has("jump")) for (const [f0, st] of [[110, 12], [200, 12], [220, -12], [140, 7], [250, -7]]) for (const glide of [0, 0.08])
  add({ fam: "jump", f0, dur: 5, contour: { k: "jump", st, at: 2.5, glide } });
if (FAM.has("short")) for (const f0 of [140, 260]) add({ fam: "short", f0, dur: 4.5, contour: { k: "wander", sd: 15 }, gates: [[0.2, 0.7], [1.1, 1.9], [2.3, 3.5]] });
if (FAM.has("noisy")) for (const f0 of [120, 225]) for (const nz of ["pink", "fan-hum", "white"]) for (const snr of [20, 10, 5])
  add({ fam: "noisy", f0, sr: 16000, contour: { k: "wander", sd: 30 }, noise: nz, noiseSnr: snr });
if (FAM.has("noise")) for (const nz of [...Object.keys(NOISE_TYPES), "babble", "resonant-noise-q5", "resonant-noise-q2"])
  for (let s = 0; s < (nz === "mains-complex" ? 1 : 4); s++) add({ fam: "noise", sr: 16000, dur: 30, noise: nz, noiseSeed: s === 0 ? undefined : 1000 + s });

function contourFn(c) {
  const k = c.contour?.k;
  if (k === "flat") return () => 0;
  if (k === "vib") return (t) => c.contour.ext * Math.sin(2 * Math.PI * c.contour.rate * t);
  if (k === "drift") return (t) => c.contour.rate * 100 * (t - c.dur / 2);
  if (k === "sine") return (t) => c.contour.amp * Math.sin(2 * Math.PI * t / c.contour.period);
  if (k === "sweep") return (t) => 100 * c.contour.st * Math.min(1, Math.max(0, (t - c.contour.t0) / (c.contour.t1 - c.contour.t0)));
  if (k === "jump") { const { st, at, glide } = c.contour; return (t) => 100 * st * (glide > 0 ? Math.min(1, Math.max(0, (t - at) / glide)) : (t >= at ? 1 : 0)); }
  if (k === "wander") return wander(c.seed, c.contour.sd);
  throw new Error(`contour ${k}`);
}

let hillSrc = null;
async function noiseSig(name, n, seed) {
  if (name === "babble") {
    if (!hillSrc) {
      const { loadAllCorpora } = await import("../../tests/dsp/data/corpora.js");
      const { resampleLinear } = await import("../../tests/dsp/swift-f0-adapter.js");
      hillSrc = loadAllCorpora().filter((t) => t.corpus === "hillenbrand").slice(0, 40).filter((_, i) => i % 5 === 0)
        .map((t) => (t.sampleRate === 16000 ? t.samples : resampleLinear(t.samples, t.sampleRate, 16000)));
    }
    return babble(n, hillSrc, seed);
  }
  if (name === "resonant-noise-q5") return NOISE_TYPES["resonant-noise"](n, seed ?? 11, 330, 5);
  if (name === "resonant-noise-q2") return NOISE_TYPES["resonant-noise"](n, seed ?? 11, 330, 2);
  return NOISE_TYPES[name](n, seed);
}

const PRE = 0.5, POST = 0.5;
const out = [];
for (const c of cases.filter((_, i) => i % shN === shI)) {
  const sr = c.sr;
  let x, tTruth = [], fTruth = [];
  if (c.fam === "noise") {
    const nz = await noiseSig(c.noise, c.dur * sr, c.noiseSeed);
    x = Float32Array.from(nz, (v) => v * 0.03); // the shootout's ambient scale
  } else {
    const sig = synth({ sr, dur: c.dur, f0: c.f0, contour: contourFn(c), jitter: c.jitter, shimmer: c.shimmer, snrDb: c.snrDb, vowel: c.vowel, seed: c.seed });
    const gate = (t) => {
      if (!c.gates) return 1;
      for (const [a, b] of c.gates) { if (t >= a && t < b) return Math.min(1, (t - a) / 0.02, (b - t) / 0.02); }
      return 0;
    };
    const pre = Math.round(PRE * sr), post = Math.round(POST * sr);
    x = new Float32Array(pre + sig.x.length + post);
    const nr = rng(c.seed + 7); for (let i = 0; i < x.length; i++) x[i] = 0.0005 * nr.g();
    for (let i = 0; i < sig.x.length; i++) x[pre + i] += sig.x[i] * gate(i / sr);
    if (c.noise) {
      const nz = await noiseSig(c.noise, x.length, c.seed);
      let r = 0; for (const v of nz) r += v * v; r = Math.sqrt(r / nz.length);
      const g = 0.1 * Math.pow(10, -c.noiseSnr / 20) / r; // voice RMS ~0.1
      for (let i = 0; i < x.length; i++) x[i] += g * nz[i];
    }
    for (let t = 0; t < c.dur; t += 0.005) {
      tTruth.push(+(t + PRE).toFixed(4));
      fTruth.push(gate(t) > 0.5 ? sig.fSmooth[Math.min(sig.fSmooth.length - 1, Math.round(t * sr))] : 0);
    }
  }
  const W = runWorkers(S, x, sr);
  const H = await driveHookMessages(S.hookPath, W);
  out.push({ ...c, hop: W.C / W.sr, L: W.L, pre: c.fam === "noise" ? 0 : PRE,
    post: Array.from(W.col.post), hookSteady: Array.from(H.steady, (v) => (Number.isNaN(v) ? null : v)), hookHeld: Array.from(H.held),
    msgs: H.msgs.map((m) => [m.contextTime, m.pitch ?? 0]), tTruth, fTruth });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, `cases_${shI}.json`), JSON.stringify(out));
console.log(`shard ${shI}/${shN}: ${out.length} cases`);

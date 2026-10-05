// fda.mjs — FDA-speech interferer grid of the 2026-10-04 suite (after the scratch suite-noise.mjs of the 6f8be18 pass), through the
// REAL pitch worker (16 kHz). Parts:
//   nonly  — 40 s noise-only per class (0.05 scale): FV/painted over 0-10 s
//            and 10-40 s, promotion time; tonal classes also with a 100 ms
//            digital-zero lead (capture-start probe)
//   start  — interferer from t=0, FDA speech from 3 s (33 s): speech correct,
//            pause FV over [3, 33]
//   midsp  — switch-on at 20 s during continuous FDA speech (the 2026-10-03
//            onset-mid design, 70 s): scored [20, 50]
//   midpa  — speech 0-15 s, silence 15-40 s, interferer on at 20 s, speech
//            again 40-70 s: FV over [20, 40], speech/gap FV over [40, 70]
//   node scripts/notch-adversarial/fda.mjs --part=nonly|start|midsp|midpa --variants=B,N2 --shard=i/n --out=FILE
import { writeFileSync } from "node:fs";
import { loadFda } from "../../tests/dsp/data/corpora.js";
import { resampleLinear } from "../../tests/dsp/swift-f0-adapter.js";
import { NOISE_TYPES, activeRms } from "../../scripts/noise-synth.js";
import { runWorker, displayed } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const VARS = (args.variants || "HEAD").split(",");
const PART = args.part || "nonly";
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);
const SR = 16000;

function rumble(n, seed, corner = 0.056) { let a = seed >>> 0 || 1, lp = 0; const x = new Float32Array(n); for (let i = 0; i < n; i++) { a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0; lp += corner * ((a / 0x7fffffff - 1) - lp); x[i] = lp; } return x; }
function norm(x) { let s = 0; for (const v of x) s += v * v; const r = Math.sqrt(s / x.length) || 1; for (let i = 0; i < x.length; i++) x[i] /= r; return x; }
function hum(n, fOf, amps, rumbleGain = 2.2, seed = 3) {
  const r = rumble(n, seed); const x = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { ph += 2 * Math.PI * fOf(i / SR) / SR; let s = 0; for (let k = 0; k < amps.length; k++) s += amps[k] * Math.sin((k + 1) * ph + k * 1.1); x[i] = s + rumbleGain * r[i]; }
  return norm(x);
}
const FAN = [1, 0.25, 0.12];
// the 2026-10-03 notch agent's extra classes (noise-fv.mjs), length-parameterized
const EXTRA = {
  "fan-wobble0.6": (n) => hum(n, (t) => 120 + 0.6 * Math.sin(2 * Math.PI * 0.05 * t) + 0.18 * Math.sin(2 * Math.PI * 0.135 * t), FAN),
  "fan-wobble1.5": (n) => hum(n, (t) => 120 + 1.5 * Math.sin(2 * Math.PI * 0.1 * t) + 0.45 * Math.sin(2 * Math.PI * 0.27 * t), FAN),
  "fan-drift": (n) => hum(n, (t) => 118 + 4 * t / 40, FAN),
  "hum-rich60": (n) => hum(n, (t) => 60 + 0.02 * Math.sin(2 * Math.PI * 0.07 * t), [0.5, 1, 0.8, 0.6, 0.5, 0.45, 0.4, 0.3, 0.3, 0.25, 0.2, 0.2, 0.15, 0.15, 0.1, 0.1], 0.6),
  "hum-rich120": (n) => hum(n, () => 120, [1, 0.7, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15], 1.0),
  "fan-wobble0.6+rich": (n) => hum(n, (t) => 120 + 0.6 * Math.sin(2 * Math.PI * 0.05 * t), [1, 0.5, 0.35, 0.25, 0.2, 0.15], 1.5),
};
const GEN = { ...Object.fromEntries(Object.entries(NOISE_TYPES).map(([k, g]) => [k, (n) => norm(g(n))])), ...EXTRA };
const TONAL = ["fan-hum", "mains-complex", "sleep-birdies", "fan-wobble0.6", "fan-wobble1.5", "fan-drift", "hum-rich60", "hum-rich120", "fan-wobble0.6+rich"];
const LINES = { "fan-hum": [120, 240, 360], "mains-complex": [60, 120, 180, 240], "sleep-birdies": [72.7, 87, 145, 174], "fan-wobble0.6": [120, 240, 360], "fan-wobble1.5": [120, 240, 360], "fan-drift": [118, 120, 122, 240], "hum-rich60": [60, 120, 180, 240, 300, 360, 420], "hum-rich120": [120, 240, 360, 480], "fan-wobble0.6+rich": [120, 240, 360] };
const promoOf = (msgs, nz, after = 0) => {
  for (const m of msgs) if (m.t > after && m.nf) return +(m.t - after).toFixed(1);
  return null;
};

const fda = loadFda();
// FDA stream with refs on a 10 ms grid; `spans` = [[t0, t1]] where speech is laid
function stream(dur, offset, spans) {
  const x = new Float32Array(Math.round(dur * SR)); const ref = new Float32Array(Math.ceil(dur * 100) + 20);
  let i = offset, g = 0;
  for (const [a, b] of spans) {
    let pos = Math.round(a * SR);
    while (pos < Math.round(b * SR)) {
      const t = fda[i % fda.length]; i++;
      const s = t.sampleRate === SR ? t.samples : resampleLinear(t.samples, t.sampleRate, SR);
      const len = Math.min(s.length, Math.round(b * SR) - pos); x.set(s.subarray(0, len), pos);
      for (let r = 0; r < t.ref.f0.length; r++) { const tt = pos / SR + r * t.ref.hopMs / 1000; const k = Math.round(tt * 100); if (k < ref.length && r * t.ref.hopMs / 1000 < len / SR) ref[k] = t.ref.f0[r]; }
      pos += len + Math.round((0.4 + 0.8 * ((g++ * 0.618) % 1)) * SR);
    }
  }
  // -70 dB floor
  let s = 12345; for (let k = 0; k < x.length; k++) { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; x[k] += 0.0003 * (s / 0x7fffffff - 1); }
  return { x, ref };
}
function scoreSpeech(msgs, ref, t0, t1) {
  let n = 0, ok = 0, nul = 0, gapN = 0, gapV = 0;
  for (const m of msgs) {
    const t = m.t; if (t < t0 || t > t1) continue;
    const k = Math.round(t * 100); const f = ref[k];
    if (f > 0) { n++; if (!(m.pitch > 0)) nul++; else if (Math.abs(m.pitch / f - 1) < 0.05) ok++; }
    else {
      let far = true; for (let d = -15; d <= 15; d++) if (ref[k + d] > 0) { far = false; break; }
      if (far) { gapN++; if (m.pitch > 0) gapV++; }
    }
  }
  return { correct: +(100 * ok / Math.max(1, n)).toFixed(1), null: +(100 * nul / Math.max(1, n)).toFixed(1), gapFV: +(100 * gapV / Math.max(1, gapN)).toFixed(1), n, gapN };
}

const jobs = [];
if (PART === "nonly") {
  for (const nz of Object.keys(GEN)) for (const lead of TONAL.includes(nz) ? [0, 0.1] : [0]) jobs.push({ nz, lead });
} else if (PART === "start" || PART === "midsp" || PART === "midpa") {
  const classes = ["fan-hum", "mains-complex", "sleep-birdies", "fan-wobble0.6", "fan-drift", "hum-rich120", "hum-rich60"];
  for (const nz of classes) for (const snr of [10, 5]) for (const offset of [0, 37]) jobs.push({ nz, snr, offset });
}
const mine = jobs.filter((_, i) => i % shN === shI);
const rows = [];
for (const job of mine) {
  let sig, scoreFn;
  if (PART === "nonly") {
    const n = 40 * SR, z = Math.round(job.lead * SR);
    const nzs = GEN[job.nz](n);
    sig = new Float32Array(n + z);
    for (let i = 0; i < n; i++) sig[z + i] = 0.05 * nzs[i];
    scoreFn = (msgs) => {
      const d = displayed(msgs);
      let a = 0, av = 0, ap = 0, b = 0, bv = 0, bp = 0;
      msgs.forEach((m, i) => { if (m.t < 10) { a++; if (m.pitch > 0) av++; if (d[i] > 0) ap++; } else { b++; if (m.pitch > 0) bv++; if (d[i] > 0) bp++; } });
      return { fv0: +(100 * av / a).toFixed(1), painted0: +(100 * ap / a).toFixed(1), fv: +(100 * bv / b).toFixed(2), painted: +(100 * bp / b).toFixed(2), promo: promoOf(msgs, job.nz), final: msgs[msgs.length - 1].nf ?? [] };
    };
  } else {
    const DUR = PART === "start" ? 33 : 70;
    const spans = PART === "start" ? [[3, 33]] : PART === "midsp" ? [[0.5, 70]] : [[0.5, 15], [40, 70]];
    const { x, ref } = stream(DUR, job.offset, spans);
    const sp = activeRms(x);
    const g = sp * Math.pow(10, -job.snr / 20);
    const T_ON = PART === "start" ? 0 : 20;
    const noise = GEN[job.nz](DUR * SR);
    sig = Float32Array.from(x);
    for (let i = Math.round(T_ON * SR); i < sig.length; i++) sig[i] += g * noise[i];
    scoreFn = (msgs) => {
      if (PART === "start") return { ...scoreSpeech(msgs, ref, 3, 33), early: scoreSpeech(msgs, ref, 3, 10), promo: promoOf(msgs, job.nz) };
      if (PART === "midsp") return { ...scoreSpeech(msgs, ref, 20, 50), promo: promoOf(msgs, job.nz, 20) };
      const pause = msgs.filter((m) => m.t >= 20.6 && m.t < 40);
      return { pauseFV: +(100 * pause.filter((m) => m.pitch > 0).length / pause.length).toFixed(1), ...scoreSpeech(msgs, ref, 40, 70), promo: promoOf(msgs, job.nz, 20) };
    };
  }
  const row = { part: PART, ...job, v: {} };
  for (const vn of VARS) row.v[vn] = scoreFn(runWorker(VARIANTS[vn], sig, SR));
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (args.out) writeFileSync(args.out, JSON.stringify(rows));

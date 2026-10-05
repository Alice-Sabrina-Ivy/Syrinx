// dense.mjs — the latch's cost case: an interferer switching on during DENSE
// speech (syllable gaps 40-120 ms, a 1.2 s pause every 8 s), where HEAD's
// obs-level onset sees no 10 dB rise (2 s minimum = speech level) and
// promotes at ~5 s, while the in-sound latch makes the line onset-born
// (20 s). Synthetic speech (truth known), 40 s, interferer on at 10 s.
//   node scripts/notch-adversarial/dense.mjs --variants=B,H,N2 [--out=F]
import { synth } from "./synth.mjs";
import { mulberry } from "./synth.mjs";
import { NOISE_TYPES, activeRms } from "../../scripts/noise-synth.js";
import { EXTRA_NOISE } from "./extra-noise.mjs";
import { runWorker } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const VARS = (args.variants || "HEAD,NEW").split(",");
const SR = +(args.sr || 16000), DUR = 60, T_ON = 10;   // round 1: 60 s (steady-state window after T_ON + 21 s)
function speech(center, seed) {
  const rnd = mulberry(seed); const syl = []; let t = 0.5, st = 0;
  while (t < DUR - 0.3) {
    if (Math.floor(t / 8) !== Math.floor((t + 0.3) / 8) || (t % 8) > 6.8) { t = Math.ceil(t / 8) * 8 + 0.05; continue; } // 1.2 s pause every 8 s
    const e = t + 0.12 + 0.18 * rnd(); st = Math.max(-4, Math.min(4, st + (rnd() - 0.5) * 3));
    syl.push({ a: t, b: e, f: center * Math.pow(2, st / 12), c: (rnd() - 0.5) * 4, v: ["a", "i", "u", "e"][Math.floor(rnd() * 4)] });
    t = e + 0.04 + 0.08 * rnd();
  }
  const find = (t) => syl.find((y) => t >= y.a && t <= y.b);
  const f0At = (t) => { const q = find(t); return q ? q.f * Math.pow(2, q.c * ((t - q.a) / (q.b - q.a) - 0.5) / 12) : 0; };
  const x = synth({ sr: SR, dur: DUR, f0At, ampAt: (t) => { const q = find(t); return q ? Math.max(0, Math.min(1, (t - q.a) / 0.02, (q.b - t) / 0.02)) : 0; }, vowelAt: (t) => find(t)?.v ?? "a", seed });
  return { x, f0At };
}
const GEN = { ...NOISE_TYPES, ...EXTRA_NOISE };
const out = [];
for (const center of [120, 210]) for (const nz of ["fan-hum", "mains-complex", "hum-rich120", "fan-wobble0.6"]) for (const snr of [10, 5]) {
  const { x, f0At } = speech(center, center + snr);
  const g = activeRms(x) * Math.pow(10, -snr / 20), noise = GEN[nz](DUR * SR);
  const sig = Float32Array.from(x, (v, i) => v + (i >= T_ON * SR ? g * noise[i] : 0));
  const row = { center, nz, snr, v: {} };
  for (const vn of VARS) {
    const msgs = runWorker(VARIANTS[vn], sig, SR);
    let n = 0, ok = 0, pn = 0, pv = 0, promo = null, sn = 0, sv = 0;
    for (const m of msgs) {
      if (promo === null && m.t > T_ON && m.nf) promo = +(m.t - T_ON).toFixed(1);
      if (m.t < T_ON || m.t > DUR - 0.5) continue;
      const f = f0At(m.t);
      let far = true; for (let d = -0.15; d <= 0.15; d += 0.025) if (f0At(m.t + d) > 0) { far = false; break; }
      if (f > 0) { n++; if (m.pitch > 0 && Math.abs(m.pitch / f - 1) < 0.05) ok++; }
      else if (far) { pn++; if (m.pitch > 0) pv++; if (m.t >= T_ON + 21) { sn++; if (m.pitch > 0) sv++; } }
    }
    row.v[vn] = { correct: +(100 * ok / n).toFixed(1), pauseFV: +(100 * pv / Math.max(1, pn)).toFixed(1), fvSS: +(100 * sv / Math.max(1, sn)).toFixed(1), promo };
  }
  out.push(row); console.log(JSON.stringify(row));
}
const mean = (vn, f) => (out.reduce((a, r) => a + r.v[vn][f], 0) / out.length).toFixed(1);
console.log("MEAN", VARS.map((vn) => `${vn}: correct ${mean(vn, "correct")} pauseFV ${mean(vn, "pauseFV")} fvSS ${mean(vn, "fvSS")}`).join(" | "));
if (args.out) (await import("node:fs")).writeFileSync(args.out, JSON.stringify(out));

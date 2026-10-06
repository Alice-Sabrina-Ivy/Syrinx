// vmach.mjs — voice-like machine interferers (2026-10-06 fix round, review of
// the V14 follow-up): a harmonic stack (1 / 0.5 / 0.3, rms 0.02, phase-locked
// to one rotating phase) whose speed wobbles in the 0.5-8 Hz band the voice
// verdict reads, SHARED by every partial (a motor / fan speed ripple). No
// earlier interferer family had in-band shared FM (their wobbles sit at
// 0.05-0.27 Hz), so none could exercise the voice-like-machine class that
// ~2 % of real machine lines fall into. Present from t = 0 (the class voice
// timing exists for: not onset-born), 30 s, no voice: every frame painted is
// false voicing.
//   --part=steady  f0 77 / 95 / 120 / 150 / 210 / 300 / 390 Hz; shared FM
//                  sin 1 / 2 / 4 Hz x 3 / 5 / 8 / 10 c, or OU (tau 0.15 s)
//                  3 / 6 / 10 c; white noise none / rms 0.005 (210 cells)
//   --part=edge    as steady at 73 / 74 / 401 / 402 Hz: just outside the
//                  display band, inside the coherence band's 3 Hz margin
//   --part=ramp    a spin-up / approach: the level ramps -8 / -12 dB -> 0
//                  over 1 / 2 / 3 s starting at 0 / 1 / 2.5 s; f0 95 / 120 /
//                  150 Hz, sin 3 Hz 5 c (54 cells)
// Metrics per variant: first notch per line (f0, 2 f0, 3 f0, +-3 %), worker /
// painted false voicing over the stream. Strict rule vs the first variant
// (bc42ad0), per LINE: every line it notched notched no later than
// max(6 s, its time + 0.3 s); painted FV <= its + 2 pp.
//   node scripts/notch-adversarial/vmach.mjs --part=steady|ramp|all --variants=B,V14,SRC [--sr=16000,48000] [--shard=i/n] [--out=F]
import { writeFileSync } from "node:fs";
import { mulberry } from "./synth.mjs";
import { runWorker, displayed, parseArgs } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";

const args = parseArgs();
const VARS = (args.variants || "B,SRC").split(",");
const SRS = (args.sr || "16000").split(",").map(Number);
const PART = args.part || "all";
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);
const DUR = 30;
const cells = [];
for (const sr of SRS) {
  for (const [part, F0S] of [["steady", [77, 95, 120, 150, 210, 300, 390]], ["edge", [73, 74, 401, 402]]]) if (PART === part || (PART === "all" && part === "steady")) for (const f0 of F0S) for (const nz of [0, 0.005]) {
    for (const rate of [1, 2, 4]) for (const D of [3, 5, 8, 10]) cells.push({ part, sr, f0, nz, fm: `sin${rate}Hz${D}c`, rate, D });
    for (const sd of [3, 6, 10]) cells.push({ part, sr, f0, nz, fm: `ou${sd}c`, sd });
  }
  if (PART === "ramp" || PART === "all") for (const f0 of [95, 120, 150]) for (const T1 of [0, 1, 2.5]) for (const R of [1, 2, 3]) for (const dB of [8, 12])
    cells.push({ part: "ramp", sr, f0, nz: 0, fm: "sin3Hz5c", rate: 3, D: 5, T1, R, dB });
}
// OU cents process, sampled in time order
function ou(seed, tau, sd, sr) {
  const r = mulberry(seed); let v = 0, last = -1;
  const a = Math.exp(-1 / (tau * sr)), s = sd * Math.sqrt(1 - a * a);
  const g = () => { const u = Math.max(1e-12, r()), w = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
  return (t) => { const i = Math.round(t * sr); while (last < i) { v = a * v + s * g(); last++; } return v; };
}
export function machine(c) {
  const { sr, f0 } = c, n = DUR * sr, x = new Float32Array(n), amps = [1, 0.5, 0.3];
  const centsAt = c.sd ? ou(11 + f0, 0.15, c.sd, sr) : (t) => c.D * Math.sin(2 * Math.PI * c.rate * t + 0.3);
  const norm = Math.sqrt(amps.reduce((a, b) => a + b * b, 0) / 2), r = mulberry(5 + f0), rn = mulberry(99 + f0);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += 2 * Math.PI * f0 * Math.pow(2, centsAt(t) / 1200) / sr;
    let v = 0;
    for (let k = 0; k < amps.length; k++) v += amps[k] * Math.sin((k + 1) * ph + 0.7 * k);
    let g = 1;
    if (c.T1 !== undefined) g = Math.pow(10, (t < c.T1 ? -c.dB : t < c.T1 + c.R ? -c.dB + c.dB * (t - c.T1) / c.R : 0) / 20);
    x[i] = g * 0.02 * v / norm + 0.0003 * (2 * r() - 1) + (c.nz ? c.nz * Math.sqrt(3) * (2 * rn() - 1) : 0);
  }
  return x;
}
const rows = [];
let job = -1;
for (const c of cells) {
  if (++job % shN !== shI) continue;
  const x = machine(c);
  const lines = [c.f0, 2 * c.f0, 3 * c.f0];
  const row = { ...c, v: {} };
  for (const vn of VARS) {
    const msgs = runWorker(VARIANTS[vn], x, c.sr), disp = displayed(msgs);
    const promo = lines.map(() => null);
    let fv = 0, pfv = 0;
    msgs.forEach((m, i) => {
      if (m.nf) lines.forEach((L, k) => { if (promo[k] === null && m.nf.some((f) => Math.abs(f / L - 1) < 0.03)) promo[k] = +(m.t + 0.04).toFixed(2); });
      if (m.pitch > 0) fv++;
      if (disp[i] > 0) pfv++;
    });
    row.v[vn] = { promo, fv: +(100 * fv / msgs.length).toFixed(1), pfv: +(100 * pfv / msgs.length).toFixed(1) };
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (args.out) writeFileSync(args.out, JSON.stringify(rows));

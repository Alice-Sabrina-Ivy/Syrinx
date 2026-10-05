// r2int.mjs — round-2 interferer adversaries (2026-10-04): the scenario
// families the round-1 review confirmed against cb00425 (N13), ported from
// the reviewers' repro scripts into the suite (real worker, any rate).
// Parts:
//   step      — (finding 1) a hum switches on in SILENCE at 5 s (onset-born),
//               then changes frequency: step 115->121 Hz @+3 s, 110->120 @+2 s,
//               117->121.5 @+4 s, exponential spin-up, alternating 115/121 every
//               8 / 12 s, or steady; noise-only, dense (no >= 1.5 s pause) or
//               sparse (1.2 s pauses) speech from 10 s. 50 s.
//   masked    — (finding 2) a hum present from t = 0; a held note 4-5 Hz from it
//               at 1-5 s masks it (its track is pruned), then the note glides
//               up / steps into syllables / runs straight into syllables with
//               occasional short pauses (0.3 / 0.9 / 1.5 s). 45 s.
//   beatpause — (finding 3) a hum switches on in silence at 4 s; speech from 6 s
//               with frequent 0.25-0.6 s pauses; steady / AM (0.3, 0.15 Hz) /
//               beating (two fans 0.5 Hz apart, 2:1 and 1:1) hums; 12 seeds. 70 s.
//   shared    — (finding 5) a fan-like hum switches on in silence at 3 s; the
//               voice repeats held notes within ~3 Hz of it (one shared track)
//               in hold/breath cycles, the hum 16-30 dB under the voice. 45 s.
//   intermit  — a 120 Hz hum that itself switches fully off for 0.15-1 s every
//               5 / 8 s (noise-only). Signal-identical to repeated same-pitch
//               holds with silent breaths — documentation, see the measurement.
// Metrics per variant: promo (s after the hum's switch-on / stream start),
// fv / pfv (worker / painted pause false voicing over the part's scoring
// window), and part-specific extras (voice = painted held-note frames).
//   node scripts/notch-adversarial/r2int.mjs --part=step --variants=B,R1,R2 --sr=16000,48000 [--shard=i/n --out=F]
import { writeFileSync } from "node:fs";
import { synth, mulberry } from "./synth.mjs";
import { runWorker, displayed, parseArgs } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";

const args = parseArgs();
const VARS = (args.variants || "B").split(",");
const SRS = (args.sr || "16000").split(",").map(Number);
const PART = args.part || "step";
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);

function rumble(n, sr, seed) {
  const a = 1 - Math.exp(-2 * Math.PI * 150 / sr), g = Math.sqrt((0.056 / (2 - 0.056)) / (a / (2 - a)));
  const r = mulberry(seed); const x = new Float32Array(n); let lp = 0;
  for (let i = 0; i < n; i++) { lp += a * ((2 * r() - 1) - lp); x[i] = g * lp; }
  return x;
}
function humGen(n, sr, fOf, amps, rumbleGain, seed = 3) {
  const r = rumbleGain ? rumble(n, sr, seed) : null; const x = new Float32Array(n); let ph = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    ph += 2 * Math.PI * fOf(i / sr) / sr; let s = 0;
    for (let k = 0; k < amps.length; k++) s += amps[k] * Math.sin((k + 1) * ph + k * 1.1);
    x[i] = s + (r ? rumbleGain * r[i] : 0); ss += x[i] * x[i];
  }
  const rms = Math.sqrt(ss / n) || 1; for (let i = 0; i < n; i++) x[i] /= rms;
  return x;
}
function gaussNoise(n, rms, seed) { const r = mulberry(seed); const x = new Float32Array(n); for (let i = 0; i < n; i++) { const u = Math.max(1e-12, r()), v = r(); x[i] = rms * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); } return x; }
const finder = (syl) => (tt) => { let lo = 0, hi = syl.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (syl[m].b < tt) lo = m + 1; else if (syl[m].a > tt) hi = m - 1; else return syl[m]; } return null; };
const sylAmp = (find) => (tt) => { const q = find(tt); return q ? Math.max(0, Math.min(1, (tt - q.a) / 0.02, (q.b - tt) / 0.02)) : 0; };

// ---- jobs ----------------------------------------------------------------
const jobs = [];
if (PART === "step") {
  for (const sp of ["none", "dense", "sparse"]) for (const shape of ["step115", "step110", "step4", "spinup", "spinup2", "alt8", "alt12", "steady"]) for (const lvl of [0.01, 0.03]) jobs.push({ sp, shape, lvl });
} else if (PART === "masked") {
  for (const noteF of [125, 116]) for (const end of ["glide", "step", "speech"]) for (const pause of [0.3, 0.9, 1.5]) for (const cls of ["tone", "fan"]) for (const lvl of [0.01, 0.03]) jobs.push({ noteF, end, pause, cls, lvl });
  for (const end of ["glide", "step", "speech"]) for (const pause of [0.3, 0.9]) jobs.push({ noteF: 125, end, pause, cls: "mains", lvl: 0.01 });
} else if (PART === "beatpause") {
  for (let seed = 1; seed <= 12; seed++) for (const cls of ["tone3", "am", "am2", "beat", "beat11"]) for (const lvl of [0.004, 0.008]) jobs.push({ seed, cls, lvl });
} else if (PART === "shared") {
  for (const vf of [118.2, 120.5, 122.6]) for (const hum of [-16, -18, -25, -30]) for (const [hold, br] of [[2, 0.4], [1.5, 0.3], [1, 0.25], [4, 0.8], [4, 1.0], [4, 1.3]]) jobs.push({ vf, hum, hold, br });
} else if (PART === "intermit") {
  for (const per of [5, 8]) for (const off of [0.15, 0.3, 0.5, 1]) for (const lvl of [0.01, 0.03]) jobs.push({ per, off, lvl });
}
const all = [];
for (const j of jobs) for (const sr of SRS) all.push({ ...j, sr });
const mine = all.filter((_, i) => i % shN === shI);

const near3 = (f, lines) => lines.some((L) => Math.abs(f / L - 1) < 0.03);
function build(job) {
  const { sr } = job;
  if (PART === "step") {
    const dur = 50, n = dur * sr, ON = 5;
    const SH = {
      step115: (t) => (t < ON + 3 ? 115 : 121), step110: (t) => (t < ON + 2 ? 110 : 120), step4: (t) => (t < ON + 4 ? 117 : 121.5),
      spinup: (t) => 120 - 30 * Math.exp(-(t - ON) / 1.0), spinup2: (t) => 120 - 20 * Math.exp(-(t - ON) / 2.0),
      alt8: (t) => (Math.floor((t - ON) / 8) % 2 ? 121 : 115), alt12: (t) => (Math.floor((t - ON) / 12) % 2 ? 121 : 115), steady: () => 120,
    };
    let x = new Float32Array(n), find = () => null;
    if (job.sp !== "none") {
      const rnd = mulberry(5); const syl = []; let t = 10, st = 0;
      while (t < dur - 0.5) { const e = t + 0.12 + 0.18 * rnd(); st = Math.max(-4, Math.min(4, st + (rnd() - 0.5) * 3)); syl.push({ a: t, b: e, f: 210 * Math.pow(2, st / 12) }); t = e + 0.04 + 0.08 * rnd(); if (job.sp === "sparse" && rnd() < 0.15) t += 1.2; }
      find = finder(syl);
      x = synth({ sr, dur, f0At: (tt) => find(tt)?.f ?? 0, amp: 0.12, ampAt: sylAmp(find), vowelAt: () => "a", seed: 9, floorDb: -200 });
    }
    const f = SH[job.shape];
    const hum = humGen(n, sr, (t) => (t < ON ? 120 : f(t)), [1, 0.25, 0.12], 0), fl = gaussNoise(n, 0.001, 33);
    for (let i = 0; i < n; i++) x[i] += fl[i] + (i >= ON * sr ? job.lvl * hum[i] : 0);
    const pauseAt = (t) => !(find(t) || find(t - 0.15) || find(t + 0.15));
    return { x, dur, on: ON, lines: [90, 100, 110, 115, 117, 120, 121.5, 230, 240, 360], pauseAt, fvFrom: ON + 21, fvAllFrom: ON + 1, kind: "switch" };
  }
  if (PART === "masked") {
    const dur = 45, n = dur * sr, a = 1, b = 5, { noteF, end } = job;
    const rnd = mulberry(7); const syl = []; let t = b + (end === "glide" ? 1 : 0), st = 0;
    const center = noteF * (end === "speech" ? 1.0 : 1.5);
    while (t < dur - 0.5) {
      const e = t + 0.15 + 0.2 * rnd(); st = Math.max(-3, Math.min(3, st + (rnd() - 0.5) * 3));
      syl.push({ a: t, b: e, f: center * Math.pow(2, st / 12) });
      t = e + 0.04 + 0.08 * rnd();
      if (rnd() < 0.12) t += job.pause;
    }
    if (end !== "glide") syl[0].a = b;
    const find = (tt) => syl.find((y) => tt >= y.a && tt <= y.b);
    const f0At = (tt) => (tt >= a && tt <= b ? noteF : (end === "glide" && tt > b && tt < b + 1 ? noteF * Math.pow(1.6, tt - b) : (find(tt)?.f ?? 0)));
    const ampAt = (tt) => (tt >= a && tt <= b ? Math.min(1, (tt - a) / 0.06) : (end === "glide" && tt > b && tt < b + 1 ? 1 : (() => { const q = find(tt); return q ? Math.max(0, Math.min(1, (tt - q.a) / 0.02, (q.b - tt) / 0.02)) : 0; })()));
    const x = synth({ sr, dur, f0At, ampAt, vowelAt: () => "a", seed: noteF, vibCents: 10, wanderCents: 3 });
    const hum = job.cls === "mains" ? humGen(n, sr, () => 60, [0.6, 0.8, 1.0, 0.3], 0) : job.cls === "fan" ? humGen(n, sr, (tt) => 120 + 0.6 * Math.sin(2 * Math.PI * 0.05 * tt), [1, 0.25, 0.12], 2.2) : humGen(n, sr, () => 120, [1, 0.25, 0.12], 0);
    const fl = gaussNoise(n, 0.0003, 9);
    for (let i = 0; i < n; i++) x[i] += job.lvl * hum[i] + fl[i];
    const pauseAt = (tt) => { for (let d = -0.15; d <= 0.15; d += 0.025) if (f0At(tt + d) > 0) return false; return true; };
    return { x, dur, on: 0, lines: [60, 120, 180, 240, 360], pauseAt, fvFrom: b + 1.5, fvAllFrom: b + 1.5, kind: "start" };
  }
  if (PART === "beatpause") {
    const dur = 70, n = dur * sr, ON = 4, { seed } = job;
    const rnd = mulberry(seed * 7 + 1); const syl = []; let t = 6, st = 0;
    while (t < dur - 0.5) {
      const e = t + 0.12 + 0.18 * rnd(); st = Math.max(-4, Math.min(4, st + (rnd() - 0.5) * 3));
      syl.push({ a: t, b: e, f: 210 * Math.pow(2, st / 12), c: (rnd() - 0.5) * 4, v: ["a", "i", "u", "e"][Math.floor(rnd() * 4)] });
      t = e + 0.04 + 0.08 * rnd();
      if (rnd() < 0.15) t += 0.25 + 0.35 * rnd();
    }
    const find = finder(syl);
    const f0At = (tt) => { const q = find(tt); return q ? q.f * Math.pow(2, q.c * ((tt - q.a) / (q.b - q.a) - 0.5) / 12) : 0; };
    const x = synth({ sr, dur, f0At, amp: 0.12, ampAt: sylAmp(find), vowelAt: (tt) => find(tt)?.v ?? "a", seed, floorDb: -200 });
    const base = humGen(n, sr, () => 120, [1, 0.25, 0.12], 0);
    let h;
    if (job.cls === "tone3") h = base;
    else if (job.cls === "am") h = Float32Array.from(base, (v, i) => v * (1 + 0.6 * Math.sin(2 * Math.PI * 0.3 * i / sr)));
    else if (job.cls === "am2") h = Float32Array.from(base, (v, i) => v * (1 + 0.6 * Math.sin(2 * Math.PI * 0.15 * i / sr)));
    else { const b2 = humGen(n, sr, () => 120.5, [1, 0.25, 0.12], 0, 5), g = job.cls === "beat11" ? 1 : 0.5; h = Float32Array.from(base, (v, i) => (v + g * b2[i]) / Math.sqrt(1 + g * g)); }
    const fl = gaussNoise(n, 0.001, 77);
    for (let i = 0; i < n; i++) x[i] += fl[i] + (i >= ON * sr ? job.lvl * h[i] : 0);
    const pauseAt = (tt) => { for (let d = -0.15; d <= 0.15; d += 0.025) if (find(tt + d)) return false; return true; };
    return { x, dur, on: ON, lines: [120, 240, 360], pauseAt, fvFrom: ON + 21, fvAllFrom: 6, kind: "switch" };
  }
  if (PART === "shared") {
    const dur = 45, on = 3, { vf, hum, hold, br } = job;
    const holds = []; for (let t = 5; t + hold < dur - 1; t += hold + br) holds.push([t, t + hold]);
    const inH = (t) => holds.find(([a, b]) => t >= a && t <= b);
    const x = synth({ sr, dur, f0At: (t) => (inH(t) ? vf : 0), ampAt: (t) => { const h = inH(t); return h ? Math.max(0, Math.min(1, (t - h[0]) / 0.04, (h[1] - t) / 0.04)) : 0; }, vowelAt: () => "a", vibCents: 10, wanderCents: 3, seed: 77 });
    const rnd = mulberry(5); const g = 0.2 * Math.pow(10, hum / 20);
    let ph = 0;
    for (let i = 0; i < x.length; i++) { const t = i / sr; if (t < on) continue; const env = Math.min(1, (t - on) / 0.05); const f = 120 + 0.2 * Math.sin(2 * Math.PI * 0.3 * t); ph += 2 * Math.PI * f / sr; x[i] += env * g * (Math.sin(ph) + 0.5 * Math.sin(2 * ph + 1) + 0.3 * Math.sin(3 * ph + 2)) + 0.0005 * (2 * rnd() - 1); }
    const pauseAt = (t) => !holds.some(([a, b]) => t >= a - 0.15 && t <= b + 0.15);
    return { x, dur, on, lines: [120, 240, 360], pauseAt, fvFrom: on + 21, fvAllFrom: on + 1, kind: "switch", voice: { inH, vf } };
  }
  // intermit: noise-only 120 Hz hum on from 2 s, fully off for `off` s every `per` s
  const dur = 50, n = dur * sr, ON = 2;
  const hum = humGen(n, sr, () => 120, [1, 0.25, 0.12], 0), fl = gaussNoise(n, 0.0003, 21);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr; let g = 0;
    if (t >= ON) { const u = (t - ON) % job.per; const r = 0.02; g = u > job.per - job.off ? 0 : Math.min(1, u / r, (job.per - job.off - u) / r); }
    x[i] = job.lvl * g * hum[i] + fl[i];
  }
  // noise-only: every frame is a "pause" (any voicing is the hum painted)
  return { x, dur, on: ON, lines: [120, 240, 360], pauseAt: () => true, fvFrom: ON + 21, fvAllFrom: ON + 1, kind: "switch" };
}

const rows = [];
for (const job of mine) {
  const B = build(job);
  const row = { part: PART, ...job, v: {} };
  for (const vn of VARS) {
    if (args.qdbg) globalThis.__QDBG = [];
    const msgs = runWorker(VARIANTS[vn], B.x, job.sr);
    if (args.qdbg) { for (const e of globalThis.__QDBG) if (Math.abs((e.f ?? e.rebirth ?? e.steady) / +args.qdbg - 1) < 0.03) console.log(vn, JSON.stringify({ t: +(e.c * 0.025).toFixed(3), ...e })); globalThis.__QDBG = undefined; }
    const disp = displayed(msgs);
    let promo = null; const W = [{ n: 0, fv: 0, pfv: 0, lo: B.fvAllFrom }, { n: 0, fv: 0, pfv: 0, lo: B.fvFrom }];
    let vn_ = 0, vok = 0;
    msgs.forEach((m, i) => {
      if (promo === null && m.t >= B.on - 0.04 && m.nf && m.nf.some((f) => near3(f, B.lines))) promo = +(m.t + 0.04 - B.on).toFixed(2);
      if (m.t > B.dur - 0.3) return;
      if (B.voice && m.t >= B.fvFrom) { const h = B.voice.inH(m.t); if (h && m.t > h[0] + 0.2) { vn_++; if (disp[i] > 0 && Math.abs(disp[i] / B.voice.vf - 1) < 0.08) vok++; } }
      if (!B.pauseAt(m.t)) return;
      for (const w of W) if (m.t >= w.lo) { w.n++; if (m.pitch > 0) w.fv++; if (disp[i] > 0) w.pfv++; }
    });
    const r1 = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
    row.v[vn] = { promo, fvAll: r1(W[0].fv, W[0].n), pfvAll: r1(W[0].pfv, W[0].n), fv: r1(W[1].fv, W[1].n), pfv: r1(W[1].pfv, W[1].n), ...(B.voice ? { voice: r1(vok, vn_) } : {}) };
  }
  row.kind = B.kind;
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (args.out) writeFileSync(args.out, JSON.stringify(rows));

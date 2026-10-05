// int.mjs — interferer side of the round-1 adversarial suite (real worker,
// any input rate). Parts:
//   start  — hum present from the stream's first sample; synthetic speech
//            from t0 = 0.1/0.2/0.4/0.6/1.0/3.0 s (or none: noise-only), with
//            optional capture pre-roll: 100 ms digital zeros, 300 ms of 1e-5
//            dither, or an 80 ms fade-in (gain ramp). 40 s.
//   weak   — broadband white floor (RMS 0.003) + a hum at +3/+6/+9/+12 dB
//            50-4000 Hz band energy over that floor, switching on at ~10 s
//            mid-utterance or in a pause, under three speech patterns. 60 s.
// Speech patterns: P4 = syllables with a 0.6 s pause every 4 s (dense),
// P8 = 1.2 s pause every 8 s, U = 2.5 s utterances / 1.0 s pauses.
//   weak2  — beating (0.5 Hz) / amplitude-modulated hums, +6..+18 dB, as weak.
//   node scripts/notch-adversarial/int.mjs --part=start|weak|weak2 --variants=B,H,C1 --sr=16000,48000 --shard=i/n --out=F
import { writeFileSync } from "node:fs";
import { synth, mulberry } from "./synth.mjs";
import { runWorker, displayed, parseArgs } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";

const args = parseArgs();
const VARS = (args.variants || "B").split(",");
const SRS = (args.sr || "16000").split(",").map(Number);
const PART = args.part || "start";
const WEAK = PART === "weak" || PART === "weak2";
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);

// ---- hum classes at any rate (unit RMS) -------------------------------
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
export const CLASSES = {
  tone3: { gen: (n, sr) => humGen(n, sr, () => 120, [1, 0.25, 0.12], 0), lines: [120, 240, 360] },
  "fan-hum": { gen: (n, sr) => humGen(n, sr, () => 120, [1, 0.25, 0.12], 2.2), lines: [120, 240, 360] },
  mains: { gen: (n, sr) => humGen(n, sr, () => 60, [0.6, 0.8, 1.0, 0.3], 0), lines: [60, 120, 180, 240] },
  wobble: { gen: (n, sr) => humGen(n, sr, (t) => 120 + 0.6 * Math.sin(2 * Math.PI * 0.05 * t) + 0.18 * Math.sin(2 * Math.PI * 0.135 * t), [1, 0.25, 0.12], 2.2), lines: [120, 240, 360] },
  rich60: { gen: (n, sr) => humGen(n, sr, (t) => 60 + 0.02 * Math.sin(2 * Math.PI * 0.07 * t), [0.5, 1, 0.8, 0.6, 0.5, 0.45, 0.4, 0.3, 0.3, 0.25, 0.2, 0.2, 0.15, 0.15, 0.1, 0.1], 0.6), lines: [60, 120, 180, 240, 300, 360, 420] },
  drift: { gen: (n, sr) => humGen(n, sr, (t) => 118 + 4 * t / 40, [1, 0.25, 0.12], 2.2), lines: [116, 118, 120, 122, 124, 236, 240, 244] },
  // round 1 (breath re-birth adversaries): two fans 0.5 Hz apart (beating,
  // ~9.5 dB 2 s amplitude cycle) and a 12 dB / 0.3 Hz amplitude-modulated hum
  beat: { gen: (n, sr) => { const a = humGen(n, sr, () => 120, [1, 0.25, 0.12], 0), b = humGen(n, sr, () => 120.5, [1, 0.25, 0.12], 0, 5); return Float32Array.from(a, (v, i) => (v + 0.5 * b[i]) / 1.118); }, lines: [120, 240, 360] },
  am: { gen: (n, sr) => { const a = humGen(n, sr, () => 120, [1, 0.25, 0.12], 0.6); return Float32Array.from(a, (v, i) => v * (1 + 0.6 * Math.sin(2 * Math.PI * 0.3 * i / sr)) / 1.086); }, lines: [120, 240, 360] },
};

// ---- speech plan --------------------------------------------------------
function plan(t0, dur, pattern, center, seed) {
  const rnd = mulberry(seed); const syl = []; let t = t0, st = 0;
  const inPause = (tt) => {
    if (pattern === "U") return ((tt - t0) % 3.5) > 2.5;
    const P = pattern === "P4" ? 4 : 8, L = pattern === "P4" ? 0.6 : 1.2;
    return ((tt - t0) % P) > P - L;
  };
  while (t < dur - 0.3) {
    if (inPause(t)) { t += 0.025; continue; }
    let e = t + 0.12 + 0.18 * rnd();
    for (let u = t; u < e; u += 0.01) if (inPause(u)) { e = u; break; }
    if (e - t >= 0.08) {
      st = Math.max(-4, Math.min(4, st + (rnd() - 0.5) * 3));
      syl.push({ a: t, b: Math.min(e, dur - 0.3), f: center * Math.pow(2, st / 12), c: (rnd() - 0.5) * 4, v: ["a", "i", "u", "e"][Math.floor(rnd() * 4)] });
    }
    t = e + 0.04 + 0.08 * rnd();
  }
  return syl;
}
function speechSig(sr, dur, syl, seed, amp = 0.12) {
  const find = (t) => { let lo = 0, hi = syl.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (syl[m].b < t) lo = m + 1; else if (syl[m].a > t) hi = m - 1; else return syl[m]; } return null; };
  const f0At = (t) => { const q = find(t); return q ? q.f * Math.pow(2, q.c * ((t - q.a) / (q.b - q.a) - 0.5) / 12) : 0; };
  const x = synth({ sr, dur, f0At, amp, ampAt: (t) => { const q = find(t); return q ? Math.max(0, Math.min(1, (t - q.a) / 0.02, (q.b - t) / 0.02)) : 0; }, vowelAt: (t) => find(t)?.v ?? "a", seed, floorDb: -200 });
  return { x, f0At, find };
}
function gaussNoise(n, rms, seed) { const r = mulberry(seed); const x = new Float32Array(n); for (let i = 0; i < n; i++) { const u = Math.max(1e-12, r()), v = r(); x[i] = rms * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); } return x; }

// ---- jobs ----------------------------------------------------------------
const jobs = [];
if (PART === "start") {
  for (const t0 of [0.1, 0.2, 0.4, 0.6, 1.0, 3.0]) for (const cls of ["tone3", "fan-hum", "mains", "wobble", "rich60"]) for (const lvl of [0.022, 0.0073]) for (const pat of ["P4", "P8"])
    jobs.push({ t0, cls, lvl, pat, pre: "none" });
  for (const pre of ["zeros100", "dither300", "fade80"]) for (const t0 of [null, 0.2, 1.0]) for (const cls of ["tone3", "fan-hum", "mains"]) for (const lvl of [0.022, 0.0073])
    jobs.push({ t0, cls, lvl, pat: "P4", pre });
  for (const cls of Object.keys(CLASSES)) for (const lvl of [0.022, 0.0073]) jobs.push({ t0: null, cls, lvl, pat: "-", pre: "none" });
} else if (PART === "weak") {
  for (const db of [3, 6, 9, 12]) for (const pat of ["P4", "P8", "U"]) for (const place of ["utt", "pause"]) for (const cls of ["tone3", "wobble", "mains"])
    jobs.push({ db, pat, place, cls, center: 210 });
  for (const db of [3, 6, 9, 12]) for (const pat of ["P4", "P8"]) for (const place of ["utt", "pause"]) jobs.push({ db, pat, place, cls: "tone3", center: 165 });
} else if (PART === "weak2") {
  // beating / amplitude-modulated hums switching on mid-session (onset-born
  // lines whose own power dips — the breath re-birth's adversary)
  for (const db of [6, 9, 12, 18]) for (const pat of ["P4", "P8", "U"]) for (const place of ["utt", "pause"]) for (const cls of ["beat", "am"])
    jobs.push({ db, pat, place, cls, center: 210 });
}
if (args.job) { jobs.length = 0; jobs.push(JSON.parse(args.job)); }
const all = [];
for (const j of jobs) for (const sr of SRS) all.push({ ...j, sr });
const mine = all.filter((_, i) => i % shN === shI);

const near3 = (f, lines) => lines.some((L) => Math.abs(f / L - 1) < 0.03);
const rows = [];
for (const job of mine) {
  const { sr } = job; const C = CLASSES[job.cls];
  let x, find = () => null, f0At = () => 0, humOn, dur, syl = [];
  if (PART === "start") {
    dur = 40; const n = dur * sr;
    const hum = C.gen(n, sr);
    x = new Float32Array(n);
    if (job.t0 !== null) { syl = plan(job.t0, dur, job.pat, 210, 17 + Math.round(job.t0 * 10)); const sp = speechSig(sr, dur, syl, 5 + Math.round(job.t0 * 10)); find = sp.find; f0At = sp.f0At; x.set(sp.x); }
    const fl = gaussNoise(n, 0.0003, 99);
    for (let i = 0; i < n; i++) x[i] += job.lvl * hum[i] + fl[i];
    humOn = 0;
    // capture pre-roll: everything shifted / ramped at the stream start
    if (job.pre !== "none") {
      const L = Math.round((job.pre === "zeros100" ? 0.1 : job.pre === "dither300" ? 0.3 : 0) * sr);
      if (L) {
        const y = new Float32Array(n); y.set(x.subarray(0, n - L), L);
        if (job.pre === "dither300") y.set(gaussNoise(L, 1e-5, 7), 0);
        x = y; const sh = L / sr;
        const f0 = f0At, fd = find; f0At = (t) => f0(t - sh); find = (t) => fd(t - sh); humOn = sh;
      }
      if (job.pre === "fade80") { const R = Math.round(0.08 * sr); for (let i = 0; i < R; i++) x[i] *= i / R; }
    }
  } else {
    dur = 60; const n = dur * sr;
    syl = plan(0.5, dur, job.pat, job.center, 31 + job.db);
    const sp = speechSig(sr, dur, syl, 41 + job.db); find = sp.find; f0At = sp.f0At;
    // switch-on time: middle of the syllable / pause nearest after 10 s
    if (job.place === "utt") { const q = syl.find((s) => s.b > 10 && s.b - s.a > 0.15); humOn = (q.a + q.b) / 2; }
    else { let best = null; for (let k = 0; k + 1 < syl.length; k++) { const g = syl[k + 1].a - syl[k].b; if (syl[k].b > 9 && g >= 0.5) { best = (syl[k].b + syl[k + 1].a) / 2; break; } } humOn = best; }
    const floorRms = 0.003, floorBand = floorRms * floorRms * (3950 / (sr / 2));
    const humRms = Math.sqrt(floorBand * Math.pow(10, job.db / 10));
    const hum = C.gen(n, sr), fl = gaussNoise(n, floorRms, 123);
    x = Float32Array.from(sp.x);
    for (let i = 0; i < n; i++) x[i] += fl[i] + (i >= humOn * sr ? humRms * hum[i] : 0);
  }
  const pauseAt = (t) => { for (let d = -0.15; d <= 0.15; d += 0.025) if (find(t + d)) return false; return true; };
  const row = { part: PART, ...job, humOn: +humOn.toFixed(3), v: {} };
  if (args.parity) {
    const [A, B2] = VARS; const ma = runWorker(VARIANTS[A], x, sr), mb = runWorker(VARIANTS[B2], x, sr);
    let mis = 0; for (let i = 0; i < Math.max(ma.length, mb.length); i++) if (JSON.stringify(ma[i]) !== JSON.stringify(mb[i])) mis++;
    console.log(`PARITY ${A} vs ${B2} ${JSON.stringify(job)} ${sr}: ${mis} / ${ma.length}`);
    continue;
  }
  for (const vn of VARS) {
    if (args.dbg) globalThis.__NOTCH_DBG = [];
    const msgs = runWorker(VARIANTS[vn], x, sr);
    if (args.dbg) { const lo = +args.dbg * 0.97, hi = +args.dbg * 1.03; console.log(`--- ${vn}`); for (const e of globalThis.__NOTCH_DBG) if (e.f >= lo && e.f <= hi) console.log(JSON.stringify({ ...e, t: +(e.obs / 10 + 0.512).toFixed(2) })); globalThis.__NOTCH_DBG = undefined; }
    if (args.nftrace) { let last = ''; for (const m of msgs) { const k = JSON.stringify(m.nf); if (k !== last) { console.log(vn, m.t.toFixed(2), k); last = k; } } }
    const disp = displayed(msgs);
    let promo = null;
    const w = (lo) => ({ n: 0, fv: 0, pfv: 0, sn: 0, sok: 0, lo });
    // start: [1.5 s, end] and the steady state [6 s, end] after the audio starts;
    // weak:  [on + 1 s, end] and [on + 21 s, end] (past the accepted ~21 s
    //        switch-on latency)
    const ws = PART === "start" ? [w(1.5 + humOn), w(6 + humOn)] : [w(humOn + 1), w(args.ssFrom ? +args.ssFrom : humOn + 21)];
    msgs.forEach((m, i) => {
      if (promo === null && m.t >= humOn - 0.04 && m.nf && m.nf.some((f) => near3(f, C.lines))) promo = +(m.t + 0.04 - humOn).toFixed(2);
      const q = find(m.t);
      for (const W of ws) {
        if (m.t < W.lo || m.t > dur - 0.3) continue;
        if (q) { if (m.t >= q.a + 0.05 && m.t <= q.b - 0.05) { W.sn++; const f = f0At(m.t); if (m.pitch > 0 && Math.abs(m.pitch / f - 1) < 0.08) W.sok++; } }
        else if (pauseAt(m.t)) { W.n++; if (m.pitch > 0) W.fv++; if (disp[i] > 0) W.pfv++; }
      }
    });
    const r1 = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
    row.v[vn] = { promo, fv: r1(ws[0].fv, ws[0].n), pfv: r1(ws[0].pfv, ws[0].n), sp: r1(ws[0].sok, ws[0].sn), fvSS: r1(ws[1].fv, ws[1].n), spSS: r1(ws[1].sok, ws[1].sn), np: ws[0].n };
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (args.out) writeFileSync(args.out, JSON.stringify(rows));

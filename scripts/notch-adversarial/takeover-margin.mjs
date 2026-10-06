// takeover-margin.mjs — margin of the voice timing's takeover guard on the
// handoff-adv cells (2026-10-05 follow-up): notch only (cand3-notch.js with a
// variant's options), 16 kHz. For the hum track (within 3 % of the hum) per
// cell: the largest rise of a sighting over the median of the 3 consecutive
// sightings that ended 6 observations earlier, among references steadier than
// jumpStableDb (rise - jumpDb = the guard's margin: > 0 fires), the smallest
// reference spread seen before the note, whether the track was ever voice-
// confirmed (only then does the guard matter) and whether it got voice timing.
//   node scripts/notch-adversarial/takeover-margin.mjs [--variant=V16] [--heldout|--heldout2] [--out=F]
// (V18's peak condition is modelled: a reference only counts when no earlier
// sighting was more than jumpPeakTolDb above it.)
import { writeFileSync } from "node:fs";
import { synth, mulberry } from "./synth.mjs";
import { VARIANTS } from "./variants.mjs";
const { createNoiseNotch } = await import("./cand3-notch.js");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const V = VARIANTS[args.variant || "V16"].opts;
const C = { jumpDb: 6, jumpRefObs: 3, jumpStableDb: 1.5, jumpRiseObs: 6, ...V.coh };
const sr = 16000, HELD = "heldout" in args, HELD2 = "heldout2" in args;
const cells = [];
if (!HELD && !HELD2) for (const noteF of [112, 117, 120.5, 123, 126, 132, 140]) for (const D of [4, 8]) for (const end of ["stop", "glide-on", "fade"]) for (const lvl of [0.01, 0.03])
  cells.push({ hf: 120, noteF, a: 1, D, end, lvl, vib: 10, wan: 3, seed: noteF + D, rs: 9, ph2: 1.1, ph3: 2.3, onTo: 121 });
else if (HELD2) for (const hf of [85, 135, 180]) for (const ratio of [0.95, 0.985, 1.002, 1.012, 1.03, 1.07]) for (const D of [4, 7]) for (const end of ["stop", "glide-on", "fade"]) for (const lvl of [0.008, 0.04, 0.07])
  cells.push({ hf, noteF: +(hf * ratio).toFixed(2), a: D === 4 ? 1.5 : 3, D, end, lvl, vib: 12, wan: 2.5, seed: 2000 + Math.round(hf * ratio * 10) + D, rs: 57, ph2: 2.0, ph3: 0.6, onTo: hf * 1.008 });
else for (const hf of [100, 150]) for (const ratio of [0.93, 0.975, 1.004, 1.025, 1.05, 1.1]) for (const D of [3, 10]) for (const end of ["stop", "glide-on", "fade"]) for (const lvl of [0.005, 0.02, 0.05])
  cells.push({ hf, noteF: +(hf * ratio).toFixed(2), a: D === 3 ? 1 : 2.5, D, end, lvl, vib: 15, wan: 4, seed: 1000 + Math.round(hf * ratio * 10) + D, rs: 31, ph2: 0.4, ph3: 1.7, onTo: hf * 1.008 });
const rows = [];
for (const c of cells) {
  const { hf, noteF, a, D, end, lvl } = c, b = a + D, dur = Math.ceil(b + 24), n = dur * sr;
  const f0At = (t) => (t < a || t > b ? 0 : end === "glide-on" && t > b - 1 ? noteF + (c.onTo - noteF) * (t - (b - 1)) : noteF);
  const ampAt = (t) => (t < a || t > b ? 0 : Math.min(1, (t - a) / 0.06, end === "fade" ? (b - t) / 1.5 : (b - t) / 0.06));
  const x = synth({ sr, dur, f0At, ampAt, vowelAt: () => "a", seed: c.seed, vibCents: c.vib, wanderCents: c.wan });
  const r = mulberry(c.rs); let ph = 0;
  for (let i = 0; i < n; i++) { ph += 2 * Math.PI * hf / sr; x[i] += lvl * Math.SQRT2 * (Math.sin(ph) + 0.25 * Math.sin(2 * ph + c.ph2) + 0.12 * Math.sin(3 * ph + c.ph3)) / 1.032 + 0.0003 * (2 * r() - 1); }
  const T = new Map();
  globalThis.__OBSDBG = (o, tracks) => {
    for (const t of tracks) {
      if (!t._seen || Math.abs(t.freq / hf - 1) > 0.03) continue;
      const e = T.get(t.id) ?? { ph: [], rise: -Infinity, spreadPre: Infinity, voice: false, timed: false, jumped: false, ob0: !!t.onsetBorn };
      e.ph.push([o, 10 * Math.log10(t.power + 1e-30)]);
      const ref = e.ph.filter(([q]) => q > o - C.jumpRiseObs - C.jumpRefObs && q <= o - C.jumpRiseObs).map(([, d]) => d);
      const pre = e.ph.filter(([q]) => q <= o - C.jumpRiseObs - C.jumpRefObs).map(([, d]) => d);
      if (ref.length >= C.jumpRefObs) {
        const sp = Math.max(...ref) - Math.min(...ref), med = [...ref].sort((p, q) => p - q)[Math.floor(ref.length / 2)];
        const peakOk = !C.jumpPeakTolDb || !pre.length || Math.max(...pre) <= Math.max(...ref) + C.jumpPeakTolDb;
        if (o * 0.1 + 0.5 < a) e.spreadPre = Math.min(e.spreadPre, sp);
        if (sp <= C.jumpStableDb && peakOk) e.rise = Math.max(e.rise, e.ph[e.ph.length - 1][1] - med);
      }
      if (t.cohStat && t.cohStat[0] >= C.vCorr && t.cohStat[1] >= C.vCoh) e.voice = true;
      if (t.voiceBorn) e.timed = true;
      if (t.jumped) e.jumped = true;
      T.set(t.id, e);
    }
  };
  const nt = createNoiseNotch(sr, { ...V, minTrackSec: 1e9, onsetMinTrackSec: 1e9 });
  for (let k = 0; k + 400 <= Math.min(x.length, (b + 3) * sr); k += 400) nt.process(Float32Array.from(x.subarray(k, k + 400)));
  globalThis.__OBSDBG = undefined;
  // the hum's first track (present before the note)
  const hum = [...T.values()].find((e) => e.ph[0][0] * 0.1 + 0.5 < a) ?? null;
  const row = { hf, noteF, a, D, end, lvl, humTrack: !!hum, voice: hum?.voice ?? false, timed: hum?.timed ?? false, jumped: hum?.jumped ?? false,
    riseMargin: hum && Number.isFinite(hum.rise) ? +(hum.rise - C.jumpDb).toFixed(2) : null, spreadPre: hum && Number.isFinite(hum.spreadPre) ? +hum.spreadPre.toFixed(2) : null };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const relevant = rows.filter((r) => r.voice);
const ms = relevant.map((r) => r.riseMargin).filter((m) => m !== null).sort((p, q) => p - q);
console.log(`${HELD2 ? "held-out split 2" : HELD ? "held-out" : "tuning"} cells ${rows.length}; hum line voice-confirmed (guard relevant) in ${relevant.length}; guard fired ${relevant.filter((r) => r.jumped).length}; voice timing granted ${relevant.filter((r) => r.timed).length}; rise margin over ${C.jumpDb} dB: min ${ms[0] ?? "-"} / p10 ${ms[Math.floor(0.1 * ms.length)] ?? "-"} / median ${ms[Math.floor(ms.length / 2)] ?? "-"} dB; max pre-note reference spread ${Math.max(...rows.map((r) => r.spreadPre ?? 0)).toFixed(2)} dB (limit ${C.jumpStableDb})`);
if (args.out) writeFileSync(args.out, JSON.stringify(rows));

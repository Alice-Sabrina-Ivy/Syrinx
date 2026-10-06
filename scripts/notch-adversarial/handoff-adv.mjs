// handoff-adv.mjs — adversarial cases for the glide / step handoff (round 1,
// 2026-10-04): a hum the handoff could mistake for a moved note. A hum
// present from t = 0 (120 Hz class, rms lvl), a louder held note within
// 160 c of it starting at 1 s (the hum line drops out of peak picking
// beside it and its track is pruned) for D s, optionally gliding / stepping
// to near the hum, then silence: the hum reappears as a NEW track right
// where a held onset-born line vanished. Metric: promotion time of the hum
// line (s), pause false voicing after the note.
//   node scripts/notch-adversarial/handoff-adv.mjs --variants=B,N4,N5 [--sr=16000] [--shard=i/n --out=F] [--heldout]
// --heldout (2026-10-05 follow-up): a HELD-OUT grid for the voice timing's
// takeover guard, none of whose cells chose a threshold — hum at 100 / 150 Hz
// (tuning: 120), note at 0.93 / 0.975 / 1.004 / 1.025 / 1.05 / 1.1 x the hum,
// starting at 1 s (held 3 s) or 2.5 s (held 10 s), hum rms 0.005 / 0.02 /
// 0.05 (tuning: 0.01 / 0.03), 15 c vibrato + 4 c wander (tuning: 10 + 3), new
// seeds, other harmonic phases. --heldout2 (split 2, run once on the final
// candidate): hum at 85 / 135 / 180 Hz, note at 0.95-1.07 x the hum from
// 1.5 s (held 4 s) or 3 s (held 7 s), hum rms 0.008 / 0.04 / 0.07, 12 c
// vibrato + 2.5 c wander, other seeds and phases (324 cells per rate).
// --wobble / --sweep (2026-10-06 fix round, the review's takeover shapes): a
// hum whose speed carries a SMALL shared wobble (OU, tau 0.15 s, 0 / 0.7 /
// 1.2 / 2 c: undecided rather than machine-confirmed) with one 4 s note
// (1.5-5.5 s, 12 c vibrato + 2.5 c wander) at 1.002 / 1.012 x the hum, hum at
// 85 / 120 / 150 Hz, rms 0.04 / 0.07 (48 cells per rate); --sweep: hum at 85 /
// 120 / 150 / 200 Hz, note at 1.002 / 1.006 / 1.012 x, hum rms 0.015-0.055 in
// 7 steps, wobble 0 / 1.2 c (168 cells per rate). Rows add pfv (painted false
// voicing after the note, median-3 + paint gate).
import { writeFileSync } from "node:fs";
import { synth, mulberry } from "./synth.mjs";
import { runWorker, displayed, parseArgs } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";
const args = parseArgs();
const VARS = (args.variants || "B,N4").split(",");
const SRS = (args.sr || "16000").split(",").map(Number);
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);
const rows = [];
let job = -1;
const WOB = "wobble" in args || "sweep" in args;
const HELD = "heldout" in args || "heldout2" in args || WOB, HELD2 = "heldout2" in args;
const cells = [];
if ("wobble" in args) for (const sr of SRS) for (const hf of [85, 120, 150]) for (const ratio of [1.002, 1.012]) for (const lvl of [0.04, 0.07]) for (const wsd of [0, 0.7, 1.2, 2])
  cells.push({ sr, hf, noteF: +(hf * ratio).toFixed(2), a: 1.5, D: 4, end: "stop", lvl, wsd, vib: 12, wan: 2.5, seed: 3000 + Math.round(hf * ratio * 10), rs: 57, ph2: 2.0, ph3: 0.6 });
else if ("sweep" in args) for (const sr of SRS) for (const hf of [85, 120, 150, 200]) for (const ratio of [1.002, 1.006, 1.012]) for (const lvl of [0.015, 0.02, 0.025, 0.03, 0.035, 0.045, 0.055]) for (const wsd of [0, 1.2])
  cells.push({ sr, hf, noteF: +(hf * ratio).toFixed(2), a: 1.5, D: 4, end: "stop", lvl, wsd, vib: 12, wan: 2.5, seed: 3000 + Math.round(hf * ratio * 10), rs: 57, ph2: 2.0, ph3: 0.6 });
else if (!HELD) for (const sr of SRS) for (const noteF of [112, 117, 120.5, 123, 126, 132, 140]) for (const D of [4, 8]) for (const end of ["stop", "glide-on", "fade"]) for (const lvl of [0.01, 0.03])
  cells.push({ sr, hf: 120, noteF, a: 1, D, end, lvl, vib: 10, wan: 3, seed: noteF + D, rs: 9, ph2: 1.1, ph3: 2.3 });
else if (HELD2) for (const sr of SRS) for (const hf of [85, 135, 180]) for (const ratio of [0.95, 0.985, 1.002, 1.012, 1.03, 1.07]) for (const D of [4, 7]) for (const end of ["stop", "glide-on", "fade"]) for (const lvl of [0.008, 0.04, 0.07])
  cells.push({ sr, hf, noteF: +(hf * ratio).toFixed(2), a: D === 4 ? 1.5 : 3, D, end, lvl, vib: 12, wan: 2.5, seed: 2000 + Math.round(hf * ratio * 10) + D, rs: 57, ph2: 2.0, ph3: 0.6 });
else for (const sr of SRS) for (const hf of [100, 150]) for (const ratio of [0.93, 0.975, 1.004, 1.025, 1.05, 1.1]) for (const D of [3, 10]) for (const end of ["stop", "glide-on", "fade"]) for (const lvl of [0.005, 0.02, 0.05])
  cells.push({ sr, hf, noteF: +(hf * ratio).toFixed(2), a: D === 3 ? 1 : 2.5, D, end, lvl, vib: 15, wan: 4, seed: 1000 + Math.round(hf * ratio * 10) + D, rs: 31, ph2: 0.4, ph3: 1.7 });
for (const c of cells) {
  if (++job % shN !== shI) continue;
  const { sr, hf, noteF, D, end, lvl } = c;
  const a = c.a, b = a + D, dur = Math.ceil(b + 24), n = dur * sr;
  const onTo = HELD ? hf * 1.008 : 121; // glide-on target: just above the hum
  const f0At = (t) => (t < a || t > b ? 0 : end === "glide-on" && t > b - 1 ? noteF + (onTo - noteF) * (t - (b - 1)) : noteF);
  const ampAt = (t) => (t < a || t > b ? 0 : Math.min(1, (t - a) / 0.06, end === "fade" ? (b - t) / 1.5 : (b - t) / 0.06));
  const x = synth({ sr, dur, f0At, ampAt, vowelAt: () => "a", seed: c.seed, vibCents: c.vib, wanderCents: c.wan });
  const r = mulberry(c.rs); let ph = 0;
  // shared hum wobble (--wobble / --sweep): OU cents, tau 0.15 s
  const rw = mulberry(77 + hf), aw = Math.exp(-1 / (0.15 * sr)), sw = (c.wsd ?? 0) * Math.sqrt(1 - aw * aw);
  let wv = 0;
  const gw = () => { const u = Math.max(1e-12, rw()), q = rw(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * q); };
  for (let i = 0; i < n; i++) { if (c.wsd) wv = aw * wv + sw * gw(); ph += 2 * Math.PI * hf * (c.wsd ? Math.pow(2, wv / 1200) : 1) / sr; x[i] += lvl * Math.SQRT2 * (Math.sin(ph) + 0.25 * Math.sin(2 * ph + c.ph2) + 0.12 * Math.sin(3 * ph + c.ph3)) / 1.032 + 0.0003 * (2 * r() - 1); }
  const row = HELD ? { sr, hf, noteF, a, D, end, lvl, ...(WOB ? { wsd: c.wsd } : {}), v: {} } : { sr, noteF, D, end, lvl, v: {} };
  for (const vn of VARS) {
    const msgs = runWorker(VARIANTS[vn], x, sr), disp = displayed(msgs);
    let promo = null, fn = 0, fv = 0, pfv = 0;
    msgs.forEach((m, i) => {
      if (promo === null && m.nf && m.nf.some((f) => Math.abs(f / hf - 1) < 0.03)) promo = +(m.t + 0.04).toFixed(2);
      if (m.t > b + 0.5) { fn++; if (m.pitch > 0) fv++; if (disp[i] > 0) pfv++; }
    });
    row.v[vn] = { promo, fv: +(100 * fv / fn).toFixed(1), pfv: +(100 * pfv / fn).toFixed(1) };
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
let worse = {};
for (const r of rows) for (const vn of VARS) {
  const b0 = r.v[VARS[0]], c = r.v[vn];
  if (b0.promo !== null && (c.promo === null || c.promo > b0.promo + 0.3)) (worse[vn] ??= []).push(`${r.hf ? r.hf + "Hz hum " : ""}${r.noteF}Hz ${r.D}s ${r.end} lvl${r.lvl} ${r.sr}: ${c.promo} vs ${b0.promo}`);
}
for (const vn of VARS.slice(1)) console.log(`${vn}: ${worse[vn]?.length ?? 0}/${rows.length} later than ${VARS[0]}${worse[vn] ? "\n  " + worse[vn].join("\n  ") : ""}`);
if (args.out) writeFileSync(args.out, JSON.stringify(rows));

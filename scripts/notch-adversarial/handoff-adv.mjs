// handoff-adv.mjs — adversarial cases for the glide / step handoff (round 1,
// 2026-10-04): a hum the handoff could mistake for a moved note. A hum
// present from t = 0 (120 Hz class, rms lvl), a louder held note within
// 160 c of it starting at 1 s (the hum line drops out of peak picking
// beside it and its track is pruned) for D s, optionally gliding / stepping
// to near the hum, then silence: the hum reappears as a NEW track right
// where a held onset-born line vanished. Metric: promotion time of the hum
// line (s), pause false voicing after the note.
//   node scripts/notch-adversarial/handoff-adv.mjs --variants=B,N4,N5 [--sr=16000] [--shard=i/n --out=F]
import { writeFileSync } from "node:fs";
import { synth, mulberry } from "./synth.mjs";
import { runWorker, parseArgs } from "./lib.mjs";
import { VARIANTS } from "./variants.mjs";
const args = parseArgs();
const VARS = (args.variants || "B,N4").split(",");
const SRS = (args.sr || "16000").split(",").map(Number);
const [shI, shN] = (args.shard || "0/1").split("/").map(Number);
const rows = [];
let job = -1;
for (const sr of SRS) for (const noteF of [112, 117, 120.5, 123, 126, 132, 140]) for (const D of [4, 8]) for (const end of ["stop", "glide-on", "fade"]) for (const lvl of [0.01, 0.03]) {
  if (++job % shN !== shI) continue;
  const dur = 1 + D + 24, n = dur * sr;
  const a = 1, b = 1 + D;
  const f0At = (t) => (t < a || t > b ? 0 : end === "glide-on" && t > b - 1 ? noteF + (121 - noteF) * (t - (b - 1)) : noteF);
  const ampAt = (t) => (t < a || t > b ? 0 : Math.min(1, (t - a) / 0.06, end === "fade" ? (b - t) / 1.5 : (b - t) / 0.06));
  const x = synth({ sr, dur, f0At, ampAt, vowelAt: () => "a", seed: noteF + D, vibCents: 10, wanderCents: 3 });
  const r = mulberry(9); let ph = 0;
  for (let i = 0; i < n; i++) { ph += 2 * Math.PI * 120 / sr; x[i] += lvl * Math.SQRT2 * (Math.sin(ph) + 0.25 * Math.sin(2 * ph + 1.1) + 0.12 * Math.sin(3 * ph + 2.3)) / 1.032 + 0.0003 * (2 * r() - 1); }
  const row = { sr, noteF, D, end, lvl, v: {} };
  for (const vn of VARS) {
    const msgs = runWorker(VARIANTS[vn], x, sr);
    let promo = null, fn = 0, fv = 0;
    for (const m of msgs) {
      if (promo === null && m.nf && m.nf.some((f) => Math.abs(f / 120 - 1) < 0.03)) promo = +(m.t + 0.04).toFixed(2);
      if (m.t > b + 0.5) { fn++; if (m.pitch > 0) fv++; }
    }
    row.v[vn] = { promo, fv: +(100 * fv / fn).toFixed(1) };
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
let worse = {};
for (const r of rows) for (const vn of VARS) {
  const b0 = r.v[VARS[0]], c = r.v[vn];
  if (b0.promo !== null && (c.promo === null || c.promo > b0.promo + 0.3)) (worse[vn] ??= []).push(`${r.noteF}Hz ${r.D}s ${r.end} lvl${r.lvl} ${r.sr}: ${c.promo} vs ${b0.promo}`);
}
for (const vn of VARS.slice(1)) console.log(`${vn}: ${worse[vn]?.length ?? 0}/${rows.length} later than ${VARS[0]}${worse[vn] ? "\n  " + worse[vn].join("\n  ") : ""}`);
if (args.out) writeFileSync(args.out, JSON.stringify(rows));

// realeval.mjs — REAL-noise oracle for notch variants (2026-10-05, notch
// voice-vs-machine CANDIDATE phase): the real pitch worker (lib.mjs trees,
// 25 ms chunks) over the real-data corpora of
// measurements/notch-realdata-corpora-2026-10-05.md.
//
//   node scripts/notch-adversarial/realdata/realeval.mjs --set=noise|vin|held|gated
//        --variants=B,R8,V1 [--sr=16000] [--shard=i/n] [--out=F] [--ids=a,b] [--max-sec=90]
//
// Sets and per-variant metrics (painted = median-3 + paint gate, the display):
//   noise — every non-duplicate noise clip >= 10 s (first 90 s; probe.mjs's
//           set): promo (s, first notch), pfv / fv (painted / worker false
//           voicing over the clip), pfv20 (painted, t >= 20 s), nf (fraction
//           of frames with a notch).
//   vin   — voice_in_noise mixes (20 s real-noise lead, real voice program,
//           5 s tail): promo; lead / tail painted FV (noise only); program
//           voiced frames at pitch (+-8 % of Praat AC F0 of the voice layer),
//           worker (ok) and painted (pok); program unvoiced frames painted
//           (pfvProg); held-program hold frames painted at pitch (hok).
//   held  — held_series (real VocalSet same-pitch hold series, 0.15-1 s
//           silent gaps): hold frames at pitch, worker (ok) / painted (pok);
//           promoV (first notch on k x f0, k = 1..3, +-4 %).
//   gated — noise_gated (real stationary-tonal source switched off 0.15 / 0.5
//           / 1 s every 5 / 8 s from t = 2 s): promo (s after switch-on);
//           pfvAll / fvAll from switch-on + 1 s; pfv / fv from switch-on + 21 s.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadIndex, readClip, resample, DATA } from "./realdata.mjs";
import { runWorker, displayed, parseArgs } from "../lib.mjs";
import { VARIANTS } from "../variants.mjs";

const A = parseArgs();
const SET = A.set || "noise";
const VARS = (A.variants || "B").split(",");
const SR = Number(A.sr || 16000);
const [shI, shN] = (A.shard || "0/1").split("/").map(Number);
const MAXS = Number(A["max-sec"] ?? 90);

let recs;
if (SET === "noise") recs = loadIndex("noise", { minDur: 10 }).filter((r) => r.label !== "floor" && r.class !== "floor" && r.source !== "synthfloor");
else recs = loadIndex("mix", { set: { vin: "voice_in_noise", held: "held_series", gated: "noise_gated" }[SET] });
if (A.ids) { const s = new Set(A.ids.split(",")); recs = recs.filter((r) => s.has(r.id)); }
recs.sort((a, b) => a.id.localeCompare(b.id));
const mine = recs.filter((_, i) => i % shN === shI);

// voice truth: Praat AC F0 of each voice layer, on the mix timeline
const vIdx = SET === "vin" ? new Map(loadIndex("voice", { noDup: false }).map((r) => [r.path, r])) : null;
function truthOf(rec) {
  const segs = [];
  for (const L of rec.spec.layers) {
    const v = vIdx.get(L.clip);
    if (!v || !v.f0_path || !existsSync(join(DATA, v.f0_path))) continue;
    const f = JSON.parse(readFileSync(join(DATA, v.f0_path), "utf8")).praat;
    if (!f) continue;
    segs.push({ a: L.at, b: L.at + L.len, from: L.from ?? 0, t0: f.t0, hop: f.hop, f0: f.f0 });
  }
  return (t) => {
    for (const s of segs) {
      if (t < s.a || t > s.b) continue;
      const i = Math.round((t - s.a + s.from - s.t0) / s.hop);
      return i >= 0 && i < s.f0.length ? (s.f0[i] || 0) : 0;
    }
    return null; // outside every voice layer
  };
}
const r1 = (a, b) => (b ? +(100 * a / b).toFixed(2) : null);

const rows = [];
for (const rec of mine) {
  let x = readClip(rec.path);
  if (SET === "noise" && MAXS > 0 && x.length > MAXS * 16000) x = x.subarray(0, MAXS * 16000);
  if (SR !== 16000) x = resample(x, 16000, SR);
  const dur = x.length / SR;
  const row = { set: SET, id: rec.id, sr: SR, dur: +dur.toFixed(2), v: {} };
  if (SET === "noise") Object.assign(row, { label: rec.label, source: rec.source, cls: rec.class, flags: rec.flags ?? [] });
  else Object.assign(row, { noise_id: rec.noise_id, noise_label: rec.noise_label, snr_db: rec.snr_db, voice_kind: rec.voice_kind, gap_s: rec.gap_s, period_s: rec.period_s, off_s: rec.off_s, f0: rec.f0 });
  const truth = SET === "vin" ? truthOf(rec) : null;
  for (const vn of VARS) {
    const msgs = runWorker(VARIANTS[vn], x, SR);
    const disp = displayed(msgs);
    const C = {};
    const inc = (k, c) => { C[k] = (C[k] ?? 0) + (c ? 1 : 0); C[k + "_n"] = (C[k + "_n"] ?? 0) + 1; };
    let promo = null, promoV = null;
    const on = SET === "gated" ? rec.on_s : 0;
    msgs.forEach((m, i) => {
      const t = m.t, nf = m.nf && m.nf.length ? m.nf : null;
      if (promo === null && nf && t >= on - 0.04) promo = +(t + 0.04 - on).toFixed(2);
      if (t > dur - 0.3) return;
      const pv = m.pitch > 0, dv = disp[i] > 0;
      if (SET === "noise") { inc("fv", pv); inc("pfv", dv); if (t >= 20) inc("pfv20", dv); inc("nf", !!nf); return; }
      if (SET === "gated") {
        if (t >= on + 1) { inc("fvAll", pv); inc("pfvAll", dv); }
        if (t >= on + 21) { inc("fv", pv); inc("pfv", dv); }
        return;
      }
      if (SET === "held") {
        const f0 = rec.f0;
        if (promoV === null && nf && nf.some((f) => [1, 2, 3].some((k) => Math.abs(f / (k * f0) - 1) < 0.04))) promoV = +t.toFixed(2);
        const h = rec.holds.find(([a, b]) => t >= a + 0.3 && t <= b - 0.1);
        if (h) { inc("ok", pv && Math.abs(m.pitch / h[2] - 1) < 0.08); inc("pok", dv && Math.abs(disp[i] / h[2] - 1) < 0.08); }
        else if (!rec.holds.some(([a, b]) => t >= a - 0.15 && t <= b + 0.15)) inc("pfvGap", dv);
        return;
      }
      // vin
      if (t >= 1.5 && t < rec.voice_t0 - 0.1) inc("pfvLead", dv);
      if (t > rec.voice_t1 + 0.5) inc("pfvTail", dv);
      if (t >= rec.voice_t0 && t <= rec.voice_t1) {
        const f = truth(t);
        if (f > 0) { inc("ok", pv && Math.abs(m.pitch / f - 1) < 0.08); inc("pok", dv && Math.abs(disp[i] / f - 1) < 0.08); }
        else if (f === 0 || f === null) {
          // unvoiced in the program: only frames >= 0.1 s from any voiced truth
          let near = false;
          for (let d = -0.1; d <= 0.1; d += 0.025) if ((truth(t + d) ?? 0) > 0) near = true;
          if (!near) inc("pfvProg", dv);
        }
        if (rec.holds?.length) { const h = rec.holds.find(([a, b]) => t >= a + 0.3 && t <= b - 0.1); if (h && f > 0) inc("hok", dv && Math.abs(disp[i] / f - 1) < 0.08); }
      }
    });
    const out = { promo };
    if (SET === "held") out.promoV = promoV;
    for (const k of Object.keys(C)) if (!k.endsWith("_n")) { out[k] = r1(C[k], C[k + "_n"]); out[k + "_n"] = C[k + "_n"]; }
    row.v[vn] = out;
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (A.out) writeFileSync(A.out, JSON.stringify(rows));

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
//   voice — (2026-10-05 follow-up) REAL voice only, no added noise, built on
//           the fly as renderMix specs (voiceSet below): every line of these
//           streams is a voice, so every notch is a cost. Kinds:
//             pvqd-start   PVQD clips with a >= 4 s sustained vowel, as
//                          recorded (phonation from t ~ 0: not onset-born),
//                          first 60 s
//             pvqd-mid     every PVQD held segment >= 5 s, the stream starting
//                          0.3 s into it (mid-phonation)
//             vocalset-mid a held_series (same singer, same note, other vowels
//                          / techniques) re-timed into one continuous >= 14 s
//                          phrase (50 ms crossfades, no gaps), the stream
//                          starting 0.5 s into the first note
//             messa-onset  a VocalSet messa di voce note (soft -> loud -> soft,
//                          a real crescendo) looped 3x, from its soft start at
//                          0.15 s
//             messa-mid    the same, the stream starting 40 % into the note
//           Metrics: hold frames (held segments mapped onto the stream, F0 in
//           75-400 Hz, Praat AC F0 > 0) at pitch, worker (ok) / painted (pok);
//           promoV (first notch on k x the hold F0, k = 1..3, +-4 %).
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadIndex, readClip, resample, renderMix, DATA } from "./realdata.mjs";
import { runWorker, displayed, parseArgs } from "../lib.mjs";
import { VARIANTS } from "../variants.mjs";

const A = parseArgs();
const SET = A.set || "noise";
const VARS = (A.variants || "B").split(",");
const SR = Number(A.sr || 16000);
const [shI, shN] = (A.shard || "0/1").split("/").map(Number);
const MAXS = Number(A["max-sec"] ?? 90);

// ---- the voice-only set (see the header) ------------------------------------
const VOICE_IDX = loadIndex("voice", { noDup: false });
const VBY = new Map(VOICE_IDX.map((r) => [r.path, r]));
const inBand = (f) => f >= 75 && f <= 400;
const MIX_OK = existsSync(join(DATA, "index_mix.json")) || existsSync(join(DATA, "manifests", "mix.held_series.json"));
function voiceSet() {
  const out = [];
  const floor = (len) => ({ clip: "noise/synthfloor/gauss_3e-4.wav", at: 0, from: 0, len, gain: 1, loop: true, fade: 0.02 });
  // sustained-vowel recordings: PVQD (phonation from the recording's start:
  // streamed as recorded) and the held-out Coswara (fetch_heldout.py; silence
  // before the vowel: the stream starts 0.15 s before its first >= 4 s hold)
  for (const v of VOICE_IDX.filter((r) => r.source === "pvqd" || r.source === "coswara")) {
    const H = v.held.filter((h) => h[1] - h[0] >= 4 && inBand(h[2]));
    if (!H.length) continue;
    const src = v.source === "pvqd" ? "pvqd" : "cos";
    const grp = v.source === "pvqd" ? (v.capev_severity == null ? "sev?" : v.capev_severity < 20 ? "sev<20" : "sev>=20") : (v.gender === "f" ? "female" : v.gender === "m" ? "male" : "other");
    const from0 = v.source === "pvqd" ? 0 : Math.max(0, H[0][0] - 0.15), len = Math.min(60, v.dur - from0);
    out.push({ id: `voice__${src}-start__${v.id}`, kind: `${src}-start`, grp, spec: { sr: 16000, dur: len, layers: [{ clip: v.path, at: 0, from: from0, len, gain: 1, loop: false, fade: 0.01 }] } });
    for (const h of v.held.filter((q) => q[1] - q[0] >= 5 && inBand(q[2]))) {
      const from = h[0] + 0.3, l = Math.min(h[1] - from + 0.5, v.dur - from);
      out.push({ id: `voice__${src}-mid__${v.id}@${h[0].toFixed(2)}`, kind: `${src}-mid`, grp, spec: { sr: 16000, dur: l + 0.5, layers: [{ clip: v.path, at: 0, from, len: l, gain: 1, loop: false, fade: 0.01 }] } });
    }
  }
  for (const m of (MIX_OK ? loadIndex("mix", { set: "held_series" }) : []).filter((r) => r.gap_s === 0.15)) {
    const notes = m.spec.layers.filter((L) => L.clip.startsWith("voice/"));
    const layers = []; let t = 0;
    for (const [k, L0] of notes.entries()) {
      const L = { ...L0, fade: 0.05 };
      if (k === 0) { L.from += 0.5; L.len -= 0.5; }
      L.at = t; layers.push(L); t += L.len - 0.05;
      if (t >= 14) break;
    }
    const dur = t + 1;
    out.push({ id: `voice__vocalset-mid__${m.id.replace(/__gap.*$/, "")}`, kind: "vocalset-mid", grp: m.id.includes("female") ? "female" : "male", spec: { sr: 16000, dur, layers: [floor(dur), ...layers] } });
  }
  for (const v of VOICE_IDX.filter((r) => r.source === "vocalset" && r.id.includes("_messa_"))) {
    const h = v.held.find((q) => q[1] - q[0] >= 1.5 && inBand(q[2]));
    if (!h) continue;
    const a = Math.max(0, h[0] - 0.3), b = Math.min(v.dur, h[1] + 0.2), len = b - a;
    for (const start of ["onset", "mid"]) {
      const layers = []; let t = 0.15;
      for (let k = 0; k < (start === "mid" ? 4 : 3); k++) {
        const L = { clip: v.path, at: t, from: a, len, gain: 1, loop: false, fade: 0.03 };
        if (k === 0 && start === "mid") { L.from = a + 0.4 * len; L.len = 0.6 * len; }
        layers.push(L); t += L.len - 0.03;
      }
      out.push({ id: `voice__messa-${start}__${v.id}`, kind: `messa-${start}`, grp: v.gender === "f" ? "female" : "male", spec: { sr: 16000, dur: t + 1, layers: [floor(t + 1), ...layers] } });
    }
  }
  // hold spans on the stream timeline: each voice layer's held segments (F0 in
  // 75-400 Hz, >= 1 s once cut to the layer)
  for (const r of out) {
    r.set = "voice";
    r.holds = [];
    for (const L of r.spec.layers) {
      const v = VBY.get(L.clip); if (!v) continue;
      for (const h of v.held) {
        if (!inBand(h[2])) continue;
        const a = Math.max(h[0], L.from), b = Math.min(h[1], L.from + L.len);
        if (b - a >= 1) r.holds.push([+(L.at + a - L.from).toFixed(3), +(L.at + b - L.from).toFixed(3), h[2]]);
      }
    }
    r.f0 = r.holds.length ? +r.holds[0][2].toFixed(1) : null;
  }
  return out.filter((r) => r.holds.length);
}

let recs;
if (SET === "noise") recs = loadIndex("noise", { minDur: 10 }).filter((r) => r.label !== "floor" && r.class !== "floor" && r.source !== "synthfloor");
else if (SET === "voice") recs = voiceSet();
else recs = loadIndex("mix", { set: { vin: "voice_in_noise", held: "held_series", gated: "noise_gated" }[SET] });
if (A.ids) { const s = new Set(A.ids.split(",")); recs = recs.filter((r) => s.has(r.id)); }
recs.sort((a, b) => a.id.localeCompare(b.id));
// --skip=N: drop this shard's first N streams (resume a run)
const mine = recs.filter((_, i) => i % shN === shI).slice(Number(A.skip ?? 0));
if (A.list) { // --list: stream counts per kind / group, nothing run
  const c = {}; for (const r of recs) { const k = `${r.kind ?? r.set} ${r.grp ?? ""}`; c[k] = (c[k] ?? 0) + 1; }
  console.log(SET, recs.length, "streams", JSON.stringify(c)); process.exit(0);
}

// voice truth: Praat AC F0 of each voice layer, on the mix timeline
const vIdx = SET === "vin" || SET === "voice" ? VBY : null;
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
  let x = SET === "voice" ? renderMix(rec.spec) : readClip(rec.path);
  if (SET === "noise" && MAXS > 0 && x.length > MAXS * 16000) x = x.subarray(0, MAXS * 16000);
  if (SR !== 16000) x = resample(x, 16000, SR);
  const dur = x.length / SR;
  const row = { set: SET, id: rec.id, sr: SR, dur: +dur.toFixed(2), v: {} };
  if (SET === "noise") Object.assign(row, { label: rec.label, source: rec.source, cls: rec.class, flags: rec.flags ?? [] });
  else if (SET === "voice") Object.assign(row, { kind: rec.kind, grp: rec.grp, f0: rec.f0, holdSec: +rec.holds.reduce((a, [p, q]) => a + q - p, 0).toFixed(2) });
  else Object.assign(row, { noise_id: rec.noise_id, noise_label: rec.noise_label, snr_db: rec.snr_db, voice_kind: rec.voice_kind, gap_s: rec.gap_s, period_s: rec.period_s, off_s: rec.off_s, f0: rec.f0 });
  const truth = SET === "vin" || SET === "voice" ? truthOf(rec) : null;
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
      if (SET === "voice") {
        if (promoV === null && nf && rec.holds.some(([, , f0]) => nf.some((f) => [1, 2, 3].some((k) => Math.abs(f / (k * f0) - 1) < 0.04)))) promoV = +t.toFixed(2);
        if (!rec.holds.some(([a, b]) => t >= a + 0.3 && t <= b - 0.1)) return;
        const f = truth(t);
        if (f > 0) { inc("ok", pv && Math.abs(m.pitch / f - 1) < 0.08); inc("pok", dv && Math.abs(disp[i] / f - 1) < 0.08); }
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
    if (SET === "held" || SET === "voice") out.promoV = promoV;
    for (const k of Object.keys(C)) if (!k.endsWith("_n")) { out[k] = r1(C[k], C[k + "_n"]); out[k + "_n"] = C[k + "_n"]; }
    row.v[vn] = out;
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (A.out) writeFileSync(A.out, JSON.stringify(rows));

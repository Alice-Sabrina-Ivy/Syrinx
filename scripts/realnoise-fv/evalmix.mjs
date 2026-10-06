// evalmix.mjs — real-data mixes through the PRODUCTION chain of a src tree
// (scripts/session-oracle/lib/chain.mjs: real pitch worker, real DSP worker,
// real handleAnalysisResult incl. the pitch-hold bridge), 2026-10-05.
// The painted metrics here are what a user sees (realeval.mjs replays a
// display without the hold bridge).
//
//   node --import ./scripts/realnoise-fv/lib/register.mjs scripts/realnoise-fv/evalmix.mjs \
//        --set=vin|gated|held [--src=src] [--tag=base] [--shard=i/n] [--split=tune|held]
//        [--data-root=<notchvd root>] [--out=build/realnoise-fv/mix]
//
// Per stream (worker values at the frame centre; display hop k shows the
// frame k - L, scored at its centre - 30 ms, the session-oracle convention):
//   vin   — promo (s, first notch); pfvLead / pfvTail painted FV in the
//           20 s real-noise lead (from 1.5 s) / the 5 s tail; voice frames
//           (Praat AC F0 of the voice layer > 0): ok (posted within 8 %),
//           pok (painted within 8 %), the same for F0 < 160 Hz (okLo / pokLo)
//           and >= 160 Hz (okHi / pokHi); pfvProg painted on program frames
//           >= 0.1 s from any voiced truth; hok painted hold frames at pitch.
//   gated — promo after switch-on; pfvAll painted FV from switch-on + 1 s,
//           pfv from switch-on + 21 s.
//   held  — real VocalSet same-pitch hold series: ok / pok on hold frames.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { dataRoot, publicMixes, splitOf } from "./lib/sets.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
dataRoot(args);
const { loadIndex, readClip, DATA } = await import("../notch-adversarial/realdata/realdata.mjs");
const { loadSrc, runWorkers, buildFrames, driveHook } = await import("../session-oracle/lib/chain.mjs");
const SET = args.set ?? "vin", SRC = args.src ?? "src", TAG = args.tag ?? "base";
const S = await loadSrc(SRC);
const SETNAME = { vin: "voice_in_noise", gated: "noise_gated", held: "held_series" }[SET];
let recs = publicMixes(loadIndex, SETNAME);
const keyId = (r) => r.noise_id ?? r.id;
if (args.split) recs = recs.filter((r) => SET === "held" || splitOf(keyId(r)) === args.split);
if (args.ids) { const s = new Set(args.ids.split(",")); recs = recs.filter((r) => s.has(r.id)); }
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);
recs = recs.filter((_, i) => i % shN === shI);

const vIdx = SET === "vin" ? new Map(loadIndex("voice", { noDup: false }).map((r) => [r.path, r])) : null;
function truthOf(rec) { // = realeval.mjs truthOf: Praat AC F0 of each voice layer on the mix timeline
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
    return null;
  };
}

const rows = [];
const t0 = Date.now();
for (const rec of recs) {
  const x = readClip(rec.path);
  const W = runWorkers(S, x, 16000);
  const D = await driveHook(S.hookPath, buildFrames(W), W.n);
  const hop = W.C / W.sr, L = W.L, dur = W.n * hop;
  const C = {};
  const inc = (k, c) => { C[k] = (C[k] ?? 0) + (c ? 1 : 0); C[k + "_n"] = (C[k + "_n"] ?? 0) + 1; };
  let promo = null;
  const on = SET === "gated" ? rec.on_s : 0;
  for (let k = 0; k < W.n; k++) {
    const tw = (k + 1) * hop - 0.040;
    if (promo === null && W.col.nnotch[k] > 0 && tw >= on - 0.04) promo = +(tw + 0.04 - on).toFixed(2);
  }
  const truth = SET === "vin" ? truthOf(rec) : null;
  for (let k = 0; k < W.n; k++) {
    const tw = (k + 1) * hop - 0.040;                 // worker column k: frame centre
    const td = (k + 1) * hop - 0.040 - L * hop - 0.030; // display hop k
    if (td < 0 || tw > dur - 0.3) continue;
    const pv = W.col.post[k], dv = Number.isFinite(W.col.inten[k]) ? D.paint[k] : 0;
    if (SET === "gated") {
      if (td >= on + 1) inc("pfvAll", dv > 0);
      if (td >= on + 21) inc("pfv", dv > 0);
      if (tw >= on + 1) inc("fvAll", pv > 0);
      continue;
    }
    if (SET === "held") {
      const hw = rec.holds.find(([a, b]) => tw >= a + 0.3 && tw <= b - 0.1);
      if (hw) inc("ok", pv > 0 && Math.abs(pv / hw[2] - 1) < 0.08);
      const hd = rec.holds.find(([a, b]) => td >= a + 0.3 && td <= b - 0.1);
      if (hd) inc("pok", dv > 0 && Math.abs(dv / hd[2] - 1) < 0.08);
      else if (!rec.holds.some(([a, b]) => td >= a - 0.15 && td <= b + 0.15)) inc("pfvGap", dv > 0);
      continue;
    }
    // vin
    if (td >= 1.5 && td < rec.voice_t0 - 0.1) inc("pfvLead", dv > 0);
    if (td > rec.voice_t1 + 0.5) inc("pfvTail", dv > 0);
    if (tw >= rec.voice_t0 && tw <= rec.voice_t1) {
      const f = truth(tw);
      if (f > 0) {
        const c = pv > 0 && Math.abs(pv / f - 1) < 0.08;
        inc("ok", c); inc(f < 160 ? "okLo" : "okHi", c);
      }
    }
    if (td >= rec.voice_t0 && td <= rec.voice_t1) {
      const f = truth(td);
      if (f > 0) {
        const c = dv > 0 && Math.abs(dv / f - 1) < 0.08;
        inc("pok", c); inc(f < 160 ? "pokLo" : "pokHi", c);
        if (rec.holds?.length && rec.holds.some(([a, b]) => td >= a + 0.3 && td <= b - 0.1)) inc("hok", c);
      } else {
        let near = false;
        for (let d = -0.1; d <= 0.1001; d += 0.025) if ((truth(td + d) ?? 0) > 0) near = true;
        if (!near) inc("pfvProg", dv > 0);
      }
    }
  }
  const out = { promo };
  for (const k of Object.keys(C)) if (!k.endsWith("_n")) { out[k] = C[k]; out[k + "_n"] = C[k + "_n"]; }
  rows.push({ id: rec.id, split: SET === "held" ? "-" : splitOf(keyId(rec)), noise_id: rec.noise_id ?? null, noise_label: rec.noise_label ?? null,
    snr_db: rec.snr_db ?? null, voice_kind: rec.voice_kind ?? null, gap_s: rec.gap_s ?? null, period_s: rec.period_s ?? null, off_s: rec.off_s ?? null, ...out });
}
const OUT = resolve(args.out ?? "build/realnoise-fv/mix", TAG);
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, `${SET}.${shI}of${shN}.json`), JSON.stringify(rows));
console.log(`${TAG} ${SET} ${shI}/${shN}: ${rows.length} streams ${(Date.now() - t0) / 1000}s`);

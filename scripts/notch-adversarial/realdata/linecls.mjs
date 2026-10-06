// linecls.mjs — census of the ONLINE line-coherence verdict (cand3-notch.js,
// the shipped estimator incl. its line-presence gate, reanchor and jump
// guard) on the real corpora: the notch tracker runs with promotion disabled
// and voice timing ON, so every track's verdicts AND the voice timing it
// would get are recorded per observation.
//   node scripts/notch-adversarial/realdata/linecls.mjs --set=voice|noise|held|gated [--deg=inf,20,10,0]
//        [--variant=V19f] [--shard=i/n] [--out=F] [--vcorr= --vcoh= --mcorr= --mcoh=]
// --variant picks the coherence options of a variants.mjs entry (default V19f =
// src/ since the 2026-10-06 fix round, V18 before: verdict pcorr >= 0.7 AND
// pcoh >= 2.5 c, 72-403 Hz, takeover jump guard); --vcorr / --vcoh / --mcorr /
// --mcoh override its thresholds (the discrimination phase's 0.5 / 2 c are NOT
// the default — measurements/noise-notch-voice-discrimination-2026-10-05.md).
// voice: typical real held voice (PVQD CAPE-V < 20, VOICED healthy, VocalSet,
//   vocadito; public sources only — realdata.mjs loadIndex); ids listed in
//   data/exclude_voice_ids.txt (local, gitignored) are skipped — e.g. a tone
//   mis-attributed to a voice run; a voice line = a track within +-3 % of
//   k x the held F0 (k = 1..8) while inside the held segment; white noise at
//   --deg dB vs the held-segment RMS (seeded). noise: every non-duplicate noise
//   clip >= 10 s (first 90 s; DEMAND rooms with talkers excluded), every track
//   in the coherence band. held: held_series mixes (voice lines). gated:
//   noise_gated mixes (machine lines).
// Per track (one row): n / voice / mach = observations with a verdict / voice
// / machine; firstMachT; t0 (s, first sighting), span (s, first to last
// sighting), ob0 (onset-born at birth), tVoice (s after the first sighting:
// first voice verdict), tGrant (voice timing granted), tJump (jump guard set),
// vmax (max over observations with >= 3 windows of min(pcorr / vCorr,
// pcoh / vCoh): >= 1 = voice-confirmed; 1 - vmax = the line's margin to the
// voice verdict),
// duty5 (sighting duty over its first 5 s), atRisk (not onset-born, seen
// >= 4.9 s at duty >= 0.9: bc42ad0 notches such a line 4.9-5 s after its first
// sighting unless it gets voice timing first).
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadIndex, readClip, DATA } from "./realdata.mjs";
import { mulberry } from "../synth.mjs";
import { VARIANTS } from "../variants.mjs";
const { createNoiseNotch } = await import("../cand3-notch.js");
const A = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const SET = A.set || "noise";
const [shI, shN] = (A.shard || "0/1").split("/").map(Number);
const DEGS = (A.deg || "inf").split(",").map((d) => (d === "inf" ? Infinity : +d));
const VAR = A.variant || "V19f";
const base = VARIANTS[VAR]?.opts?.coh;
if (!base) throw new Error(`--variant=${VAR}: no coh options in variants.mjs`);
// cand3-notch.js's coh defaults the variant does not override (fLo 80 = V14's band)
const COH = { minWin: 3, fLo: 80, fHi: 400, vCorr: 0.5, vCoh: 2, mCorr: 0.15, mCoh: 1, ...base, voice: "onset", machine: false,
  ...(A.vcorr != null ? { vCorr: +A.vcorr } : {}), ...(A.vcoh != null ? { vCoh: +A.vcoh } : {}),
  ...(A.mcorr != null ? { mCorr: +A.mcorr } : {}), ...(A.mcoh != null ? { mCoh: +A.mcoh } : {}) };
const SPEECHY = new Set(["OMEETING", "PCAFETER", "PRESTO", "PSTATION", "SPSQUARE", "OHALLWAY", "NPARK"]);
const OBS = 0.1; // s per observation at 25 ms chunks

let recs;
const EXCL = existsSync(join(DATA, "exclude_voice_ids.txt")) ? new Set(readFileSync(join(DATA, "exclude_voice_ids.txt"), "utf8").split(/\s+/).filter(Boolean)) : new Set();
if (SET === "voice") recs = loadIndex("voice").filter((r) => {
  // speech corpora, Hillenbrand vowels and the synthetic supplement are not held-voice material
  if (["hillenbrand", "ptdb", "fda", "synthetic"].includes(r.source)) return false;
  if (EXCL.has(r.id)) return false;
  if (r.source === "pvqd" && !(r.capev_severity != null && r.capev_severity < 20)) return false;
  if (r.source === "voiced" && r.diagnosis !== "healthy") return false;
  return (r.held || []).some((h) => h[1] - h[0] >= 1.1 && h[2] > 0);
});
else if (SET === "noise") recs = loadIndex("noise", { minDur: 10 }).filter((r) => r.source !== "synthfloor" && r.label !== "floor"
  && !(r.source === "demand" && SPEECHY.has(r.class)));
else recs = loadIndex("mix", { set: SET === "held" ? "held_series" : "noise_gated" });
if (A.ids) { const s = A.ids.split(","); recs = recs.filter((r) => s.some((i) => r.id.includes(i))); }
recs.sort((a, b) => a.id.localeCompare(b.id));
const mine = recs.filter((_, i) => i % shN === shI);

function gauss(r) { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const out = [];
for (const rec of mine) {
  let x0 = readClip(rec.path);
  if (x0.length > 90 * 16000) x0 = x0.subarray(0, 90 * 16000);
  const holds = SET === "voice" ? rec.held.filter((h) => h[2] > 0) : SET === "held" ? rec.holds : null;
  for (const deg of SET === "voice" ? DEGS : [Infinity]) {
    let x = x0;
    if (deg !== Infinity) {
      let ss = 0, m = 0;
      for (const [a, b] of holds) for (let i = Math.floor(a * 16000); i < Math.min(x0.length, b * 16000); i++) { ss += x0[i] * x0[i]; m++; }
      const g = Math.sqrt((ss / Math.max(1, m)) / Math.pow(10, deg / 10)), r = mulberry(7 + out.length);
      x = Float32Array.from(x0, (v) => v + g * gauss(r));
    }
    const T = new Map(); let chunk = 0;
    const roleOf = (t, time) => {
      if (SET === "noise" || SET === "gated") return "machine";
      const h = holds.find(([a, b]) => time >= a + 0.5 && time <= b + 0.6);
      return h && [1, 2, 3, 4, 5, 6, 7, 8].some((k) => Math.abs(t.freq / (k * h[2]) - 1) < 0.03) ? "voice" : null;
    };
    globalThis.__COHCLS = (t, cls) => {
      const time = chunk * 0.025;
      const e = T.get(t.id);
      if (!e) return;
      if (roleOf(t, time)) e.role = true;
      e.n++; if (cls === "machine") { e.mach++; e.firstMachT ??= +(time - e.t0).toFixed(2); }
      if (cls === "voice") { e.voice++; e.tVoice ??= +(time - e.t0).toFixed(2); }
    };
    globalThis.__OBSDBG = (o, tracks) => {
      const time = chunk * 0.025;
      for (const t of tracks) {
        if (t.freq < COH.fLo || t.freq > COH.fHi) continue;
        let e = T.get(t.id);
        if (!e) { e = { f: t.freq, n: 0, mach: 0, voice: 0, firstMachT: null, t0: time, o0: o, ob0: !!t.onsetBorn, last: o, hits5: 0, role: false, tVoice: null, tGrant: null, tJump: null, vmax: null }; T.set(t.id, e); }
        if (t.cohStat && (t.coh?.wins.length ?? 0) >= COH.minWin) { const sc = Math.min(t.cohStat[0] / COH.vCorr, t.cohStat[1] / COH.vCoh); if (e.vmax === null || sc > e.vmax) e.vmax = sc; }
        if (t._seen) { e.last = o; if (o - e.o0 < 50) e.hits5++; if (roleOf(t, time)) e.role = true; }
        if (t.voiceBorn && e.tGrant === null) e.tGrant = +(time - e.t0).toFixed(2);
        if (t.jumped && e.tJump === null) e.tJump = +(time - e.t0).toFixed(2);
      }
    };
    const nt = createNoiseNotch(16000, { rebirth: false, coh: COH, minTrackSec: 1e9, onsetMinTrackSec: 1e9 });
    for (let c = 0; c + 400 <= x.length; c += 400) { chunk++; nt.process(Float32Array.from(x.subarray(c, c + 400))); }
    globalThis.__COHCLS = undefined; globalThis.__OBSDBG = undefined;
    for (const [id, e] of T) {
      if (!e.role) continue;
      const span = +((e.last - e.o0) * OBS).toFixed(2), duty5 = +(e.hits5 / Math.min(50, e.last - e.o0 + 1)).toFixed(2);
      if (e.n === 0 && span < 2) continue; // never measured long enough to matter
      out.push({ set: SET, variant: VAR, vth: [COH.vCorr, COH.vCoh], fLo: COH.fLo, id: rec.id, source: rec.source, cls: rec.class, label: rec.label ?? rec.noise_label, deg: deg === Infinity ? "inf" : deg, track: id, f: +e.f.toFixed(1),
        n: e.n, mach: e.mach, voice: e.voice, firstMachT: e.firstMachT, t0: +e.t0.toFixed(2), span, ob0: e.ob0, tVoice: e.tVoice, tGrant: e.tGrant, tJump: e.tJump, duty5,
        vmax: e.vmax === null ? null : +e.vmax.toFixed(3),
        atRisk: !e.ob0 && span >= 4.9 && duty5 >= 0.9,
        ...(SET === "gated" ? { period_s: rec.period_s, off_s: rec.off_s } : {}), ...(SET === "held" ? { gap_s: rec.gap_s } : {}), singer: rec.singer });
    }
  }
  if (A.verbose) console.log(rec.id, out.length);
}
if (A.out) writeFileSync(A.out, JSON.stringify(out));
console.log(`${SET} (${VAR}${A.vcorr || A.vcoh ? ` vcorr ${COH.vCorr} vcoh ${COH.vCoh}` : ""}): ${mine.length} clips, ${out.length} tracks`);

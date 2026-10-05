// linecls.mjs — census of the ONLINE line-coherence classifier
// (cand3-notch.js, the shipped estimator incl. its line-presence gate) on the
// real corpora: the notch tracker runs with promotion disabled, and every
// observation's verdict per track ("machine" / "voice" / undecided) is
// recorded. A track counts as called machine / voice if ANY observation
// called it so (the notch re-checks every observation).
//   node scripts/notch-adversarial/realdata/linecls.mjs --set=voice|noise|held|gated [--deg=inf,20,10,0]
//        [--shard=i/n] [--out=F] [--vcorr=0.5 --vcoh=2 --mcorr=0.15 --mcoh=1]
// voice: typical real held voice (PVQD CAPE-V < 20, VOICED healthy, VocalSet,
//   vocadito, the private session runs; ids listed in data/exclude_voice_ids.txt
//   are skipped — the data phase's mis-attributed 12-TET reference tone);
//   a voice line = a track within +-3 % of k x the held
//   F0 (k = 1..8) while inside the held segment; white noise at --deg dB vs
//   the held-segment RMS (seeded). noise: every non-duplicate noise clip >= 10 s
//   (first 90 s; DEMAND rooms with talkers and the private sessions' "outside"
//   runs that are not 12-TET reference tones excluded), every track in 80-400 Hz. held:
//   held_series mixes (voice lines). gated: noise_gated mixes (machine lines).
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadIndex, readClip, DATA } from "./realdata.mjs";
import { mulberry } from "../synth.mjs";
const { createNoiseNotch } = await import("../cand3-notch.js");
const A = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const SET = A.set || "noise";
const [shI, shN] = (A.shard || "0/1").split("/").map(Number);
const DEGS = (A.deg || "inf").split(",").map((d) => (d === "inf" ? Infinity : +d));
const COH = { voice: "none", machine: false, vCorr: +(A.vcorr ?? 0.5), vCoh: +(A.vcoh ?? 2), mCorr: +(A.mcorr ?? 0.15), mCoh: +(A.mcoh ?? 1) };
const SPEECHY = new Set(["OMEETING", "PCAFETER", "PRESTO", "PSTATION", "SPSQUARE", "OHALLWAY", "NPARK"]);

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
  && !(r.source === "demand" && SPEECHY.has(r.class)) && !(r.source.endsWith("_outside") && !(r.flags || []).includes("equal_tempered")));
else recs = loadIndex("mix", { set: SET === "held" ? "held_series" : "noise_gated" });
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
    globalThis.__COHCLS = (t, cls) => {
      const time = chunk * 0.025;
      let role = SET === "noise" || SET === "gated" ? "machine" : null;
      if (holds) {
        const h = holds.find(([a, b]) => time >= a + 0.5 && time <= b + 0.6);
        if (h && [1, 2, 3, 4, 5, 6, 7, 8].some((k) => Math.abs(t.freq / (k * h[2]) - 1) < 0.03)) role = "voice";
      }
      if (!role) return;
      const e = T.get(t.id) ?? { f: t.freq, n: 0, mach: 0, voice: 0, firstMachT: null, t0: time };
      e.n++; if (cls === "machine") { e.mach++; e.firstMachT ??= +(time - e.t0).toFixed(2); } if (cls === "voice") e.voice++;
      T.set(t.id, e);
    };
    const nt = createNoiseNotch(16000, { coh: COH, minTrackSec: 1e9, onsetMinTrackSec: 1e9 });
    for (let c = 0; c + 400 <= x.length; c += 400) { chunk++; nt.process(Float32Array.from(x.subarray(c, c + 400))); }
    globalThis.__COHCLS = undefined;
    for (const [id, e] of T) out.push({ set: SET, id: rec.id, source: rec.source, cls: rec.class, label: rec.label ?? rec.noise_label, deg: deg === Infinity ? "inf" : deg, track: id, f: +e.f.toFixed(1), n: e.n, mach: e.mach, voice: e.voice, firstMachT: e.firstMachT,
      ...(SET === "gated" ? { period_s: rec.period_s, off_s: rec.off_s } : {}), ...(SET === "held" ? { gap_s: rec.gap_s } : {}), singer: rec.singer });
  }
  if (A.verbose) console.log(rec.id, out.length);
}
if (A.out) writeFileSync(A.out, JSON.stringify(out));
console.log(`${SET}: ${mine.length} clips, ${out.length} classified tracks`);

// gating.mjs — how the Dashboard's resonance cue gates public material
// (measurements/resonance-cue-production-path-2026-10-07.md §4-6).
//
//   node scripts/resonance/gating.mjs --r1=<jobs_r1.json> [--out=build/resonance-cue/gating.json]
//
// The production path end to end: the REAL pitch worker (fake `self`) feeds
// the lab engine in "frames" mode; every vtln bin goes into a gated cue
// (resonanceCue.js, the utterance gate) and an ungated one side by side.
//
//   running speech  40 LibriSpeech test-clean readers (20 women, 20 men; the
//                   resonance-lab benchmark's r1 set, 5 utterances each),
//                   each speaker's utterances concatenated into one reading
//                   stream, 48 kHz (band-limited x3 upsample), 25 ms chunks.
//                   --r1 is a JSON list [{key, audio: <float32 16 kHz file>,
//                   sr: 16000, speaker, sex}] (LibriSpeech is CC BY 4.0;
//                   build it from test-clean with any resampler — no audio is
//                   committed).
//   held vowels     synthetic: 4 s holds (after 0.5 s of silence) at 110 /
//                   165 / 220 / 300 Hz on /a/ /i/ /u/ formants, with and
//                   without 5 Hz ±0.3 st vibrato.
//
// Output: summary on stdout, per-item rows in --out (gitignored build/).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const r1Path = arg("r1", "");
const outPath = arg("out", path.join(repo, "build/resonance-cue/gating.json"));
const ASSETS = path.join(repo, "public/resonance-lab");
const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);
const { createLabEngine } = await import(pathToFileURL(path.join(repo, "src/resonance-lab/lab-engine.js")).href);
const { createResonanceCue } = await import(pathToFileURL(path.join(repo, "src/resonance/resonanceCue.js")).href);

let sink = [];
globalThis.self = { postMessage: (m) => sink.push(m) };
await import(pathToFileURL(path.join(repo, "src/dsp/pitch-worker.js")).href);
const pitchOn = self.onmessage;
const vtln = JSON.parse(readFileSync(path.join(ASSETS, "vtln_warp.json"), "utf8"));
const reference = JSON.parse(readFileSync(path.join(ASSETS, "reference.json"), "utf8"));
const G = reference.vtln.womenMedian - reference.vtln.menMedian;
const uOf = (raw) => (raw - reference.vtln.menMedian) / G;
const bandU = (sex) => ["q10", "q25", "q50", "q75", "q90"].map((k) => uOf(reference.vtln[sex === "f" ? "women" : "men"][k]));

const SR = 48000, CH = 1200;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
// Runs a 48 kHz signal through the production path. `holdFrom`: time (s) a
// held note starts (for the sustained share); returns per-run stats.
function run(y, { holdFrom = null, holdTo = null } = {}) {
  pitchOn({ data: { type: "init", inputSampleRate: SR } });
  const port = {}; pitchOn({ data: { type: "audioPort", port } });
  const gated = createResonanceCue({ reference });
  const ungated = createResonanceCue({ reference, gate: false });
  let stampedInHold = 0, droppedInHold = 0, lastAdmitted = 0, lastDropped = 0;
  let curT = 0;
  const eng = createLabEngine({ sampleRate: SR, models: { vtln }, reference, pitchSource: "frames",
    onStamped: (n, te, st, v) => {
      if (n !== "vtln") return;
      const a = gated.onStamped(te, st, v);
      ungated.onStamped(te, st, v);
      if (holdFrom !== null && te >= holdFrom && te < holdTo) { stampedInHold++; if (!a) droppedInHold++; }
    } });
  let tLive = null, tSettling = null, sustainedTicks = 0, holdTicks = 0;
  const f0s = [];          // every posted voiced pitch value (Hz)
  const liveU = [];        // the gated readout every 0.2 s of audio once full (what the dot shows)
  let nextSample = 0;
  for (let s = 0; s < y.length; s += CH) {
    const x = y.slice(s, Math.min(y.length, s + CH));
    const ct = Math.min(y.length, s + CH) / SR;
    curT = ct;
    const verdict = gated.noteChunk(ct);
    eng.pushChunk(x, null, ct);
    sink = [];
    port.onmessage({ data: { buffer: x.slice().buffer, contextTime: ct } });
    for (const m of sink) {
      if (m.type !== "pitch") continue;
      gated.notePitchHint({ voiced: m.voiced, pitch: m.pitch, contextTime: m.contextTime });
      if (m.voiced && m.pitch > 0) f0s.push(m.pitch);
      eng.pushPitchFrame(m.contextTime, m.voiced ? m.pitch : 0);
    }
    const g = gated.snapshot();
    if (tSettling === null && g.voicedS >= 2) tSettling = ct;
    if (tLive === null && g.fill >= 1) tLive = ct;
    if (g.fill >= 1 && g.u !== null && ct >= nextSample) { liveU.push(g.u); nextSample = ct + 0.2; }
    if (holdFrom !== null && ct >= holdFrom + 1 && ct < holdTo) { holdTicks++; if (verdict === "sustained") sustainedTicks++; }
  }
  const g = gated.snapshot(), u = ungated.snapshot();
  const voicedTotal = eng.snapshot().voicedS;
  return {
    dur: y.length / SR, voicedS: voicedTotal,
    admitted: g.binsAdmitted, dropped: g.binsDropped,
    uGated: g.u, uUngated: u.u, startU: g.startU,
    tSettling, tLive, gatedVoicedS: g.voicedS,
    stampedInHold, droppedInHold, sustainedShareAfter1s: holdTicks ? sustainedTicks / holdTicks : null,
    f0Median: f0s.length ? q(f0s, 0.5) : null, liveU,
  };
  // (lastAdmitted / lastDropped / curT kept for debugging)
}

const out = { speech: [], held: [] };

// ---- running speech ----
if (r1Path) {
  const jobs = JSON.parse(readFileSync(r1Path, "utf8"));
  const bySpk = new Map();
  for (const j of jobs) { if (!bySpk.has(j.speaker)) bySpk.set(j.speaker, { sex: j.sex, items: [] }); bySpk.get(j.speaker).items.push(j); }
  for (const [spk, { sex, items }] of bySpk) {
    const parts = items.map((j) => { const b = readFileSync(j.audio); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); });
    const n = parts.reduce((a, p) => a + p.length, 0);
    const x16 = new Float32Array(n); let o = 0; for (const p of parts) { x16.set(p, o); o += p.length; }
    const y = Float32Array.from(upsample(x16));
    const r = run(y);
    const band = bandU(sex);
    out.speech.push({ spk, sex, ...r, inBand: r.uGated !== null && r.uGated >= band[0] && r.uGated <= band[4] });
    process.stdout.write(".");
  }
  console.log("");
  const S = out.speech;
  const dropFrac = S.map((r) => r.dropped / (r.admitted + r.dropped));
  const dG = S.filter((r) => r.uGated !== null && r.uUngated !== null).map((r) => Math.abs(r.uGated - r.uUngated));
  console.log(`running speech: ${S.length} readers, ${S.reduce((a, r) => a + r.dur, 0).toFixed(0)} s audio, ${S.reduce((a, r) => a + r.voicedS, 0).toFixed(0)} s voiced`);
  console.log(`  bins dropped by the gate: median ${(100 * q(dropFrac, 0.5)).toFixed(1)} %, q90 ${(100 * q(dropFrac, 0.9)).toFixed(1)} %, pooled ${(100 * S.reduce((a, r) => a + r.dropped, 0) / S.reduce((a, r) => a + r.admitted + r.dropped, 0)).toFixed(1)} %`);
  console.log(`  |readout gated - ungated| at stream end: median ${q(dG, 0.5).toFixed(3)} G, q90 ${q(dG, 0.9).toFixed(3)} G, max ${Math.max(...dG).toFixed(3)} G`);
  const tl = S.filter((r) => r.tLive !== null).map((r) => r.tLive), ts = S.filter((r) => r.tSettling !== null).map((r) => r.tSettling);
  console.log(`  time to settling (2 s admitted voiced): median ${q(ts, 0.5).toFixed(1)} s, q90 ${q(ts, 0.9).toFixed(1)} s`);
  console.log(`  time to live (fill >= 1, 5 s admitted voiced): median ${q(tl, 0.5).toFixed(1)} s, q90 ${q(tl, 0.9).toFixed(1)} s (${tl.length}/${S.length} reached)`);
  for (const sex of ["f", "m"]) {
    const R = S.filter((r) => r.sex === sex);
    console.log(`  ${sex === "f" ? "women" : "men  "}: gated readout u median ${q(R.map((r) => r.uGated), 0.5).toFixed(2)}, inside own q10-q90 band ${R.filter((r) => r.inBand).length}/${R.length}`);
  }

  // ---- cue bands from the distribution of individual live readouts
  // (what the dot shows: one 5 s readout, sampled every 0.2 s of audio once
  // full), each reader weighted equally (50 evenly spaced quantiles of their
  // own readouts), vs reference.json's bands (quantiles of 20 per-speaker
  // medians). Written to --bands-out (public/resonance-lab/cue-bands.json).
  const P = [0.1, 0.25, 0.5, 0.75, 0.9];
  const pooled = (sex) => S.filter((r) => r.sex === sex && r.liveU.length).flatMap((r) => Array.from({ length: 50 }, (_, i) => q(r.liveU, (i + 0.5) / 50)));
  const toRaw = (u) => reference.vtln.menMedian + u * G;
  const bands = {};
  for (const sex of ["m", "f"]) {
    const U = pooled(sex);
    bands[sex === "m" ? "men" : "women"] = Object.fromEntries(P.map((p) => [`q${Math.round(p * 100)}`, toRaw(q(U, p))]));
  }
  const inRate = (sex, lo, hi) => {
    const R = S.filter((r) => r.sex === sex && r.liveU.length);
    const per = R.map((r) => r.liveU.filter((u) => u >= lo && u <= hi).length / r.liveU.length);
    return per.reduce((a, b) => a + b, 0) / per.length;
  };
  const bU = (b) => [uOf(b.q10), uOf(b.q90)];
  for (const [label, src] of [["reference.json (per-speaker medians)", { men: reference.vtln.men, women: reference.vtln.women }], ["readout distribution (cue)", bands]]) {
    const [m0, m1] = bU(src.men), [w0, w1] = bU(src.women);
    console.log(`  bands ${label}: men u ${m0.toFixed(2)}…${m1.toFixed(2)}, women u ${w0.toFixed(2)}…${w1.toFixed(2)}; `
      + `share of live readouts inside own band (reader-balanced): men ${(100 * inRate("m", m0, m1)).toFixed(0)} %, women ${(100 * inRate("f", w0, w1)).toFixed(0)} %; `
      + `end-of-stream inside: men ${S.filter((r) => r.sex === "m" && r.uGated >= m0 && r.uGated <= m1).length}/20, women ${S.filter((r) => r.sex === "f" && r.uGated >= w0 && r.uGated <= w1).length}/20`);
  }
  // ---- heard-as conflict note on natural (matched) voices: share of live
  // readouts where |u_F0 - u_resonance| exceeds a threshold (u_F0 from the
  // reader's median posted F0, the heard-as panel's F0 scale).
  const uF0 = (hz) => (Math.log(hz) - 4.8035) / 0.4451;
  for (const thr of [0.5, 0.75, 1.0]) {
    const per = (sex) => {
      const R = S.filter((r) => r.sex === sex && r.liveU.length && r.f0Median);
      const v = R.map((r) => r.liveU.filter((u) => Math.abs(uF0(r.f0Median) - u) > thr).length / r.liveU.length);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    console.log(`  conflict |u_F0 - u| > ${thr} on matched natural voices (share of live readouts, reader-balanced): men ${(100 * per("m")).toFixed(0)} %, women ${(100 * per("f")).toFixed(0)} %`);
  }
  const bandsOut = arg("bands-out", "");
  if (bandsOut) {
    writeFileSync(bandsOut, JSON.stringify({
      source: "LibriSpeech test-clean, the resonance lab's 20 adult men + 20 adult women (r1 set, 5 utterances each); "
        + "distribution of individual gated 5 s readouts through the production path (scripts/resonance/gating.mjs), "
        + "sampled every 0.2 s of audio once full, each reader weighted equally; raw vtln units (u via reference.json vtln medians)",
      generated: "2026-10-07",
      men: bands.men, women: bands.women,
      readers: { men: S.filter((r) => r.sex === "m").length, women: S.filter((r) => r.sex === "f").length },
    }, null, 1) + String.fromCharCode(10));
    console.log(`  cue bands -> ${bandsOut}`);
  }
}

// ---- held vowels (synthetic) ----
const VOWELS = { a: [[730, 90], [1090, 110], [2440, 160]], i: [[270, 60], [2290, 100], [3010, 160]], u: [[300, 60], [870, 90], [2240, 150]] };
function heldVowel(f0, vowel, vibrato) {
  const n = Math.round(SR * 5);
  const src = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 * (vibrato ? Math.pow(2, (0.3 * Math.sin(2 * Math.PI * 5 * t)) / 12) : 1);
    ph += f / SR; if (ph >= 1) ph -= 1;
    const env = t < 0.5 || t >= 4.5 ? 0 : Math.min(1, (t - 0.5) / 0.03, (4.5 - t) / 0.03);
    src[i] = env * ((ph < 0.6 ? Math.sin(Math.PI * ph / 0.6) ** 2 : 0) - 0.3);
  }
  let y = src;
  for (const [f, bw] of VOWELS[vowel]) {
    const r = Math.exp(-Math.PI * bw / SR), th = 2 * Math.PI * f / SR, a1 = 2 * r * Math.cos(th), a2 = -r * r;
    const o = new Float32Array(n); let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { const v = y[i] + a1 * y1 + a2 * y2; o[i] = v; y2 = y1; y1 = v; }
    y = o;
  }
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
  for (let i = 0; i < n; i++) y[i] = (0.3 * y[i]) / pk + 1e-4 * Math.sin(i * 0.37);
  return y;
}
for (const f0 of [110, 165, 220, 300]) for (const v of Object.keys(VOWELS)) for (const vib of [false, true]) {
  const r = run(heldVowel(f0, v, vib), { holdFrom: 0.5, holdTo: 4.5 });
  out.held.push({ f0, vowel: v, vibrato: vib, ...r });
}
{
  const H = out.held;
  const dropFrac = H.map((r) => r.stampedInHold ? r.droppedInHold / r.stampedInHold : null).filter((v) => v !== null);
  const sus = H.map((r) => r.sustainedShareAfter1s);
  console.log(`held vowels: ${H.length} synthetic 4 s holds`);
  console.log(`  share of the hold's bins dropped: median ${(100 * q(dropFrac, 0.5)).toFixed(0)} %, min ${(100 * Math.min(...dropFrac)).toFixed(0)} %`);
  console.log(`  'sustained' share of hold time after its first second: median ${(100 * q(sus, 0.5)).toFixed(0)} %, min ${(100 * Math.min(...sus)).toFixed(0)} %`);
  console.log(`  bins admitted per hold: max ${Math.max(...H.map((r) => r.admitted))}; reached settling (2 s): ${H.filter((r) => r.tSettling !== null).length}/${H.length}`);
}
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`rows -> ${outPath}`);

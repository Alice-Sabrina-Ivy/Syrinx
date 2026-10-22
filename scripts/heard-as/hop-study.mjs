// hop-study.mjs — what a longer classifier hop does to the live "Likely heard
// as" panel (measurements/heard-as-cpu-2026-10-07.md §3): time to the first
// estimate, hide rules, and the shown estimate, vs the 150 ms schedule.
//
//   node scripts/heard-as/hop-study.mjs --r1=<jobs_r1.json> [--hops=150,300,450,600] [--out=build/heard-as/hop-study.json]
//
// Streams (public / synthetic only):
//   readers  each LibriSpeech test-clean reader of the calibration's hide-rule
//            check (--r1: [{key, audio: float32 16 kHz file, speaker, sex}]),
//            utterances concatenated with 0.3 s gaps, upsampled x3 to 48 kHz
//   short    each reader's first utterance with <= 2.5 s of posted voicing,
//            then 10 s of silence
//   held / noise / silence  build/cue-strip-smoke/{held,noise,silence}.wav
//            (scripts/cue-strip-smoke-wavs.mjs)
// Chain: scripts/heard-as/chain.mjs replay (real pitch worker, the gender
// worker's 150 ms decision tick + classifyDue at each hop, the real utterance
// gate), the deployed classifier (transformers.js cache; logits cached per
// window time, so every hop sees identical logits), src/ml/heard-as.js. The
// panel is simulated as in HeardAsPanel.jsx: an update every 2 s of audio
// from the stream start, and between updates the 250 ms check that hides a
// shown estimate as soon as the voice state turns "sustained". Scored windows
// the classifier skipped count as windows (heard-as.js classified: false).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { replay, loadClassifier, upsample16to48, readWav16 } from "./chain.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const HOPS = arg("hops", "150,300,450,600").split(",").map(Number);
const OUT = arg("out", path.join(repo, "build/heard-as/hop-study.json"));
const { createHeardAsAggregator, heardAsShares, shareTenths } = await import(pathToFileURL(path.join(repo, "src/ml/heard-as.js")).href);
const { HEARD_AS_CALIBRATION: C } = await import(pathToFileURL(path.join(repo, "src/ml/heardAsCalibration.js")).href);

const classify = await loadClassifier();
if (!classify) { console.error("classifier not in the transformers.js cache"); process.exit(2); }

const f32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const streams = [];
const r1 = arg("r1", "");
if (r1) {
  const jobs = JSON.parse(readFileSync(r1, "utf8"));
  const bySpk = new Map();
  for (const j of jobs) { if (!bySpk.has(j.speaker)) bySpk.set(j.speaker, []); bySpk.get(j.speaker).push(j); }
  for (const [spk, js] of bySpk) {
    const gap = new Float32Array(16000 * 0.3);
    const parts = [];
    for (const j of js) { parts.push(f32(j.audio), gap); }
    const n = parts.reduce((a, p) => a + p.length, 0);
    const x = new Float32Array(n); let o = 0; for (const p of parts) { x.set(p, o); o += p.length; }
    streams.push({ name: `reader:${spk}`, kind: "reader", sex: js[0].sex, y: await upsample16to48(x), short: js.map((j) => f32(j.audio)) });
  }
}
// short-speech streams: first utterance per reader with <= 2.5 s posted voicing (checked after replay)
const shortStreams = [];
for (const s of streams) {
  for (const u of s.short) {
    const y = await upsample16to48(Float32Array.from([...u, ...new Float32Array(16000 * 10)]));
    shortStreams.push({ name: `short:${s.name.slice(7)}`, kind: "short", sex: s.sex, y });
    break;
  }
}
for (const n of ["held", "noise", "silence"]) {
  const p = path.join(repo, "build/cue-strip-smoke", `${n}.wav`);
  if (existsSync(p)) { const { x, sr } = readWav16(readFileSync(p)); if (sr === 48000) streams.push({ name: n, kind: n, sex: null, y: x }); }
}

function simulate(r, logitOf, minWindows) {
  const agg = createHeardAsAggregator({ minWindows });
  // events on the audio clock: pitch frames, classified windows, decision ticks
  const ev = [];
  for (const [ms, f0] of r.pitch) ev.push([ms, 0, f0]);
  for (const w of r.windows) ev.push([w.audioMs, 1, w]);
  for (const t of r.ticks) ev.push([t[0], 2, t[1]]);
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const endMs = ev.length ? ev[ev.length - 1][0] : 0;
  let k = 0, voiceState = null, shown = false;
  const out = [];
  for (let now = 250; now <= endMs; now += 250) {
    while (k < ev.length && ev[k][0] <= now) {
      const [ms, type, v] = ev[k++];
      if (type === 0) agg.addPitch({ audioMs: ms, f0: v });
      else if (type === 1) agg.addWindow({ audioMs: ms, logit: v.classify ? logitOf(ms) : null, mode: v.mode, classified: v.classify });
      else voiceState = v;
    }
    const update = now % C.updateMs === 0;
    if (!update && !(shown && voiceState === "sustained")) continue;
    const e = agg.estimate(now, voiceState);
    shown = !e.hidden;
    if (e.hidden) out.push({ t: now, hidden: e.hidden, update });
    else {
      const sh = heardAsShares(e.meterLogit, e.lnF0);
      out.push({ t: now, update, s: sh.s, word: sh.word, tenths: [shareTenths(sh.man), shareTenths(sh.unsure), shareTenths(sh.woman)].flat().join(","), nWindows: e.nWindows });
    }
  }
  return out;
}

const result = { hops: HOPS, streams: [] };
const t0 = Date.now();
let i = 0;
for (const s of [...streams, ...shortStreams]) {
  const cache = new Map();
  const reps = {};
  for (const hop of [...HOPS].sort((a, b) => a - b)) {
    const r = await replay(s.y, { sr: 48000, classifyHopMs: hop });
    for (const w of r.windows) if (w.classify && !cache.has(w.audioMs)) cache.set(w.audioMs, await classify(w.win));
    reps[hop] = r;
  }
  const voicedS = reps[HOPS[0]].pitch.filter((p) => p[1] > 0).length * 0.025;
  if (s.kind === "short" && voicedS > 2.5) { i++; continue; }
  const row = { name: s.name, kind: s.kind, sex: s.sex, durS: s.y.length / 48000, voicedS, runs: {} };
  for (const hop of HOPS) {
    const r = reps[hop];
    const lo = (ms) => cache.get(ms);
    row.runs[hop] = {
      classified: r.windows.filter((w) => w.classify).length, scored: r.windows.length, decisions: r.decisions, scoredTicks: r.ticks.filter((t) => t[2]).length,
      ticksSustained: r.ticks.filter((t) => t[1] === "sustained").length,
      shipped: simulate(r, lo, C.minWindows),
    };
  }
  result.streams.push(row);
  i++;
  if (i % 5 === 0) console.log(`${i}/${streams.length + shortStreams.length}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(result));
console.log(`-> ${OUT}`);

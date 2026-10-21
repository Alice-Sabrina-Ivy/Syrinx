// make_test_fixture.mjs — writes tests/ml/fixtures/heard-as-responsiveness.json, the fixture of
// tests/ml/heard-as-responsiveness-test.js (2026-10-21, H1+H3 of
// measurements/heard-as-low-pitch-and-pauses-2026-10-21.md §8.7).
// Public data only: LibriSpeech dev-clean readers (CC BY 4.0; the held-out split of the study), the same
// readers WORLD-shifted, and synthetic held vowels / noise / silence — derived numbers, no audio. The
// real-whisper guard streams (EARS / Expresso, CC BY-NC 4.0) are NOT stored; the test builds a synthetic
// stand-in instead.
//
//   node scripts/heard-as/low-pitch-pauses/make_test_fixture.mjs --runs=<run.0.jsonl>,<run.1.jsonl> \
//     --guards=<guards/run.0.jsonl>,<guards/run.1.jsonl>
//
// Per stream it keeps what the panel uses (run.mjs records): the posted pitch frames (25 ms grid from t0,
// f0 rounded to 0.01 Hz, a run of n unvoiced frames stored as -n), the gated windows ([end ms, classified])
// with the classified windows' logits, and the gender worker's voice-state changes, up to a cut. It refuses
// to write unless the stored stream gives, at every 250 ms sample up to the cut and at all four timer
// phases, the same panel (shown / hidden reason / wide, eta within 1e-3) as the full record under both the
// 3 s rule without the first-reading check (the panel before 2026-10-21) and the shipped one.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../..");
const { simulate } = await import(pathToFileURL(path.join(here, "analyze.mjs")).href);
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : null; };
const OUT = path.join(REPO, "tests/ml/fixtures/heard-as-responsiveness.json");

// [id, kind, cut s, why]
const PICK = [
  ["ls-dev-3576-nat-pnat", "pauses", 20, "woman reading with her natural pauses (first reading 6.75 -> 3.50 s, near the held-out median)"],
  ["ls-dev-777-nat-pnat", "pauses", 20, "man reading with his natural pauses (first reading 7.75 -> 4.00 s, near the held-out median)"],
  ["ls-dev-1673-nat-p2.5", "pauses", 30, "woman, 2.5 s pauses between sentences (the 3 s rule hid her reading in most pauses)"],
  ["ls-dev-174-nat-p2.5", "pauses", 30, "man, 2.5 s pauses between sentences"],
  ["ls-dev-1993-w75-pnat", "low", 20, "woman's reading WORLD-shifted to a 75 Hz median, natural pauses (no reading with the 3 s rule in the whole 44 s)"],
  ["ls-dev-3170-w75-pnat", "low", 20, "man's reading WORLD-shifted to a 75 Hz median, natural pauses (no reading with the 3 s rule in the whole 45 s)"],
  ["held.after.121.220", "held-after", null, "10 s of a woman's reading (LibriSpeech), then a synthetic 220 Hz held /a/ (5 s, +-0.3 st vibrato)"],
  ["held.after.174.110", "held-after", null, "10 s of a man's reading (LibriSpeech), then a synthetic 110 Hz held /a/"],
  ["held.alone.110", "held", null, "synthetic held /a/ at 110 Hz alone"],
  ["held.alone.220", "held", null, "synthetic held /a/ at 220 Hz alone"],
  ["held.alone.330", "held", null, "synthetic held /a/ at 330 Hz alone"],
  ["synth.held", "held", null, "the cue-strip smoke WAV's held vowel"],
  ["pink60", "noise", null, "60 s of pink noise at speech level (-22.3 dBFS)"],
  ["fill60", "noise", null, "60 s of the -65 dBFS pause fill"],
  ["synth.noise", "noise", null, "the cue-strip smoke WAV's pink noise (-30 dBFS)"],
  ["synth.silence", "noise", null, "the cue-strip smoke WAV's digital silence"],
];

const OLD = { agg: { minVoicedMs: 3000 }, panel: {} };
const NEW = { agg: {}, panel: { fastFirst: true } };
const PHASES = [0, 500, 1000, 1500];

function load(list) {
  const m = new Map();
  for (const p of (list ?? "").split(",").filter(Boolean)) {
    for (const l of readFileSync(p, "utf8").split("\n")) {
      if (!l.trim()) continue;
      const s = JSON.parse(l);
      m.set(s.id, s);
    }
  }
  return m;
}
const all = new Map([...load(arg("runs")), ...load(arg("guards"))]);
const r3 = (x) => Math.round(x * 1000) / 1000;

function encode(s, cutMs) {
  const pitch = s.pitch.filter(([ms]) => ms <= cutMs + 1e-6);
  const t0 = pitch[0][0];
  pitch.forEach(([ms], i) => { if (Math.abs(ms - (t0 + 25 * i)) > 1e-6) throw new Error(`${s.id}: pitch frame ${i} off the 25 ms grid (${ms})`); });
  const f0 = [];
  for (const [, v] of pitch) {
    if (v > 0) f0.push(Math.round(v * 100) / 100);
    else if (f0.length && f0[f0.length - 1] < 0) f0[f0.length - 1]--;
    else f0.push(-1);
  }
  const win = s.windows.filter((w) => w[0] <= cutMs + 1e-6);
  if (win.some((w) => w[1] !== "gated")) throw new Error(`${s.id}: a non-gated window (the panel drops them; not expected in these runs)`);
  const logits = win.filter((w) => w[2]).map((w) => s.logits[w[0]]);
  if (logits.some((x) => typeof x !== "number")) throw new Error(`${s.id}: a classified window without a logit`);
  const states = [];
  for (const t of s.ticks) {
    if (t[0] > cutMs + 1e-6) break;
    if (!states.length || states[states.length - 1][1] !== t[1]) states.push([r3(t[0]), t[1]]);
  }
  return { t0, n: pitch.length, f0, windows: win.map((w) => [r3(w[0]), w[2] ? 1 : 0]), logits, states };
}

// the fixture stream back in run.mjs's shape (what analyze.mjs simulate() reads)
function decode(e, durS) {
  const pitch = [];
  let i = 0;
  for (const v of e.f0) {
    if (v < 0) for (let k = 0; k < -v; k++, i++) pitch.push([e.t0 + 25 * i, 0]);
    else pitch.push([e.t0 + 25 * i++, v]);
  }
  const logits = {};
  let j = 0;
  const windows = e.windows.map(([ms, c]) => { if (c) logits[ms] = e.logits[j++]; return [ms, "gated", c]; });
  return { pitch, windows, logits, ticks: e.states.map(([ms, st]) => [ms, st]), durS };
}

const out = [];
for (const [id, kind, cutS, why] of PICK) {
  const s = all.get(id);
  if (!s) throw new Error(`missing stream ${id} (pass the run files with --runs / --guards)`);
  const cutMs = cutS === null ? s.durS * 1000 : Math.min(cutS * 1000, s.durS * 1000);
  const enc = encode(s, cutMs);
  const durS = cutMs / 1000;
  const dec = decode(enc, durS);
  for (const [vn, v] of [["3 s rule", OLD], ["shipped", NEW]]) {
    for (const ph of PHASES) {
      const a = simulate({ ...s, durS }, v, ph).samples, b = simulate(dec, v, ph).samples;
      if (a.length !== b.length) throw new Error(`${id} ${vn} phase ${ph}: ${a.length} vs ${b.length} samples`);
      for (let k = 0; k < a.length; k++) {
        const x = a[k], y = b[k];
        const same = x.shown === y.shown && x.reason === y.reason && x.vs === y.vs && (!x.shown || (x.wide === y.wide && Math.abs(x.eta - y.eta) < 1e-3));
        if (!same) throw new Error(`${id} ${vn} phase ${ph} t ${x.t}: stored ${JSON.stringify(y)} vs full ${JSON.stringify(x)}`);
      }
    }
  }
  const spans = (s.speechSpans ?? []).filter(([a]) => a < cutMs).map(([a, b]) => [r3(a), r3(Math.min(b, cutMs))]);
  out.push({ id, kind, sex: s.sex ?? null, why, leadMs: s.leadMs ?? 1000, durMs: r3(cutMs), speechSpans: spans, ...enc });
  console.log(`${id}: ${enc.n} frames, ${enc.windows.length} windows, ${enc.logits.length} logits, ${enc.states.length} state changes — reproduces the full record`);
}

const fixture = {
  about: "Fixture of tests/ml/heard-as-responsiveness-test.js — measurements/heard-as-low-pitch-and-pauses-2026-10-21.md §8.7. Public data only: LibriSpeech dev-clean readers (CC BY 4.0), the same readers WORLD-shifted, synthetic held vowels / noise / silence; derived numbers, no audio. Each stream is the app's chain output (run.mjs: real pitch worker, utterance gate with the Silero speech detector, the deployed classifier) up to durMs: posted pitch frames at t0 + 25 ms steps (f0 Hz, 2 dp; -n = n unvoiced frames), the gated windows [end ms, classified 0/1] with the classified ones' logits in order, and the gender worker's voice-state changes [ms, state]. Times are audio-clock ms from the stream start; speech starts at leadMs. Written by scripts/heard-as/low-pitch-pauses/make_test_fixture.mjs, which checks that the stored stream gives the same panel as the full record.",
  streams: out,
};
writeFileSync(OUT, JSON.stringify(fixture));
console.log(`-> ${OUT} (${(JSON.stringify(fixture).length / 1024).toFixed(1)} KB)`);

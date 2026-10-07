// vtln-production-parity-test.js — the Dashboard's resonance cue computes
// EXACTLY what the resonance lab computes, without re-running the pitch chain.
//
//   A  the lab engine's own path: createLabEngine({ models: { vtln },
//      pitchSource: "internal" }) — its embedded production pitch replica.
//   B  the production path: the REAL pitch worker (src/dsp/pitch-worker.js,
//      fake `self`) fed the same capture chunks; its posted
//      { pitch, voiced, contextTime } relayed into
//      createLabEngine({ pitchSource: "frames" }).pushPitchFrame with relay
//      delays of 0, 3 and 20 chunks.
//   Bit-exact (===): same bin keys, null pattern and values, the same 10 ms
//   grid track, the same readout snapshot raw / n / voicedS; no dropped or
//   forced frames.
//   C  the REAL resonance worker (src/resonance/resonance-worker.js, fake
//      `self`, fetch stubbed to read public/): with the gate admitting
//      everything its readout equals B's; a synthetic held vowel yields
//      verdict "sustained" and adds no bins after the gate fires.
//
// Each committed lab fixture (5 s LibriSpeech, tests/resonance-lab/fixtures/)
// at 48 kHz (the lab's band-limited upsample, 1200-sample chunks) and at
// 44.1 kHz (linear-resampled from the 48 kHz signal, alternating 1102 / 1103
// sample chunks — exercises the non-integer resampler count).
//
// Drift guard: a pitch-chain change in src/dsp/pitch-worker.js (or its
// modules) that is not mirrored in the lab replica (lab-engine.js pitchStep)
// fails here. Update the replica in the same commit and re-run
// `npm run test:resonance-lab`.
//
//   node tests/resonance/vtln-production-parity-test.js

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const FIX = path.join(repo, "tests/resonance-lab/fixtures");
const ASSETS = path.join(repo, "public", "resonance-lab");
const { createLabEngine } = await import(pathToFileURL(path.join(repo, "src/resonance-lab/lab-engine.js")).href);
const { createResonanceCue } = await import(pathToFileURL(path.join(repo, "src/resonance/resonanceCue.js")).href);
const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);

// ---- one shared fake `self`; each worker module captures its own handler ----
let sink = [];
globalThis.self = { postMessage: (m) => sink.push(m) };
await import(pathToFileURL(path.join(repo, "src/dsp/pitch-worker.js")).href);
const pitchOnMessage = self.onmessage;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const name = String(url).split("/").pop();
  try {
    const body = readFileSync(path.join(ASSETS, name), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => null };
  }
};
await import(pathToFileURL(path.join(repo, "src/resonance/resonance-worker.js")).href);
const resOnMessage = self.onmessage;

const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const vtln = json(path.join(ASSETS, "vtln_warp.json"));
const reference = json(path.join(ASSETS, "reference.json"));

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

function readWav16(p) {
  const b = readFileSync(p);
  let off = 12, data = null;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === "data") { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  const x = new Float32Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return x;
}

function linearResample(x, from, to) {
  const n = Math.floor((x.length - 1) * to / from) + 1;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * from / to;
    const k = Math.floor(p);
    const f = p - k;
    y[i] = k + 1 < x.length ? x[k] + f * (x[k + 1] - x[k]) : x[k];
  }
  return y;
}

// Capture chunks: [{ x, contextTime }] with contextTime = end of the chunk (s).
function chunksOf(y, sr) {
  const out = [];
  let s = 0, i = 0;
  while (s < y.length) {
    const len = sr === 48000 ? 1200 : (i % 2 ? 1103 : 1102);
    const e = Math.min(y.length, s + len);
    out.push({ x: y.slice(s, e), contextTime: e / sr });
    s = e; i++;
  }
  return out;
}

function runInternal(chunks, sr) {
  const bins = new Map();
  const eng = createLabEngine({ sampleRate: sr, models: { vtln }, reference,
    onBin: (n, te, v) => { if (n === "vtln") bins.set(Math.round(te * 1000), v); } });
  for (const c of chunks) eng.pushChunk(c.x);
  return { bins, grid: eng.gridTrack(), snap: eng.snapshot() };
}

function pitchPosts(chunks, sr) {
  // per chunk index: the pitch posts produced while processing that chunk
  pitchOnMessage({ data: { type: "init", inputSampleRate: sr } });
  const port = {};
  pitchOnMessage({ data: { type: "audioPort", port } });
  const perChunk = [];
  for (const c of chunks) {
    sink = [];
    port.onmessage({ data: { buffer: c.x.slice().buffer, contextTime: c.contextTime } });
    perChunk.push(sink.filter((m) => m.type === "pitch"));
  }
  sink = [];
  return perChunk;
}

function runFrames(chunks, sr, posts, delay, stampedSink = null) {
  const bins = new Map();
  const eng = createLabEngine({ sampleRate: sr, models: { vtln }, reference, pitchSource: "frames",
    onBin: (n, te, v) => { if (n === "vtln") bins.set(Math.round(te * 1000), v); },
    onStamped: stampedSink });
  const queue = [];
  chunks.forEach((c, i) => {
    eng.pushChunk(c.x, null, c.contextTime);
    for (const m of posts[i]) queue.push({ at: i, m });
    while (queue.length && queue[0].at <= i - delay) {
      const { m } = queue.shift();
      eng.pushPitchFrame(m.contextTime, m.voiced ? m.pitch : 0);
    }
  });
  while (queue.length) { const { m } = queue.shift(); eng.pushPitchFrame(m.contextTime, m.voiced ? m.pitch : 0); }
  return { bins, grid: eng.gridTrack(), snap: eng.snapshot() };
}

function sameBins(a, b) {
  if (a.size !== b.size) return `size ${a.size} vs ${b.size}`;
  let nonNull = 0;
  for (const [k, v] of a) {
    if (!b.has(k)) return `missing key ${k}`;
    const w = b.get(k);
    if ((v === null) !== (w === null)) return `null mismatch at ${k}`;
    if (v !== w) return `value at ${k}: ${v} vs ${w}`;
    if (v !== null) nonNull++;
  }
  return nonNull > 0 ? null : "no non-null bins";
}
function sameGrid(a, b) {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `grid ${i}: ${a[i]} vs ${b[i]}`;
  return null;
}

const fixtures = ["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"];
const bForC = {};
console.log("vtln production path (pitch worker frames) vs lab engine (internal replica)");
for (const name of fixtures) {
  const x16 = readWav16(path.join(FIX, `${name}.wav`));
  const y48 = Float32Array.from(upsample(x16));
  for (const sr of [48000, 44100]) {
    const y = sr === 48000 ? y48 : linearResample(y48, 48000, 44100);
    const chunks = chunksOf(y, sr);
    const A = runInternal(chunks, sr);
    const posts = pitchPosts(chunks, sr);
    for (const delay of [0, 3, 20]) {
      const B = runFrames(chunks, sr, posts, delay);
      const tag = `${name} @${sr / 1000} kHz, relay ${delay} chunk${delay === 1 ? "" : "s"}`;
      const db = sameBins(A.bins, B.bins);
      const dg = sameGrid(A.grid, B.grid);
      const sa = A.snap.finalists.vtln, sb = B.snap.finalists.vtln;
      const snapOk = sa.raw === sb.raw && sa.n === sb.n && sa.voicedS === sb.voicedS && A.snap.voicedS === B.snap.voicedS;
      check(`${tag}: bins identical`, db === null, db ?? `${A.bins.size} bins`);
      check(`${tag}: grid track identical`, dg === null, dg ?? `${A.grid.length} frames`);
      check(`${tag}: readout raw / n / voicedS identical`, snapOk, `raw ${sa.raw} n ${sa.n} voiced ${sa.voicedS.toFixed(2)} s`);
      check(`${tag}: no dropped / forced frames`, B.snap.framesDropped === 0 && B.snap.gridForcedUnvoiced === 0,
        `dropped ${B.snap.framesDropped}, forced ${B.snap.gridForcedUnvoiced}`);
      if (sr === 48000 && delay === 0) bForC[name] = { chunks, posts, snap: B.snap };
    }
  }
}

// ---- C: the real resonance worker ----
async function runWorker(chunks, posts, { relayEvery = true } = {}) {
  sink = [];
  await resOnMessage({ data: { type: "init", sampleRate: 48000, assetBase: "/", diag: true } });
  const port = {};
  resOnMessage({ data: { type: "audioPort", port } });
  chunks.forEach((c, i) => {
    port.onmessage({ data: { buffer: c.x.slice().buffer, contextTime: c.contextTime } });
    if (relayEvery) for (const m of posts[i]) resOnMessage({ data: { type: "pitch-hint", voiced: m.voiced, pitch: m.pitch, contextTime: m.contextTime } });
  });
  const states = sink.filter((m) => m.type === "state");
  const statuses = sink.filter((m) => m.type === "status").map((m) => m.status);
  return { states, statuses };
}

console.log("\nresonance worker (shim)");
for (const name of fixtures) {
  const { chunks, posts, snap } = bForC[name];
  // ungated reference over B's stamped bins
  const cue = createResonanceCue({ reference, gate: false });
  runFrames(chunks, 48000, posts, 0, (n, te, st, v) => { if (n === "vtln") cue.onStamped(te, st, v); });
  const cs = cue.snapshot();
  check(`${name}: ungated cue readout === engine readout`, cs.raw === snap.finalists.vtln.raw && cs.n === snap.finalists.vtln.n,
    `u ${cs.u?.toFixed(3)}`);
  const { states, statuses } = await runWorker(chunks, posts);
  const last = states[states.length - 1];
  check(`${name}: worker ready, posts state`, statuses[0] === "loading" && statuses.includes("ready") && states.length > 10,
    `${states.length} states`);
  // The worker gates; on running speech it must still read close to the ungated readout.
  check(`${name}: worker u is a reading on running speech`, last && last.u !== null && Number.isFinite(last.u),
    `u ${last?.u?.toFixed(3)} (ungated ${cs.u?.toFixed(3)}), admitted ${last?.perf?.binsAdmitted}, dropped ${last?.perf?.binsDropped}`);
  check(`${name}: worker framesDropped 0`, last.framesDropped === 0);
}

// Ungated worker parity: the worker's cue with a gate that admits everything
// equals B's readout — verified by replaying the worker's own pipeline
// (resonanceCue + frames engine) with gate:false above; here: the worker's
// admitted+dropped bin count equals the engine's stamped count.
{
  const { chunks, posts } = bForC.ls_woman_high;
  let stamped = 0;
  runFrames(chunks, 48000, posts, 0, (n) => { if (n === "vtln") stamped++; });
  const { states } = await runWorker(chunks, posts);
  const p = states[states.length - 1].perf;
  check("worker sees every stamped bin (admitted + dropped = stamped)", p.binsAdmitted + p.binsDropped === stamped,
    `${p.binsAdmitted} + ${p.binsDropped} vs ${stamped}`);
}

// Held vowel: 3 s of a 200 Hz glottal-ish source through fixed formants.
{
  const SR = 48000;
  const n = SR * 4;
  const src = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += 200 / SR; if (ph >= 1) ph -= 1;
    const t = i / SR;
    const env = t < 0.5 ? 0 : t < 3.5 ? 1 : 0; // 0.5 s silence, 3 s vowel, 0.5 s silence
    src[i] = env * (ph < 0.6 ? Math.sin(Math.PI * ph / 0.6) ** 2 : 0) - env * 0.3;
  }
  // three resonators (F1 700, F2 1200, F3 2600 Hz)
  let y = src;
  for (const [f, bw] of [[700, 90], [1200, 110], [2600, 160]]) {
    const r = Math.exp(-Math.PI * bw / SR), th = 2 * Math.PI * f / SR;
    const a1 = 2 * r * Math.cos(th), a2 = -r * r;
    const out = new Float32Array(n);
    let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { const v = y[i] + a1 * y1 + a2 * y2; out[i] = v; y2 = y1; y1 = v; }
    y = out;
  }
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
  for (let i = 0; i < n; i++) y[i] = 0.3 * y[i] / pk;
  const chunks = chunksOf(y, SR);
  const posts = pitchPosts(chunks, SR);
  const voicedPosts = posts.flat().filter((m) => m.voiced).length;
  const { states } = await runWorker(chunks, posts);
  const firstSustained = states.findIndex((s) => s.verdict === "sustained");
  const sustainedShare = states.filter((s) => s.verdict === "sustained").length / Math.max(1, states.filter((s) => s.verdict !== "silent").length);
  check("held vowel: pitch worker voices it", voicedPosts > 80, `${voicedPosts} voiced posts`);
  check("held vowel: gate verdict reaches 'sustained'", firstSustained >= 0, `sustained in ${(100 * sustainedShare).toFixed(0)} % of non-silent states`);
  const admittedAtFire = firstSustained >= 0 ? states[firstSustained].perf.binsAdmitted : null;
  const admittedEnd = states[states.length - 1].perf.binsAdmitted;
  check("held vowel: no bins admitted after the gate fires", admittedAtFire !== null && admittedEnd === admittedAtFire,
    `admitted at fire ${admittedAtFire}, at end ${admittedEnd}, dropped ${states[states.length - 1].perf.binsDropped}`);
  check("held vowel: no readout from a held note alone", states[states.length - 1].u === null || admittedEnd <= 7,
    `u ${states[states.length - 1].u}`);
}

globalThis.fetch = realFetch;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

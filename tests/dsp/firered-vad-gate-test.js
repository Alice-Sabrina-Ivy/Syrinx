// firered-vad-gate-test.js — unit tests of the try-out voice gate's state
// machine and plumbing (src/dsp/firered-vad.js), no model needed:
//   createVoiceGate      w5 smoothing, p >= 0.55, 2 s hangover (the screen's R1 h point)
//   framesAvailableAt    the screen's frame timing (first_avail_ms 26)
//   createFireRedFrontend  frame timing, chunk-size invariance
//   parseKaldiCmvn       DM / FM matrices
//   createVoiceDetector  the model arriving late: backlog capped at 4 s, scored
//                        a little per hop, then the decisions of a run from the start
// The decisions on real audio are checked against the screen's Python code
// by tests/dsp/firered-vad-parity-test.js.
//
//   node tests/dsp/firered-vad-gate-test.js

import {
  FIRERED_GATE, createVoiceGate, createFireRedFrontend, parseKaldiCmvn, createVoiceDetector, MAX_BACKLOG_FRAMES,
  CATCHUP_FRAMES, FIRST_AVAIL_MS, framesAvailableAt,
} from "../../src/dsp/firered-vad.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
}

console.log("operating point");
check("R1 h: w5, p >= 0.55, 2000 ms", FIRERED_GATE.smooth === 5 && FIRERED_GATE.threshold === 0.55 && FIRERED_GATE.hangoverMs === 2000);

console.log("\nsmoothing (trailing mean of the last 5 frames, fewer at the start, float32)");
{
  const g = createVoiceGate();
  const P = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const got = P.map((p) => g.addFrame(p));
  const want = P.map((_, i) => {
    const lo = Math.max(0, i - 4);
    const s = P.slice(lo, i + 1);
    return Math.fround(s.reduce((a, b) => a + b, 0) / s.length);
  });
  check("scores = mean of frames max(0, i-4)..i", got.every((v, i) => Math.abs(v - want[i]) < 1e-7), got.join(","));
  check("scores are float32 values", got.every((v) => v === Math.fround(v)));
  check("frame count", g.frames === 7);
}

console.log("\nthreshold (newest frame's score at the hop; >= 0.55)");
{
  const g = createVoiceGate({ smooth: 1, hangoverMs: 0 });
  check("no frame yet: p = 0, not voice", (() => { const h = g.hop(0.025); return h.p === 0 && !h.on && !h.voice; })());
  g.addFrame(0.55);
  check("p exactly 0.55 is on (>=)", g.hop(0.05).on === true);
  g.addFrame(Math.fround(0.5499));
  check("p 0.5499 is off", g.hop(0.075).on === false);
  g.addFrame(0.2); g.addFrame(0.9);
  check("only the newest frame counts (agg last)", g.hop(0.1).on === true);
}
{
  const g = createVoiceGate({ hangoverMs: 0 });
  for (const p of [1, 1, 1, 0, 0]) g.addFrame(p);
  check("w5: one 0.6 mean (3 of 5 at 1) is on", g.hop(0.025).on === true);
  g.addFrame(0);
  check("w5: 2 of 5 at 1 (0.4) is off", g.hop(0.05).on === false);
}

console.log("\nhangover (voice while a hop within the last 2 s was on)");
{
  const g = createVoiceGate({ smooth: 1 });
  g.addFrame(0.9);
  const t0 = 0.025;
  check("on hop is voice", g.hop(t0).voice);
  g.addFrame(0.1);
  const seq = [];
  for (let k = 1; k <= 82; k++) seq.push(g.hop(t0 + 0.025 * k).voice);
  check("voice for 80 hops (2.000 s) after the last on hop", seq.slice(0, 80).every(Boolean));
  check("no voice from 2.025 s on", !seq[80] && !seq[81]);
  g.addFrame(0.95);
  check("a new on hop restarts it", g.hop(t0 + 0.025 * 83).voice);
}
{
  const g = createVoiceGate();
  check("cold start, no frames: not voice", !g.hop(0.025).voice);
  g.reset();
  check("reset clears frames", g.frames === 0);
}

console.log("\nframe timing (score.py hop_probs, first_avail_ms 26: frame i from 26 + 10 i ms)");
{
  check("first_avail_ms is the screen's 26", FIRST_AVAIL_MS === 26);
  check("no frame at 25 ms (frame 0's samples are in, but the screen counts it from 26 ms)", framesAvailableAt(0.025) === 0);
  check("frame 0 at 26 ms", framesAvailableAt(0.026) === 1);
  check("3 frames at 50 ms, 4 at 56 ms", framesAvailableAt(0.05) === 3 && framesAvailableAt(0.056) === 4);
  // the same formula as score.py, at the pitch worker's 25 ms hop times
  const py = (t) => { const i = Math.floor((t - 26 / 1000.0) / (10 / 1000.0) + 1e-9); return i < 0 ? 0 : i + 1; };
  let diff = 0;
  for (let k = 0; k < 4000; k++) if (framesAvailableAt(((k + 1) * 400) / 16000) !== py((k + 1) * 0.025)) diff++;
  check("equals score.py's count on 4000 hop times (k * 400 / 16000 s vs k * 0.025 s)", diff === 0, `${diff} differ`);
}

console.log("\nfront end");
{
  const N = 16000;
  const x = Float32Array.from({ length: N }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 16000) + 0.01 * Math.sin(i * 1.7));
  const run = (chunk) => {
    const fe = createFireRedFrontend(null);
    const out = [];
    for (let a = 0; a < N; a += chunk) out.push(...fe.push(x.subarray(a, Math.min(N, a + chunk))));
    return { out, fe };
  };
  const a = run(400), b = run(1), c = run(1201), d = run(N);
  check("frames = floor((N - 400) / 160) + 1", a.out.length === Math.floor((N - 400) / 160) + 1, String(a.out.length));
  const same = (u, v) => u.out.length === v.out.length && u.out.every((f, i) => f.every((q, j) => q === v.out[i][j]));
  check("chunk size does not change any frame (1 / 400 / 1201 / all)", same(a, b) && same(a, c) && same(a, d));
  check("samples counted", a.fe.samples === N);
  const fe = createFireRedFrontend(null);
  check("399 samples: no frame", fe.push(new Float32Array(399)).length === 0);
  check("400th sample completes frame 0", fe.push(new Float32Array(1)).length === 1);
  check("frame 1 needs 160 more", fe.push(new Float32Array(159)).length === 0 && fe.push(new Float32Array(1)).length === 1);
  const silent = createFireRedFrontend(null).push(new Float32Array(400))[0];
  check("digital silence: log floor (FLT_EPSILON)", silent.every((v) => Math.abs(v - Math.log(1.1920928955078125e-7)) < 1e-4));
  const cm = { mean: new Float64Array(80).fill(1), istd: new Float64Array(80).fill(2) };
  const withCmvn = createFireRedFrontend(cm).push(new Float32Array(400))[0];
  check("CMVN applied: (x - mean) * istd", withCmvn.every((v, j) => Math.abs(v - Math.fround((silent[j] - 1) * 2)) < 1e-5));
  check("raw log-mel frames are float64 (CMVN applied later, same values)", silent instanceof Float64Array);
}

console.log("\ncmvn.ark parser");
function kaldiMat(tok, rows, cols, vals) {
  const w = tok === "DM " ? 8 : 4;
  const b = new Uint8Array(15 + rows * cols * w);
  const dv = new DataView(b.buffer);
  b.set([0, 0x42, ...[...tok].map((c) => c.charCodeAt(0))], 0);
  b[5] = 4; dv.setInt32(6, rows, true); b[10] = 4; dv.setInt32(11, cols, true);
  vals.forEach((v, i) => (w === 8 ? dv.setFloat64(15 + 8 * i, v, true) : dv.setFloat32(15 + 4 * i, v, true)));
  return b;
}
for (const tok of ["DM ", "FM "]) {
  // dim 2: sums [2, 4], count 2 ; sum of squares [4, 10]
  const m = parseKaldiCmvn(kaldiMat(tok, 2, 3, [2, 4, 2, 4, 10, 0]));
  check(`${tok.trim()}: mean = sum / count`, m.dim === 2 && m.mean[0] === 1 && m.mean[1] === 2);
  check(`${tok.trim()}: istd = 1 / sqrt(sumsq / count - mean^2)`, Math.abs(m.istd[0] - 1) < 1e-12 && Math.abs(m.istd[1] - 1) < 1e-12);
}
let threw = false;
try { parseKaldiCmvn(new Uint8Array([60, 33, 68, 79])); } catch { threw = true; }
check("non-Kaldi bytes are refused", threw);

console.log("\ndetector: the model arriving late (backlog capped at 4 s, scored a little per hop)");
{
  // A fake model: probability from one feature, squashed (deterministic per
  // frame, no state), so replay order and truncation are what's tested. It
  // records how many frames each call scored.
  const fakeRunner = () => {
    const calls = [];
    return { calls, async run(frames) { calls.push(frames.length); return Float32Array.from(frames, (f) => 1 / (1 + Math.exp(-f[5] / 4))); }, reset() {} };
  };
  const cm = { mean: new Float64Array(80).fill(0), istd: new Float64Array(80).fill(1) };
  // 14 s: voice at 0.5-2 s, 4.6-5 s, 9-9.4 s and 12-13 s, quiet between
  const sig = Float32Array.from({ length: 16000 * 14 }, (_, i) => {
    const t = i / 16000;
    const on = (t > 0.5 && t < 2) || (t > 4.6 && t < 5) || (t > 9 && t < 9.4) || (t > 12 && t < 13);
    return on ? 0.3 * Math.sin(2 * Math.PI * 180 * t) : 1e-4 * Math.sin(i);
  });
  async function drive(readyAt) {
    const det = createVoiceDetector();
    const r = fakeRunner();
    const out = [];
    const n = Math.floor(sig.length / 400);
    for (let k = 0; k < n; k++) {
      if (k === readyAt) det.setModel({ runner: r, cmvn: cm });
      det.pushAudio(sig.subarray(k * 400, (k + 1) * 400));
      const t = ((k + 1) * 400) / 16000;
      out.push(det.ready ? await det.hop(t) : det.noteHop(t));
    }
    return { out, calls: r.calls, det };
  }
  const { out: ref, calls: refCalls } = await drive(0);
  check("model from the start: a decision on every hop", ref.every((h) => h !== null));
  check("model from the start: the gate opens and closes", ref.some((h) => h.voice) && ref.some((h) => !h.voice));
  check("model from the start: at most 3 frames per call", Math.max(...refCalls) <= 3, `max ${Math.max(...refCalls)}`);
  for (const at of [1, 40, 100, 200, 300, 480]) {
    const { out: got, calls, det } = await drive(at);
    const firstDecided = got.findIndex((h, k) => k >= at && h !== null);
    const nullsBefore = got.slice(0, at).every((h) => h === null);
    const after = firstDecided >= 0 && got.slice(firstDecided).every((h, i) => h !== null && h.voice === ref[firstDecided + i].voice && h.p === ref[firstDecided + i].p);
    const waited = Math.min(at * 2.5, MAX_BACKLOG_FRAMES);
    const catchHops = firstDecided - at;
    check(`ready at hop ${at}: null before; decisions after catching up equal the run from the start`, nullsBefore && after,
      `first decision at hop ${firstDecided}`);
    check(`ready at hop ${at}: at most ${CATCHUP_FRAMES} frames scored per hop; caught up in ${catchHops + 1} hop(s)`,
      Math.max(...calls) <= CATCHUP_FRAMES && catchHops <= Math.ceil(waited / (CATCHUP_FRAMES - 3)),
      `max ${Math.max(...calls)} frames per call`);
    if (at * 2.5 > MAX_BACKLOG_FRAMES + 10) check(`ready at hop ${at}: the backlog was capped at ${MAX_BACKLOG_FRAMES} frames (flagged)`, det.truncated);
  }
}
{
  const det = createVoiceDetector();
  det.pushAudio(new Float32Array(400 + 160 * (MAX_BACKLOG_FRAMES + 10)));
  check("backlog capped while the model is missing (flagged; every frame still counted)",
    det.truncated && det.backlog === MAX_BACKLOG_FRAMES && det.frames === MAX_BACKLOG_FRAMES + 11);
  check("the cap holds at least the model's 152-frame memory + 5-frame smoothing + 2 s hangover",
    MAX_BACKLOG_FRAMES >= 152 + 5 + FIRERED_GATE.hangoverMs / 10 + 3);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

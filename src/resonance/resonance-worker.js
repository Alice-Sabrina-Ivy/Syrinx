// resonance-worker.js — the Dashboard's resonance cue (production, always on
// while listening; 2026-10-07).
//
// A capture consumer like the DSP / pitch workers. It runs ONLY the resonance
// lab's spectral-warp finalist (vtln_warp, src/resonance-lab/vtln.js) through
// the lab engine in "frames" mode: the engine does not re-run the pitch chain,
// it takes the pitch worker's POSTED decisions, relayed by the main thread as
// the same `pitch-hint` object the ML worker gets (bit-identical to the lab's
// internal replica: tests/resonance/vtln-production-parity-test.js). The
// readout is gated by the perceived-voice utterance gate so held vowels and
// notes don't count (resonanceCue.js). No ONNX, no le / fv / pnml.
//
// Protocol:
//   main -> worker: { type: "init", sampleRate, assetBase, diag? }
//                   { type: "audioPort", port }                    capture chunks
//                   { type: "pitch-hint", voiced, pitch, contextTime }
//   worker -> main: { type: "status", status: "loading"|"ready"|"error"|"overloaded", message? }
//                   { type: "state", u, raw, n, fill, voicedS, clamp, verdict, startU,
//                     framesDropped, perf? }                every 200 ms of audio
//
// Overload guard: an EMA (τ ≈ 10 s of audio) of processing ms per audio
// second; above 500 ms/s the worker stops feeding audio to vtln, posts
// "overloaded" and the cue row shows "unavailable on this device".
// perf.msPerAudioS is posted when init.diag is set.
// measurements/resonance-cue-production-path-2026-10-07.md

import { createLabEngine } from "../resonance-lab/lab-engine.js";
import { createResonanceCue } from "./resonanceCue.js";

const POST_EVERY_S = 0.2; // of audio (deterministic: the audio clock, not wall time)
const OVERLOAD_MS_PER_S = 500;
const EMA_TAU_S = 10;

let engine = null;
let cue = null;
let sampleRate = 48000;
let diag = false;
let state = "idle"; // idle | loading | ready | error | overloaded
let sinceLastPostS = 0;
let emaMsPerS = null;
let totalMs = 0;
let totalAudioS = 0;
// Busy ms spent on relayed pitch frames since the last chunk (most of the
// vtln work runs there, when a frame resolves grid time); folded into the
// next chunk's rate so the overload EMA sees all of it.
let pendingFrameMs = 0;
// Pitch hints that arrive before the assets have loaded are dropped; chunks
// too (the engine starts with the first chunk it sees, and a frame whose
// chunk it never saw is dropped and counted).

function status(s, message) {
  state = s;
  self.postMessage({ type: "status", status: s, ...(message ? { message } : {}) });
}

async function loadJson(base, name) {
  const r = await fetch(`${base}resonance-lab/${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

function post(force = false) {
  if (!force && sinceLastPostS < POST_EVERY_S) return;
  sinceLastPostS = 0;
  const s = cue.snapshot();
  const e = engine.snapshot();
  self.postMessage({
    type: "state",
    u: s.u,
    raw: s.raw,
    n: s.n,
    fill: s.fill,
    voicedS: s.voicedS,
    clamp: s.clamp,
    verdict: s.verdict,
    startU: s.startU,
    framesDropped: e.framesDropped,
    ...(diag ? {
      perf: {
        msPerAudioS: emaMsPerS,
        meanMsPerAudioS: totalAudioS > 0 ? totalMs / totalAudioS : null,
        audioS: totalAudioS,
        binsAdmitted: s.binsAdmitted,
        binsDropped: s.binsDropped,
        gridForcedUnvoiced: e.gridForcedUnvoiced,
      },
    } : {}),
  });
}

function onChunk(msg) {
  if (!engine || state !== "ready" || !msg?.buffer) return;
  const x = new Float32Array(msg.buffer);
  if (!x.length) return;
  const ct = typeof msg.contextTime === "number" && Number.isFinite(msg.contextTime) ? msg.contextTime : null;
  const t0 = performance.now();
  cue.noteChunk(ct);
  engine.pushChunk(x, null, ct);
  const ms = performance.now() - t0 + pendingFrameMs;
  pendingFrameMs = 0;
  const audioS = x.length / sampleRate;
  totalMs += ms;
  totalAudioS += audioS;
  sinceLastPostS += audioS;
  const rate = ms / audioS;
  const a = 1 - Math.exp(-audioS / EMA_TAU_S);
  emaMsPerS = emaMsPerS === null ? rate : emaMsPerS + a * (rate - emaMsPerS);
  // Judge only after a few seconds of audio (start-up JIT is slow).
  if (totalAudioS > 3 && emaMsPerS > OVERLOAD_MS_PER_S) {
    status("overloaded", `${Math.round(emaMsPerS)} ms per audio second`);
    post(true);
    return;
  }
  post();
}

function onPitchHint(msg) {
  if (!engine || state !== "ready") return;
  const ct = msg.contextTime;
  if (typeof ct !== "number" || !Number.isFinite(ct)) return;
  cue.notePitchHint({ voiced: !!msg.voiced, pitch: msg.pitch, contextTime: ct });
  const t0 = performance.now();
  engine.pushPitchFrame(ct, msg.voiced ? msg.pitch : 0);
  pendingFrameMs += performance.now() - t0;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg?.type) return;
  if (msg.type === "init") {
    sampleRate = msg.sampleRate;
    diag = msg.diag === true;
    engine = null;
    cue = null;
    sinceLastPostS = 0;
    emaMsPerS = null;
    totalMs = 0;
    totalAudioS = 0;
    pendingFrameMs = 0;
    status("loading");
    try {
      const base = msg.assetBase ?? "/";
      const [vtln, reference] = await Promise.all([loadJson(base, "vtln_warp.json"), loadJson(base, "reference.json")]);
      cue = createResonanceCue({ reference });
      engine = createLabEngine({
        sampleRate,
        models: { vtln },
        reference,
        pitchSource: "frames",
        onStamped: (name, te, stampS, value) => { if (name === "vtln") cue.onStamped(te, stampS, value); },
      });
      status("ready");
    } catch (err) {
      status("error", String(err?.message || err));
    }
  } else if (msg.type === "audioPort") {
    msg.port.onmessage = (ev) => {
      try { onChunk(ev.data); } catch (err) { status("error", String(err?.message || err)); }
    };
  } else if (msg.type === "pitch-hint") {
    try { onPitchHint(msg); } catch (err) { status("error", String(err?.message || err)); }
  }
};

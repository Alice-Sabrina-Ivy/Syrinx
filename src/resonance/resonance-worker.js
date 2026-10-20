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
//   worker -> main: { type: "status", status: "loading"|"ready"|"error"|"overloaded", message?,
//                     recovering?, reason? }
//                   ("overloaded" is a pause: after a back-off the worker posts
//                    "ready" again with a fresh engine. "error" after an
//                    exception while running is a pause too: after
//                    ERROR_BACKOFF_S of audio a fresh engine + "ready", at most
//                    MAX_ERROR_RESTARTS times per session, and that "error"
//                    carries recovering: true; an asset-load failure stays
//                    "error" and carries reason: "load" — a page reload is
//                    what fixes it)
//                   { type: "state", u, raw, n, fill, voicedS, clamp, verdict, startU,
//                     startProgress, sinceResumeS, framesDropped, narrowband, perf? }    every 200 ms of audio
//                   narrowband = { on, decided, f, n }: the phone-quality audio
//                   detector (narrowband.js, run on every voiced 10 ms grid
//                   frame of this engine's 16 kHz ring). While on, the cue
//                   strip pauses the resonance row and the cue drops its bins
//                   (resonanceCue.js noteNarrowband). A fresh engine (after an
//                   overload or error back-off) starts a fresh detector.
//                   measurements/resonance-narrowband-2026-10-19.md
//
// Overload guard (overloadGuard.js): the worker's busy ms per audio second
// over a trailing 10 s of audio, not counting the first 3 s (start-up JIT);
// above 500 ms/s it posts "overloaded" (the row shows "paused — device
// busy"), skips vtln work for a back-off (20 s of audio, doubling on each
// repeat, ≤ 160 s), then starts a fresh engine + cue and posts "ready" again.
// perf.msPerAudioS (that trailing mean) is posted when init.diag is set.
// measurements/resonance-cue-production-path-2026-10-07.md

import { createLabEngine } from "../resonance-lab/lab-engine.js";
import { createResonanceCue } from "./resonanceCue.js";
import { createOverloadGuard } from "./overloadGuard.js";
import { createNarrowbandDetector } from "./narrowband.js";

const POST_EVERY_S = 0.2; // of audio (deterministic: the audio clock, not wall time)
// Recovery after an exception while running (2026-10-19 review S-2: one
// caught exception used to switch the cue off for the rest of the session).
// Error handling only: the engine and cue code paths are unchanged.
const ERROR_BACKOFF_S = 2; // of audio, then a fresh engine
const MAX_ERROR_RESTARTS = 3; // per session; after that the error stays

let engine = null;
let cue = null;
let narrowband = null;
let sampleRate = 48000;
let diag = false;
let state = "idle"; // idle | loading | ready | error | overloaded
let sinceLastPostS = 0;
let guard = null;
let vtlnModel = null;
let referenceJson = null;
let totalMs = 0;
let totalAudioS = 0;
// Busy ms spent on relayed pitch frames since the last chunk (most of the
// vtln work runs there, when a frame resolves grid time); folded into the
// next chunk's rate so the overload EMA sees all of it.
let pendingFrameMs = 0;
let errorRestarts = 0;
let errorBackoffS = 0; // audio seconds since the last runtime error
// Pitch hints that arrive before the assets have loaded are dropped; chunks
// too (the engine starts with the first chunk it sees, and a frame whose
// chunk it never saw is dropped and counted).

function status(s, message, extra = null) {
  state = s;
  self.postMessage({ type: "status", status: s, ...(message ? { message } : {}), ...extra });
}

// A caught exception while running: drop the engine's state and, unless it
// keeps happening, start a fresh engine after ERROR_BACKOFF_S of audio.
function runtimeError(err) {
  const recover = errorRestarts < MAX_ERROR_RESTARTS;
  errorBackoffS = 0;
  status("error", String(err?.message || err), recover ? { recovering: true } : null);
  if (!recover) engine = null; // stays off for this session
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
    startProgress: s.startProgress,
    sinceResumeS: s.sinceResumeS,
    framesDropped: e.framesDropped,
    narrowband: { ...narrowband.state },
    ...(diag ? {
      perf: {
        msPerAudioS: guard?.rate() ?? null,
        overloads: guard?.overloads() ?? 0,
        meanMsPerAudioS: totalAudioS > 0 ? totalMs / totalAudioS : null,
        audioS: totalAudioS,
        binsAdmitted: s.binsAdmitted,
        binsDropped: s.binsDropped,
        gridForcedUnvoiced: e.gridForcedUnvoiced,
      },
    } : {}),
  });
}

function startEngine() {
  cue = createResonanceCue({ reference: referenceJson });
  const nb = createNarrowbandDetector();
  narrowband = nb;
  const c16 = cue;
  engine = createLabEngine({
    sampleRate,
    models: { vtln: vtlnModel },
    reference: referenceJson,
    pitchSource: "frames",
    onStamped: (name, te, stampS, value) => { if (name === "vtln") cue.onStamped(te, stampS, value); },
    // Voiced grid frames only (the measured harness's input); the cue hears
    // the decision before the bins of the same step are stamped.
    onGridFrame: (j, f0, ring16) => {
      if (!(f0 > 0)) return;
      const st = nb.frame((i) => ring16.at(i), Math.round((0.005 + 0.01 * j) * 16000));
      c16.noteNarrowband(st.on);
    },
  });
  pendingFrameMs = 0;
}

function onChunk(msg) {
  if (!engine || !msg?.buffer) return;
  if (state === "error") {
    // Recovering from a runtime error (engine is null once it gave up).
    const n = new Float32Array(msg.buffer).length;
    errorBackoffS += n / sampleRate;
    if (errorBackoffS >= ERROR_BACKOFF_S) { errorRestarts++; startEngine(); status("ready"); }
    return;
  }
  if (state !== "ready" && state !== "overloaded") return;
  const x = new Float32Array(msg.buffer);
  if (!x.length) return;
  const audioS = x.length / sampleRate;
  if (state === "overloaded") {
    // Backing off: no vtln work; resume with a fresh engine when it ends.
    if (guard.add(0, audioS) === "resume") { startEngine(); status("ready"); }
    return;
  }
  const ct = typeof msg.contextTime === "number" && Number.isFinite(msg.contextTime) ? msg.contextTime : null;
  const t0 = performance.now();
  cue.noteChunk(ct);
  engine.pushChunk(x, null, ct);
  const ms = performance.now() - t0 + pendingFrameMs;
  pendingFrameMs = 0;
  totalMs += ms;
  totalAudioS += audioS;
  sinceLastPostS += audioS;
  if (guard.add(ms, audioS) === "overloaded") {
    post(true);
    status("overloaded", `${Math.round(guard.rate())} ms per audio second`);
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
    guard = createOverloadGuard();
    totalMs = 0;
    totalAudioS = 0;
    pendingFrameMs = 0;
    errorRestarts = 0;
    errorBackoffS = 0;
    status("loading");
    try {
      const base = msg.assetBase ?? "/";
      const [vtln, reference] = await Promise.all([loadJson(base, "vtln_warp.json"), loadJson(base, "reference.json")]);
      vtlnModel = vtln;
      referenceJson = reference;
      startEngine();
      status("ready");
    } catch (err) {
      engine = null; // assets missing: no recovery
      status("error", String(err?.message || err), { reason: "load" });
    }
  } else if (msg.type === "audioPort") {
    msg.port.onmessage = (ev) => {
      try { onChunk(ev.data); } catch (err) { runtimeError(err); }
    };
  } else if (msg.type === "pitch-hint") {
    try { onPitchHint(msg); } catch (err) { runtimeError(err); }
  }
};

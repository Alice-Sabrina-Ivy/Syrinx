// lab-engine.js — the resonance lab's streaming core (pure; runs in the lab
// worker and, unchanged, in the Node parity tests).
//
// Input: capture chunks at the capture rate (25 ms each in the app).
// Inside:
//   * pitch — an exact replica of the production pitch worker's path
//     (streaming linear resampler -> persistent-peak notch -> 80 ms buffer
//     -> Boersma-AC candidates -> L=2 path tracker -> notch veto + harmonic
//     voicing guard), each decoded frame attributed to the centre of its
//     80 ms buffer (= prodf0.mjs, the critic's production-F0 emulation).
//     Decoded frames are mapped onto the benchmark's 10 ms grid
//     (t_j = 0.005 + 0.01 j) by nearest frame within 12.5 ms.
//     (Tests may instead inject an external 10 ms F0 track.)
//   * a 16 kHz analysis stream (anti-aliased sinc resampler) for le / vtln /
//     pnml, and the capture-rate stream for fv (the app's own decimator);
//   * the four finalists, driven frame by frame once the pitch decision for
//     a frame is known (~90 ms behind the audio, the production decode lag);
//   * per-finalist sliding 5 s-voiced readouts (readout.js).
//
// Production use (2026-10-07, the Dashboard's resonance cue): with
// `pitchSource: "frames"` the engine does NOT run its own pitch replica.
// The resonance worker (src/resonance/resonance-worker.js) relays the
// pitch worker's POSTED decisions through pushPitchFrame(contextTime, f0);
// the engine only counts 16 kHz samples with the same streaming linear
// resampler so each posted frame lands at exactly the time the replica
// would have given it (n16After / 16000 - 0.04 of the chunk whose
// contextTime it carries). Values are bit-identical to the internal path
// (tests/resonance/vtln-production-parity-test.js); relay latency only
// delays when bins appear. Known edge, not handled: the replica skips a
// chunk whose resampled output is empty while the pitch worker still
// evaluates its unchanged buffer — only possible with chunks of a few
// input samples, never with the 5-50 ms chunks the capture paths emit.
// Lab behaviour is unchanged (pitchSource defaults to "internal").

import { createBoersmaAC, createPathTracker, createHarmonicVoicingGuard, BOERSMA_FRAME_LENGTH_16K } from "../dsp/boersma-ac.js";
import { createNoiseNotch, isNearNotch } from "../dsp/noise-notch.js";
import { PITCH_DISPLAY_RANGE } from "../utils/constants.js";
import { createStreamingResampler } from "../ml/audio-utils.js";
import { createSampleRing } from "./ring.js";
import { createSincResampler } from "./sinc-resampler.js";
import { createLe } from "./le.js";
import { createVtln } from "./vtln.js";
import { createFv } from "./fv.js";
import { createPnml, PNML_WIN } from "./pnml.js";
import { createReadout } from "./readout.js";

const SR16 = 16000;
const GRID_CAP = 1 << 13; // 82 s of 10 ms grid frames kept (only ~1 s is ever looked back)
const GRID_MASK = GRID_CAP - 1;
const FRAME_LENGTH = BOERSMA_FRAME_LENGTH_16K;

export const FINALISTS = ["vtln", "pnml", "le", "fv"];
const AGG = { vtln: "median", pnml: "median", le: "mean", fv: "median" };

/**
 * opts:
 *   sampleRate      capture rate of pushChunk() audio
 *   models          { le, vtln, fv, pnmlHead } (any may be omitted to disable that finalist)
 *   reference       { vtln: {menMedian, womenMedian}, ... } (readout units)
 *   externalF0      optional Float32Array/Array: 10 ms grid F0 (test mode; disables the tracker)
 *   pnmlMaxPending  inference requests allowed in flight before new windows are dropped
 *   onBin           optional (name, te, value) hook for every finalist output (tests)
 *   pitchSource     "internal" (default: the production pitch replica) | "frames"
 *                   (production: pitch decisions arrive through pushPitchFrame)
 *   onStamped       optional (name, te, voicedStampS, value) hook, called where a
 *                   bin is added to the engine's readout (same arguments), so a
 *                   caller can run its own gated readout
 */
export function createLabEngine(opts) {
  const { sampleRate, models, reference, externalF0 = null, pnmlMaxPending = 2, horizonS = 5 } = opts;
  const onBinHook = opts.onBin ?? null;
  const onStampedHook = opts.onStamped ?? null;
  const framesMode = opts.pitchSource === "frames";
  if (framesMode && externalF0) throw new Error("pitchSource 'frames' and externalF0 are exclusive");
  const ring16 = createSampleRing(1 << 15);
  // capture-rate ring (fv only). Tests pass nativeFloat64 to keep a float64 bench upsample exact.
  const ringN = models.fv
    ? createSampleRing(1 << Math.ceil(Math.log2(sampleRate * 3)), opts.nativeFloat64 ? Float64Array : Float32Array)
    : null;
  const analysisResample = createSincResampler(sampleRate, SR16);

  // ---- "frames" mode: contextTime -> 16 kHz sample count after that chunk ----
  const chunkN16 = new Map();
  const chunkOrder = [];      // [contextTime, n16After] oldest first (trim)
  const FRAME_KEEP_S = 4;     // chunks older than this can't be matched
  const STALL_S = 1.5;        // unresolved grid time this far behind the ring end -> unvoiced
  let framesDropped = 0;
  let gridForcedUnvoiced = 0;

  // ---- production pitch path replica ----
  const pitchResample = createStreamingResampler(sampleRate, SR16);
  const det = createBoersmaAC(SR16, FRAME_LENGTH);
  const tracker = createPathTracker();
  const notch = createNoiseNotch(SR16);
  const guard = createHarmonicVoicingGuard();
  const pbuf = new Float32Array(FRAME_LENGTH);
  let pfill = 0;
  let n16pitch = 0;
  let delayLine = [];
  let times = [];
  const decoded = []; // [{t, f0}] ascending, trimmed
  let decK = 0;       // nearest-frame pointer into `decoded`

  // ---- 10 ms grid ----
  const gridF0 = new Float32Array(GRID_CAP);
  const cum = new Int32Array(GRID_CAP); // voiced frames with index <= j
  let nextGrid = 0;
  let finished = false;
  let lastF0 = 0;

  // ---- finalists + readouts ----
  const readouts = {};
  const pending = {}; // name -> [{te, s}] awaiting a voiced-time stamp
  const latest = {};  // name -> last raw bin value (diagnostic)
  const enabled = {};
  function binSink(name) {
    pending[name] = [];
    return (te, s) => {
      pending[name].push({ te, s });
      latest[name] = s;
      if (onBinHook) onBinHook(name, te, s);
    };
  }
  for (const name of FINALISTS) {
    const on = name === "pnml" ? !!models.pnmlHead : !!models[name];
    enabled[name] = on;
    if (on && reference?.[name]) readouts[name] = createReadout({ agg: AGG[name], horizonS, ref: reference[name] });
  }
  const le = enabled.le ? createLe(models.le, binSink("le")) : null;
  const vtln = enabled.vtln ? createVtln(models.vtln, binSink("vtln")) : null;
  const fv = enabled.fv ? createFv(models.fv, sampleRate, binSink("fv")) : null;
  const pnmlSink = enabled.pnml ? binSink("pnml") : null;
  const pnml = enabled.pnml ? createPnml(models.pnmlHead, (te, ema) => pnmlSink(te, ema)) : null;
  const pnmlQueue = []; // ordered {k, state: "gated"|"pending"|"ready"|"dropped", raw, out}
  let pnmlInFlight = 0;
  let pnmlDropped = 0;
  let pnmlScored = 0;
  let lastB2 = null;

  // ---------------------------------------------------------------- pitch
  function pitchStep(native) {
    const x16 = pitchResample(native);
    if (!x16.length) return;
    const inc = notch.process(x16);
    const k = inc.length;
    if (k >= FRAME_LENGTH) { pbuf.set(inc.subarray(k - FRAME_LENGTH)); pfill = FRAME_LENGTH; }
    else { pbuf.copyWithin(0, k, FRAME_LENGTH); pbuf.set(inc, FRAME_LENGTH - k); pfill = Math.min(FRAME_LENGTH, pfill + k); }
    n16pitch += k;
    if (pfill < FRAME_LENGTH) return;
    const c = det.candidates(pbuf);
    delayLine.push(Float32Array.from(pbuf));
    if (delayLine.length > tracker.config.lookback + 1) delayLine.shift();
    times.push(n16pitch / SR16 - 0.04);
    const d = tracker.emit(c);
    if (times.length <= tracker.config.lookback) return;
    const t = times.shift();
    let v = d;
    // Same order as src/dsp/pitch-worker.js processChunk: ghost veto against
    // the notch's lines (with their wobble), above-display-range decodes
    // posted unvoiced BEFORE the harmonic guard, then the guard.
    if (v > 0 && isNearNotch(v, notch.activeLines())) v = null;
    if (v > PITCH_DISPLAY_RANGE.high) v = null;
    if (v > 0 && !guard.check(delayLine[0], v, SR16)) v = null;
    decoded.push({ t, f0: v > 0 ? v : 0 });
  }

  function gridF0At(j) {
    if (externalF0) return j < externalF0.length ? +externalF0[j] || 0 : null;
    const tj = 0.005 + 0.01 * j;
    if (!decoded.length || decoded[decoded.length - 1].t < tj) {
      // Relay stalled (frames mode): never let vtln read 16 kHz samples the
      // 2.05 s ring is about to overwrite — resolve the frame as unvoiced.
      if (framesMode && !finished && ring16.end / SR16 - tj > STALL_S) { gridForcedUnvoiced++; return 0; }
      return null; // not decided yet
    }
    if (decK >= decoded.length) decK = decoded.length - 1;
    while (decK + 1 < decoded.length && Math.abs(decoded[decK + 1].t - tj) <= Math.abs(decoded[decK].t - tj)) decK++;
    const f = Math.abs(decoded[decK].t - tj) <= 0.0125 ? decoded[decK].f0 : 0;
    // keep the list short: everything before the pointer is no longer needed
    if (decK > 64) { decoded.splice(0, decK - 1); decK = 1; }
    return f;
  }

  // voiced frames with t_j <= t
  function cumAt(t) {
    const j = Math.floor((t - 0.005) / 0.01 + 1e-9);
    if (j < 0) return 0;
    const jj = Math.min(j, nextGrid - 1);
    return jj < 0 ? 0 : cum[jj & GRID_MASK];
  }
  // last grid time whose voicing is known
  const resolvedT = () => (finished ? Infinity : 0.005 + 0.01 * (nextGrid - 1));

  function resolveGrid() {
    for (;;) {
      const j = nextGrid;
      const tj = 0.005 + 0.01 * j;
      const c = Math.round(tj * SR16);
      if (!finished && ring16.end < c + 520) return; // le needs +256, CheapTrick <= +512
      const f0 = gridF0At(j);
      if (f0 === null) return;
      const voiced = f0 > 0;
      gridF0[j & GRID_MASK] = f0;
      cum[j & GRID_MASK] = (j > 0 ? cum[(j - 1) & GRID_MASK] : 0) + (voiced ? 1 : 0);
      nextGrid = j + 1;
      if (voiced) lastF0 = f0;
      if (le) { le.advance(tj); if (voiced && c < ring16.end) le.frame(ring16, c); }
      if (vtln) {
        vtln.advance(tj);
        if (voiced && vtln.eligible(tj, finished ? ring16.end : Infinity)) vtln.frame(ring16, tj, f0);
      }
    }
  }

  function voicedAtGrid(i) {
    if (i < nextGrid) return gridF0[i & GRID_MASK] > 0;
    if (externalF0 && i >= externalF0.length && nextGrid >= externalF0.length) return false;
    return null;
  }

  function processFv() {
    if (!fv) return;
    for (;;) {
      const k = fv.nextFrame;
      const s0 = k * fv.hop;
      if (ringN.end < s0 + fv.win) return;
      const tc = fv.frameEnd(k) - 0.025;
      const i = Math.floor((tc - 0.005) / 0.01 + 0.5 + 1e-6);
      const v = voicedAtGrid(i);
      if (v === null) return;
      fv.frame(ringN, k, v);
    }
  }

  function schedulePnml(tailEndSample) {
    if (!pnml) return;
    for (;;) {
      const k = pnml.nextK;
      const te = pnml.windowEndTime(k);
      const endS = pnml.windowEndSample(k);
      if (finished) { if (endS > tailEndSample) return; }
      else if (ring16.end < endS || resolvedT() < te + 0.006) return;
      pnml.markScheduled(k);
      const voiced = cumAt(te) - cumAt(te - 0.5) > 0;
      if (!voiced) { pnmlQueue.push({ k, state: "gated" }); continue; }
      if (pnmlInFlight >= pnmlMaxPending) { pnmlQueue.push({ k, state: "dropped" }); pnmlDropped++; continue; }
      const win = new Float32Array(PNML_WIN);
      pnml.fillWindow(ring16, k, win);
      pnmlQueue.push({ k, state: "pending", win });
      pnmlInFlight++;
    }
  }

  function drainPnml() {
    while (pnmlQueue.length && pnmlQueue[0].state !== "pending" && pnmlQueue[0].state !== "requested") {
      const q = pnmlQueue.shift();
      if (q.state === "gated") pnml.result(q.k, null);
      else if (q.state === "ready") pnml.result(q.k, q.raw);
      // "dropped": the worker was busy — skipped without touching the EMA
    }
  }

  function stampPending() {
    const rt = resolvedT();
    for (const name of Object.keys(pending)) {
      const q = pending[name];
      let i = 0;
      while (i < q.length && q[i].te <= rt) {
        const { te, s } = q[i];
        if (readouts[name]) readouts[name].add(cumAt(te) * 0.01, s);
        if (onStampedHook) onStampedHook(name, te, cumAt(te) * 0.01, s);
        i++;
      }
      if (i) q.splice(0, i);
    }
  }

  function step() {
    resolveGrid();
    processFv();
    schedulePnml(Infinity);
    drainPnml();
    stampPending();
  }

  return {
    sampleRate,
    /**
     * One capture chunk. `x16` (tests): a pre-made 16 kHz chunk for the analysis stream.
     * `contextTime` ("frames" mode): the chunk's capture time, as the pitch worker
     * will post it with the frame this chunk completes.
     */
    pushChunk(native, x16 = null, contextTime = null) {
      if (ringN) ringN.push(native);
      ring16.push(x16 ?? analysisResample(native));
      if (framesMode) {
        // Same resampler as the pitch worker, only to count its output.
        n16pitch += pitchResample(native).length;
        if (contextTime !== null) {
          chunkN16.set(contextTime, n16pitch);
          chunkOrder.push([contextTime, n16pitch]);
          while (chunkOrder.length && (n16pitch - chunkOrder[0][1]) / SR16 > FRAME_KEEP_S) {
            const [ct, n] = chunkOrder.shift();
            if (chunkN16.get(ct) === n) chunkN16.delete(ct);
          }
        }
      } else if (!externalF0) {
        pitchStep(native);
      }
      step();
    },
    /**
     * "frames" mode: one posted pitch-worker decision, in posting order.
     * f0OrNull: the posted pitch (null / 0 = unvoiced). Returns false when the
     * frame's chunk is unknown (never seen, or older than 4 s) — dropped, counted.
     */
    pushPitchFrame(contextTime, f0OrNull) {
      if (!framesMode) return false;
      const n = chunkN16.get(contextTime);
      if (n === undefined) { framesDropped++; return false; }
      const f0 = f0OrNull > 0 ? f0OrNull : 0;
      decoded.push({ t: n / SR16 - 0.04, f0 });
      step();
      return true;
    },
    /** Next window awaiting inference: {k, win} (marks it requested), or null. */
    takePnmlRequest() {
      const q = pnmlQueue.find((x) => x.state === "pending");
      if (!q) return null;
      q.state = "requested";
      const win = q.win;
      q.win = null;
      return { k: q.k, win };
    },
    /** Inference result for window k: the 194-wide patched-model output, or null on failure. */
    pnmlDone(k, out194) {
      const q = pnmlQueue.find((x) => x.k === k);
      if (!q) return;
      pnmlInFlight = Math.max(0, pnmlInFlight - 1);
      if (out194) {
        q.state = "ready";
        q.raw = pnml.headScore(out194);
        lastB2 = out194[1] - out194[0];
        pnmlScored++;
      } else {
        q.state = "dropped";
      }
      drainPnml();
      stampPending();
    },
    /** Offline end of stream (tests): flush everything as the prototypes do at the clip end. */
    finish() {
      finished = true;
      ring16.finish();
      if (ringN) ringN.finish();
      resolveGrid();
      processFv();
      const durS = ring16.end / SR16;
      if (le) le.finish(durS);
      if (vtln) vtln.finish(durS);
      if (fv) fv.finish(ringN.end / sampleRate);
      schedulePnml(ring16.end + 8000); // prototype pads 0.5 s of zeros after the clip
      drainPnml();
      stampPending();
    },
    hasPnmlWork: () => pnmlQueue.some((x) => x.state === "pending" || x.state === "requested"),
    snapshot() {
      const out = {};
      for (const name of FINALISTS) {
        out[name] = enabled[name] && readouts[name] ? { ...readouts[name].snapshot(), last: latest[name] ?? null } : null;
      }
      return {
        t: ring16.end / SR16,
        voicedS: (nextGrid ? cum[(nextGrid - 1) & GRID_MASK] : 0) * 0.01,
        pitch: nextGrid && gridF0[(nextGrid - 1) & GRID_MASK] > 0 ? gridF0[(nextGrid - 1) & GRID_MASK] : null,
        lastPitch: lastF0 || null,
        lagS: ring16.end / SR16 - resolvedT(),
        pnml: { scored: pnmlScored, dropped: pnmlDropped, inFlight: pnmlInFlight, deployedLogit: lastB2 },
        framesDropped,
        gridForcedUnvoiced,
        finalists: out,
      };
    },
    resetReadouts() { for (const r of Object.values(readouts)) r.reset(); },
    /** Test hook: the resolved 10 ms grid F0 so far. */
    gridTrack() {
      const n = nextGrid;
      const out = new Float32Array(n);
      for (let j = Math.max(0, n - GRID_CAP); j < n; j++) out[j] = gridF0[j & GRID_MASK];
      return out;
    },
  };
}

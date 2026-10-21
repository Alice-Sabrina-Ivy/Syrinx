// useAudioPipeline.js — Hook that connects: mic → AudioWorklet → DSP Worker → React state
// Handles mic permission, AudioContext setup, result smoothing, and silence gating.
// Exposes history refs for canvas-based visualizations.

import { useState, useRef, useCallback, useEffect } from "react";
import { hzToNote } from "../utils/pitchUtils";
import {
  SILENCE_HOLD_MS,
  PITCH_TRACE_SECONDS,
  RESONANCE_TRACE_SECONDS,
} from "../utils/constants";
import { createHeardAsAggregator } from "../ml/heard-as";
import { createPitchOnlyWarning } from "../ml/pitch-only-warning";
import {
  pushAndMedianPitch,
  PITCH_SMOOTH_LEN,
  createSmoothingGapTracker,
  smoothingBufferFor,
} from "./pitchSmoothing";
import { createGateState, evaluateFrameGate } from "./pitchGate";
import { createPaintGate, EXCURSION_SEMI } from "./pitchPaintGate";
import { createSteadinessTracker } from "./steadiness";
import { pitchLevelAt } from "../utils/pitchLevel";
import { createCaptureSource } from "./captureSource";
import {
  DIAG_ENABLED,
  DIAG_SR_OVERRIDE,
  DIAG_LATENCY_HINT,
  DIAG_NO_LATENCY_CONSTRAINT,
  DIAG_CHUNK_MS_OVERRIDE,
  DIAG_LATENCY_EXACT,
  DIAG_CAPTURE_KIND,
  setAudioInfo,
  setAudioCtxSample,
  pushFrame,
  setCaptureStatus,
  setWorkerStatus,
  pushError,
  pushMlInference,
  setMlModel,
  pushPitchInference,
  setPitchModel,
  setVoiceGate,
  setResonancePerf,
  setResonanceStatus,
  setMlWorkerAlive,
} from "../diag/diag";
import { isResonanceLabRequested, onResonanceLabRequested } from "../resonance-lab/labRequest";
import { setVoicePreviewCapture, voicePreviewPitchTap } from "../voice-preview/bridge";
import { FIRERED_MODEL, fireredModelSource } from "../dsp/firered-vad";

// Silence-gate thresholds (SILENCE_THRESHOLD_DB, CONFIDENCE_THRESHOLD,
// SILENCE_DEBOUNCE_FRAMES), pitch staleness, and the bounded pitch-hold
// window live in pitchGate.js — extracted 2026-06-09 so the frame-level
// gate decisions are unit-testable in plain Node (same pattern as
// pitchSmoothing.js). See that module for the AND-logic rationale and
// the corpus measurements behind the constants.
const FORMANT_SMOOTH_LEN = 7;
const FORMANT_OUTLIER_HZ = 500; // max plausible frame-to-frame formant jump

// Display-layer hysteresis (2026-06-10, live-use reports: pitch spikes
// at utterance boundaries, octave-class harmonic excursions painting as
// connected spike lines, and the pitch view strobing grey when noise
// flaps the voicing decision).
//
// Painting "is this pitch on the established level, and confirmed" lives
// in pitchPaintGate.js (onset confirmation + established-level excursion
// break with sustained-new-level accept) — extracted for unit testing.
// It replaced an earlier consecutive-delta jump break that the display
// median's octave ramps defeated; see that module's header + the
// excursion measurement for the data.
//
// VOICED_FALL_FRAMES: the displayed voiced state drops to the inactive
// (grey) style only after this many consecutive pitchless frames
// (~400 ms); in between, the display shows the dim "holding" style. The
// 300 ms CSS opacity transition then never strobes. Session recording is
// NOT hysteresis'd — recorded frames keep the truthful per-frame flag.
const VOICED_FALL_FRAMES = 16;

// Steadiness readout when there is no reading (see steadiness.js).
const NO_STEADINESS = { value: null, held: false };

// Voice gate (FireRedVAD; noise-detector try-out 2026-10-20, merged into
// cue-strip 2026-10-21; measurements/noise-detector-tryout-2026-10-20.md).
// The pitch worker runs FireRedVAD on its 16 kHz stream and tags each pitch
// message with `vad: { p, voice }` (src/dsp/firered-vad.js). While the
// setting is on and the detector says "no voice":
//   - the pitch DISPLAY shows nothing: the trace gets a gap instead of its
//     point, the Hz / note readout and the steadiness readout show "—", and
//     the pitch-display voiced flags (pitchVoiced / pitchHolding: the trace
//     header, the cue strip's pitch AND resonance rows, the listening status)
//     read as unvoiced — so noise the pitch chain voices leaves the resonance
//     row idle, not "keep talking…" (cueStripModel.js cueRowStates; user
//     decision 2026-10-21, measurements/voice-gate-resonance-row-2026-10-21.md). A mask on the unchanged chain — the smoothing, paint gate,
//     silence gate and hold run exactly as without it, which is the veto the
//     2026-10-20 screen scored ("a painted hop the detector calls no-voice is
//     vetoed");
//   - the HNR readout shows "—" (display only: the DSP worker computes HNR as
//     before and recorded frames keep it; user decision 2026-10-21), except in
//     the 5 s silence hold, which keeps the last HNR the readout SHOWED
//     (lastVoicedRef shownHnr — never a value the gate hid) like the dim
//     pitch readout — "—" there only when the gate hid painted pitch after
//     it (gateHidPaintRef; user decision 2026-10-21);
//   - the resonance worker's pitch hint says unvoiced (pitch / contextTime
//     unchanged), so noise the pitch worker voices does not become resonance
//     readings (the measured variant of
//     measurements/noise-detector-tryout-resonance-2026-10-21.md: 73 % less
//     noise-only position time, speech unchanged; built at 73 % against an
//     80 % bar by user decision 2026-10-21).
// Everything else keeps the raw values: the DSP / ML pitch hints, the
// "Likely heard as" panel, the pitch-only warning, formants, the raw voiced /
// holding flags in the state, and the recorded voiced / f0 / hnr that
// session stats use. Without a decision (detector loading / unavailable /
// off / switched off as too slow) nothing is gated. Recorded frames carry
// the decision in `voiceGate` ("voice" | "hidden" | "novoice", absent without
// a decision) and `painted` is what the live trace drew.
// Where the model files come from (firered-vad.js fireredModelSource: the
// Hugging Face mirror at its pinned commit; the app's own models/firered/
// only for offline development with mirrorCommit null); null
// where there is no page location, e.g. the Node harnesses that drive this
// hook: no detector there.
function voiceModelSource() {
  let appBaseUrl;
  try {
    appBaseUrl = new URL(`${import.meta.env.BASE_URL}${FIRERED_MODEL.dir}`, globalThis.location?.href).href;
  } catch {
    return null;
  }
  return fireredModelSource({ appBaseUrl });
}

function voiceGateCode(vadVoice, enabled) {
  if (vadVoice === true) return "voice";
  if (vadVoice === false) return enabled ? "hidden" : "novoice";
  return undefined;
}

export function useAudioPipeline() {
  const [state, setState] = useState({
    status: "idle",
    error: null,
    voiced: false,
    holding: false,
    pitch: null,
    // Pitch LEVEL the training-direction target is judged on
    // (utils/pitchLevel.js: median of the last 1.5 s of painted pitch) —
    // what colours the F0 readouts; null when nothing is shown.
    pitchLevel: null,
    intensity: null,
    noteName: null,
    // Pitch steadiness (steadiness.js): SD in semitones of the posted
    // pitch over the last ~1 s, or null ("—") when the window holds too
    // little voiced audio or spans a jump the trim refuses.
    // steadinessHeld: the value is the last reading, kept briefly after
    // the voice stopped (dim).
    steadiness: null,
    steadinessHeld: false,
    formants: { f1: null, f2: null, f3: null },
    spectralTilt: null,
    hnr: null,
    // No `vocalWeight` (CPP clarity) slice since 2026-10-11: its only reader,
    // the cue strip's Clarity row, is hidden and the CPP pipeline is retired
    // (measurements/vocal-weight-pipeline-retire-2026-10-11.md).
    // Gender worker (only while the opt-in "Likely heard as" panel is on —
    // see setHeardAsEnabled): idle (not running) | loading | ready | error.
    modelStatus: "idle",
    modelError: null,
    modelProgress: null,       // { loaded, total, file } during download
    // Resonance cue worker (src/resonance/resonance-worker.js):
    // idle | loading | ready | error | overloaded (a back-off pause). Its readings are in
    // resonanceRef (read by the cue strip's 4 Hz tick).
    resonanceStatus: "idle",
    // Voice gate: the pitch display's own voiced flags (= voiced /
    // holding except while the gate hides the pitch), and the detector's
    // status: idle (never started) | loading | ready | unavailable | error | slow.
    // Kept after stop() so Settings can still say why the gate was off.
    pitchVoiced: false,
    pitchHolding: false,
    voiceGateStatus: "idle",
    voiceGateMessage: null,
  });

  // Throttle setState to reduce React renders on mobile.
  // Canvas animations read from refs at full rAF rate; setState only drives
  // the text readouts (F0, F2, HNR, etc.) which don't need >5fps.
  const lastStateUpdateRef = useRef(0);
  const STATE_UPDATE_INTERVAL = 200; // ms (~5fps for text readouts)

  const audioCtxRef = useRef(null);          // null on MSTP path
  const captureSrcRef = useRef(null);        // unified handle from captureSource factory
  const workerRef = useRef(null);
  const mlWorkerRef = useRef(null);
  const mlPortRef = useRef(null); // its capture port (disconnected when switched off)
  const pitchWorkerRef = useRef(null);
  // Dashboard resonance cue (src/resonance/resonance-worker.js, always on
  // while listening) and its latest posted state { u, raw, n, fill, voicedS,
  // clamp, verdict, startU, framesDropped } (null until the first one).
  const resonanceWorkerRef = useRef(null);
  const resonanceRef = useRef(null);
  // Experimental "Likely heard as" panel (opt-in, off by default): whether it
  // is on (the gender worker runs only then), and its aggregator
  // (src/ml/heard-as.js) fed by the gender worker's scored windows and the
  // posted pitch frames, on the audio clock.
  const heardAsEnabledRef = useRef(false);
  const heardAsRef = useRef(null);
  if (heardAsRef.current === null) heardAsRef.current = createHeardAsAggregator();
  // The panel's pitch-only-change warning (src/ml/pitch-only-warning.js):
  // fed every posted pitch frame and every resonance state message from the
  // start of listening whether or not the panel is on (its pitch reference
  // is the session's start, and its late-switch-on fallback builds its
  // quiet-pitch history from these frames in the background); the panel
  // calls update() on its 2 s cadence with the share it draws and this
  // hook's audio clock (rule A40+KP8-3+DS10 since 2026-10-12, §8.6; KS-Q5
  // for a panel switched on after the cue's start window since 2026-10-13,
  // §8.9). The module keeps a bounded number of frames (at most ~7,500,
  // ~320 once its reference is final), however long the panel stays off.
  // measurements/heard-as-pitch-only-warning-2026-10-07.md
  const pitchOnlyRef = useRef(null);
  if (pitchOnlyRef.current === null) pitchOnlyRef.current = createPitchOnlyWarning();
  // Newest audio-clock time (ms of capture contextTime) the hook has seen —
  // the panel's "now".
  const audioClockRef = useRef(null);
  // Starts the gender worker on the running capture source (set in start()).
  const startMlWorkerRef = useRef(null);
  // Experimental resonance lab: handle returned by the dynamically imported
  // labPipeline; stays null until the user opens the lab tab.
  const labRef = useRef(null);
  const labUnsubRef = useRef(null);
  const streamRef = useRef(null);
  // Latest pitch from pitch-worker (SwiftF0). The DSP worker no longer
  // produces pitch since the Stage 4 cutover; each DSP analysis frame
  // reads the most-recent pitch-worker output via this ref. Nearest-
  // neighbor temporal alignment is sufficient — DSP and pitch-worker
  // run on the same chunk cadence, so the lag is at most one chunk
  // (~25 ms), and pitch trace history is built using DSP's absoluteTime
  // anyway. confidence is the voicedness gate's input.
  const latestPitchRef = useRef({
    pitch: null,
    confidence: null,
    voiced: false,
    ts: 0,
  });
  // Voice gate: the setting (App owns it; on by default) — see voiceGateCode
  // above.
  const voiceGateEnabledRef = useRef(true);
  // Diag only: what the last DSP frame's pitch display did — painted (the
  // chain's decision), shown (after the voice gate's mask), hidden (masked).
  const lastDisplayRef = useRef({ painted: false, shown: false, hidden: false });
  // Steadiness tracker (steadiness.js) — fed every pitch-worker message
  // (posted values, voiced or not) by handlePitchMessage; read on every
  // DSP frame by handleAnalysisResult (published on the throttled state
  // cadence). Fresh per start().
  const steadinessRef = useRef(null);
  // Periodic AudioContext state sampler interval — set up in start(),
  // cleared in stop(). Diag-mode-only; the ref stays null in production.
  const ctxSamplerRef = useRef(null);

  // Mirror of the latest DSP gate state, updated each analysis frame
  // (exposed for canvas readers; `voiced` = audio present).
  const dspGateRef = useRef({ voiced: false, holding: false });

  // Latest voice state from the gender worker ({ state, ts }; state
  // listening | updating | scoring | pause | sustained — see
  // ml/utterance-gate.js). The "Likely heard as" panel hides on
  // "sustained" (held vowel / note).
  const genderStateRef = useRef(null);

  // Smoothing buffers
  const pitchSmoothRef = useRef([]);
  // Tracks gaps of >= SMOOTH_RESET_GAP_FRAMES frames without a fresh
  // detection; after one, a register-switch value restarts the display
  // median (pitchSmoothing.js smoothingBufferFor, 2026-10-04).
  const smoothGapRef = useRef(createSmoothingGapTracker());
  const f1SmoothRef = useRef([]);
  const f2SmoothRef = useRef([]);
  const f3SmoothRef = useRef([]);


  // Silence gating + pitch staleness/hold (see pitchGate.js)
  const silenceStartRef = useRef(null);
  const gateStateRef = useRef(createGateState());

  // Display painting state (display-only — never feeds recording).
  // - paintGateRef: onset confirmation + established-level excursion
  //   break (pitchPaintGate.js). Decides whether each pitched frame
  //   paints. Its level reference persists across brief gaps.
  // - displayVoicedRef + unpitchedFramesRef: the VOICED_FALL_FRAMES
  //   hysteresis — after this many consecutive non-painted frames the
  //   display drops from the dim "holding" style to inactive grey, so
  //   the readout/status don't strobe.
  const paintGateRef = useRef(createPaintGate());
  const displayVoicedRef = useRef(false);
  const unpitchedFramesRef = useRef(0);
  // Readout staleness guard (2026-10-03): set when the paint gate
  // suppresses a FRESH off-level pitch (a register change being confirmed,
  // or a harmonic lock). While set, the readout/note name show "—" instead
  // of falling back to the last painted value — which, on a register
  // switch, is the OTHER register (the "readout an octave low" report).
  // Cleared by the next painted frame.
  const heldReadoutStaleRef = useRef(false);
  // Voice gate: set when the gate hides a frame the chain painted,
  // cleared by the next frame it shows. The 5 s silence hold below shows the
  // last shown pitch dimmed, as without the gate, unless this is set: then
  // the chain painted something after that value which the gate hid (a noise
  // line, or a note the detector did not hear as voice), the held value is
  // older than what the chain last drew, and the readout shows "—".
  const gateHidPaintRef = useRef(false);
  const lastVoicedRef = useRef({
    pitch: null,
    pitchLevel: null,
    noteName: null,
    formants: { f1: null, f2: null, f3: null },
    spectralTilt: null,
    hnr: null,
    // The last HNR the readout SHOWED (the voice gate leaves the measured
    // hnr above updating on frames it hides): the 5 s silence hold shows
    // this one, never a value the gate hid.
    shownHnr: null,
  });

  // History buffers for canvas visualizations (read directly by rAF loops)
  const pitchTraceRef = useRef([]);
  const formantTrailRef = useRef([]);
  // Append notification for the pitch trace: PitchTrace subscribes and
  // notifyTrace() runs after each append / reset. PitchTrace's
  // traceRedrawScheduler.js turns it into an animation-frame loop capped at
  // ~60 Hz while points arrive, slowing to ~100 ms redraws once they stop
  // (measurements/phone-cpu-2026-10-12.md; until then one redraw per
  // appended point, main-thread pass 2026-10-08,
  // measurements/main-thread-cpu-2026-10-08.md).
  // (A ref, not a second useState: tools that drive this hook in Node read
  // the hook's single state — scripts/session-oracle/lib/react-mock.mjs.)
  const traceListenersRef = useRef(new Set());
  const subscribeTrace = useCallback((fn) => {
    traceListenersRef.current.add(fn);
    return () => { traceListenersRef.current.delete(fn); };
  }, []);
  const notifyTrace = () => { for (const fn of traceListenersRef.current) fn(); };

  // Optional callback for session recording — called with every analysis frame
  const frameCallbackRef = useRef(null);

  // The DSP-worker `analysis` handler in start() needs to call
  // handleAnalysisResult, which is declared later in this hook body and
  // recreated on every render. Capturing it directly in start's closure
  // would be both (a) a forward-reference at hook-evaluation time and
  // (b) a "stale closure" lint warning since start's deps are []. The
  // ref-update pattern below sidesteps both: start reads the latest
  // handleAnalysisResult through the ref, and the effect that writes the
  // ref runs after every render, so the ref always points to the most-
  // recent version. Stable refs (audioCtxRef, captureSrcRef, etc.) are
  // referenced directly.
  const handleAnalysisResultRef = useRef(null);
  // Same pattern for the pitch-worker message handler.
  const handlePitchMessageRef = useRef(null);

  // Recent AudioWorklet process()-throw timestamps (see capture onError):
  // transient recovered errors are tolerated; repeats escalate.
  const processErrorTimesRef = useRef([]);

  // Guards against a second start() call slipping through during the
  // ~1 s getUserMedia permission prompt — the audioCtxRef.current early-
  // return below isn't set until createCaptureSource resolves, and the UI
  // button-disable race (status "idle" → "requesting") is not airtight
  // if start is ever invoked from a non-button code path.
  const startingRef = useRef(false);

  // stop() is declared after start() in this hook body, but start()'s
  // mid-stream onError needs to call it (capture-source failures during
  // an active session must clean up workers + tracks, not just transition
  // to error state). The ref-update pattern below sidesteps the temporal
  // dead zone — start captures the ref, the post-render effect populates
  // it once stop is defined.
  const stopRef = useRef(null);

  // Bumped at every stop(); worker message handlers capture the value at
  // start() time and drop anything arriving after their generation ended
  // (a message already in the main-thread queue when terminate() runs
  // still fires its handler — previously repopulating just-cleared refs
  // and briefly flashing stale state into the next session).
  const pipelineGenRef = useRef(0);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    // If a previous AudioContext was closed (e.g. via stop()), discard the
    // stale reference so we create a fresh one. A closed AudioContext cannot
    // be resumed — the spec requires a new instance.
    if (audioCtxRef.current && audioCtxRef.current.state === "closed") {
      audioCtxRef.current = null;
    }
    // captureSrcRef is the guard that holds on BOTH capture paths —
    // audioCtxRef stays null on the MSTP path (see the assignment below),
    // so checking it alone left the running-pipeline guard dead on the
    // production default path: a second start() would build a complete
    // second pipeline and orphan the first (mic captured twice, workers
    // leaked, stop() only reaching the second set).
    if (captureSrcRef.current || audioCtxRef.current) return;
    startingRef.current = true;

    steadinessRef.current = createSteadinessTracker();
    pitchOnlyRef.current.reset();

    setState((s) => ({ ...s, status: "requesting", error: null }));

    try {
      // `latency` is a hint to the platform — Chrome on Android takes it
      // seriously on some configurations. Default constraint is
      // { ideal: 0.01, max: 0.05 }; the diag overrides at the top let us
      // measurement-test alternates without rebuilding.
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      if (DIAG_LATENCY_EXACT != null) {
        // `exact` is a strict constraint — getUserMedia rejects if the
        // platform can't deliver the requested value. Used to probe
        // whether the granted-0.04 floor on Pixel/Chrome is movable.
        audioConstraints.latency = { exact: DIAG_LATENCY_EXACT };
      } else if (!DIAG_NO_LATENCY_CONSTRAINT) {
        audioConstraints.latency = { ideal: 0.01, max: 0.05 };
      }
      // ?sr=N — request a specific capture sample rate. Mobile Chrome
      // sometimes allocates smaller hardware buffers at lower sample
      // rates (16 kHz / 22.05 kHz are commonly fast-path on Android).
      // MEASUREMENT-ONLY in this commit: the formant pipeline runs at
      // its fallback decimation at non-48 kHz and produces slightly
      // different formant numbers; pYIN is unaffected.
      if (DIAG_SR_OVERRIDE) {
        audioConstraints.sampleRate = DIAG_SR_OVERRIDE;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      streamRef.current = stream;

      // Capture-source factory. Returns either an audiocontext-based or
      // mstp-based source depending on factory routing (see
      // captureSource.js). Production default is MSTP where supported,
      // falling back to "audiocontext" on the same stream if MSTP fails at
      // start; the ?capture=mstp / ?capture=audiocontext diag flags
      // override for measurement (a forced mstp never falls back).
      //
      // latencyHint = "balanced" (NOT "interactive"). On Pixel-class
      // Android Chrome, "interactive" allocates a tight ~5 ms output
      // buffer that leaves the audio thread no headroom for scheduling
      // jitter; drift accumulates at +5-8 ms/s. "balanced" allocates
      // ~20 ms baseLatency and the drift collapses to ~0. Sweep data:
      // measurements/mobile-latency-sweep-2026-05-05.md.
      const captureSrc = await createCaptureSource(stream, {
        diag: DIAG_ENABLED,
        chunkMs: DIAG_CHUNK_MS_OVERRIDE,
        latencyHint: DIAG_LATENCY_HINT ?? "balanced",
        sampleRate: DIAG_SR_OVERRIDE,
        forceKind: DIAG_CAPTURE_KIND,
        onInitAck: (ack) => setCaptureStatus(ack),
        // MSTP was feature-detected but failed at start; the session goes
        // on via AudioContext. Recorded for the diag overlay / snapshot
        // (audioInfo.captureFallback too) and the console for bug reports.
        onFallback: (info) => {
          console.warn(`[capture] MSTP failed at start (${info.message}); using AudioContext`);
          pushError({ source: "capture", where: "mstp-fallback", message: info.message });
        },
        onError: (err) => {
          pushError({ source: "capture", ...err });
          // Mid-stream capture failures (MSTP copyTo throw, MSTP
          // read-loop reject, worklet init errors) silently halt audio
          // delivery — teardown + error state is correct for those.
          // The one exception: the AudioWorklet's process() handler
          // deliberately SURVIVES a thrown quantum (capture-processor.js
          // returns true and keeps delivering) — tearing the session
          // down for a one-off recovered glitch loses a session to a
          // ~3 ms hiccup. Those only escalate when they repeat (>=3
          // within 10 s ⇒ something is actually wrong with delivery).
          if (err.where === "process") {
            const now = performance.now();
            processErrorTimesRef.current = processErrorTimesRef.current
              .filter((t) => now - t < 10000);
            processErrorTimesRef.current.push(now);
            if (processErrorTimesRef.current.length < 3) return;
          }
          stopRef.current?.();
          setState((s) => ({
            ...s,
            status: "error",
            error: `Audio capture failed: ${err.message || err.where || "unknown"}`,
          }));
        },
      });
      captureSrcRef.current = captureSrc;
      audioCtxRef.current = captureSrc.audioCtx; // null on mstp path
      const myGen = pipelineGenRef.current;
      const genAlive = () => pipelineGenRef.current === myGen;
      // Worker "error" events (2026-10-19 review S-1). A worker whose script
      // fails to load (e.g. its hashed file 404s after a deploy while the
      // tab was open) or throws at top level fires "error" on the Worker
      // object and never posts a message; without a handler the UI waited
      // forever ("Loading voice model… 0 %", "starting…"). Errors from a
      // stopped session or a replaced worker are ignored.
      const onWorkerError = (w, isCurrent, onFail) => {
        w.onerror = (ev) => {
          if (!genAlive() || !isCurrent()) return;
          onFail(ev?.message || "the worker script failed to load");
        };
      };
      // The DSP and pitch workers drive the whole display: if one fails
      // before it has posted anything, the session ends with an error (as a
      // capture failure does). A later uncaught exception inside a running
      // worker does not stop it (the worker keeps handling messages), so
      // that is only recorded.
      const failSession = (name, message) => {
        pushError({ source: name, where: "load", message });
        stopRef.current?.();
        setState((s) => ({
          ...s,
          status: "error",
          error: `Audio analysis failed to start (${name}: ${message}). Reload the page and try again.`,
        }));
      };

      // Diagnostic snapshot — captured once at start. Path-specific
      // fields (baseLatency / outputLatency / ctxCreatedAtEpochMs)
      // come from captureSrc.audioInfoExtra(); mstp path returns
      // nulls for the fields that don't apply.
      if (DIAG_ENABLED) {
        const trackSettings = stream.getAudioTracks()[0]?.getSettings?.() ?? null;
        setAudioInfo({
          captureKind: captureSrc.kind,
          sampleRate: captureSrc.sampleRate,
          ...captureSrc.audioInfoExtra(),
          // Echo of which override flags were active for this session,
          // so the snapshot is self-describing.
          srOverride: DIAG_SR_OVERRIDE,
          latencyHintOverride: DIAG_LATENCY_HINT,
          noLatencyConstraint: DIAG_NO_LATENCY_CONSTRAINT,
          captureKindOverride: DIAG_CAPTURE_KIND,
          // Track settings reflect what the platform granted vs
          // requested. Mobile browsers may silently override.
          requestedConstraints: { ...audioConstraints },
          grantedConstraints: trackSettings,
          userAgent: navigator.userAgent,
        });
      }

      const worker = new Worker(
        new URL("../dsp/dsp-worker.js", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      let dspHeard = false;
      onWorkerError(worker, () => workerRef.current === worker, (message) => {
        if (dspHeard) pushError({ source: "dsp-worker", where: "uncaught", message });
        else failSession("dsp-worker", message);
      });

      worker.postMessage({
        type: "init",
        sampleRate: captureSrc.sampleRate,
        ...(DIAG_ENABLED ? { diag: true } : {}),
      });

      // Direct MessagePort from the capture source to the DSP worker.
      // The factory hands us the consumer end of a MessageChannel
      // already plumbed into the worklet (or MSTP worker, on that path).
      const dspPort = captureSrc.connectConsumer();
      worker.postMessage(
        { type: "port", port: dspPort },
        [dspPort],
      );

      // Resonance cue worker (2026-10-07): the resonance lab's spectral
      // warp in "frames" mode — it reuses the pitch worker's posted
      // decisions (relayed in handlePitchMessage) instead of re-running the
      // pitch chain. measurements/resonance-cue-production-path-2026-10-07.md
      const resonanceWorker = new Worker(
        new URL("../resonance/resonance-worker.js", import.meta.url),
        { type: "module" },
      );
      resonanceWorkerRef.current = resonanceWorker;
      // The cue is not essential: a resonance worker whose script fails to
      // load shows "unavailable — reload the page" in its row (a newer
      // deploy replaced its file; a reload fetches it) and the session goes on.
      onWorkerError(resonanceWorker, () => resonanceWorkerRef.current === resonanceWorker, (message) => {
        resonanceRef.current = null;
        pitchOnlyRef.current.noteResonance(null);
        setState((s) => ({ ...s, resonanceStatus: "reload" }));
        if (DIAG_ENABLED) setResonanceStatus({ status: "error", message });
        pushError({ source: "resonance-worker", where: "load", message });
      });
      resonanceWorker.onmessage = (e) => {
        if (!genAlive()) return;
        const msg = e.data;
        if (!msg?.type) return;
        if (msg.type === "state") {
          resonanceRef.current = msg;
          pitchOnlyRef.current.noteResonance(msg, audioClockRef.current);
          if (DIAG_ENABLED && msg.perf) setResonancePerf(msg.perf);
        } else if (msg.type === "status") {
          // "overloaded" is a back-off pause (the worker resumes with a
          // fresh engine and posts "ready"): drop the stale reading. On
          // "error" too: a frozen last snapshot must not keep driving the
          // cue row or the pitch-only warning. After an exception while
          // running, the worker restarts a fresh engine after a short
          // back-off and posts "ready" again (a few times per session; a
          // failed asset load stays "error") — resonance-worker.js. The row
          // tells them apart (2026-10-19 review F2-1): "restarting" while
          // it recovers, "reload" for a failed asset load, "error" once it
          // has given up.
          if (msg.status === "overloaded" || msg.status === "error") {
            resonanceRef.current = null;
            pitchOnlyRef.current.noteResonance(null);
          }
          const rs = msg.status !== "error" ? msg.status
            : msg.recovering ? "restarting" : msg.reason === "load" ? "reload" : "error";
          setState((s) => ({ ...s, resonanceStatus: rs }));
          if (DIAG_ENABLED) setResonanceStatus({ status: msg.status, message: msg.message ?? null });
          if (msg.status === "error") pushError({ source: "resonance-worker", where: "worker", message: msg.message });
        }
      };
      resonanceWorker.postMessage({
        type: "init",
        sampleRate: captureSrc.sampleRate,
        assetBase: import.meta.env.BASE_URL,
        ...(DIAG_ENABLED ? { diag: true } : {}),
      });
      const resonancePort = captureSrc.connectConsumer();
      resonanceWorker.postMessage({ type: "audioPort", port: resonancePort }, [resonancePort]);

      // Gender (ML) worker: started only while the opt-in "Likely heard
      // as" panel is on — now, or later in this session through
      // setHeardAsEnabled (startMlWorkerRef). Saves ~0.3 s of CPU per
      // second of speech and the first-time download (voice model + speech
      // detector + ONNX Runtime engine, src/ml/heard-as-download.js) for everyone else
      // (measurements/heard-as-window-logit-2026-10-07.md §4).
      startMlWorkerRef.current = () => {
        if (mlWorkerRef.current || !genAlive() || captureSrcRef.current !== captureSrc) return;
        const mlWorker = new Worker(
          new URL("../ml/gender-worker.js", import.meta.url),
          { type: "module" },
        );
        mlWorkerRef.current = mlWorker;
        if (DIAG_ENABLED) setMlWorkerAlive(true);
        heardAsRef.current.reset();
        genderStateRef.current = null;
        let mlHeard = false;
        mlWorker.onmessage = (ev) => { mlHeard = true; handleMlMessage(ev, mlWorker); };
        // A gender worker that fails to load shows as an error in the panel
        // (the panel's switch off and on starts a new one). As for the DSP
        // and pitch workers, a later uncaught exception inside a running
        // worker is only recorded: the worker keeps going, so the panel
        // must not lock at "Unavailable" (2026-10-19 review F2-3).
        onWorkerError(mlWorker, () => mlWorkerRef.current === mlWorker, (message) => {
          if (mlHeard) { pushError({ source: "mlWorker", where: "uncaught", message }); return; }
          pushError({ source: "mlWorker", where: "load", message });
          setState((s) => ({ ...s, modelStatus: "error", modelError: message, modelProgress: null }));
        });
        mlWorker.postMessage({
          type: "init",
          inputSampleRate: captureSrc.sampleRate,
          ...(DIAG_ENABLED ? { diag: true } : {}),
        });
        const mlPort = captureSrc.connectConsumer();
        mlPortRef.current = mlPort;
        mlWorker.postMessage({ type: "audioPort", port: mlPort }, [mlPort]);
      };
      if (heardAsEnabledRef.current) startMlWorkerRef.current();

      // Pitch detection worker. Hosts the Boersma-AC (Praat-style
      // autocorrelation) detector + bounded-Viterbi path tracker — pure
      // JS, no model fetch, ready immediately. Emits {pitch, confidence,
      // voiced} per audio chunk. Replaced SwiftF0 ONNX at the 2026-06-09
      // cutover (weak-fundamental octave-up failure on low-F0 voices;
      // see measurements/boersma-ac-tuning-2026-06-09.md). Audio forked
      // from the same captureSource via a third MessagePort.
      const pitchWorker = new Worker(
        new URL("../dsp/pitch-worker.js", import.meta.url),
        { type: "module" },
      );
      pitchWorkerRef.current = pitchWorker;
      let pitchHeard = false;
      onWorkerError(pitchWorker, () => pitchWorkerRef.current === pitchWorker, (message) => {
        if (pitchHeard) pushError({ source: "pitch-worker", where: "uncaught", message });
        else failSession("pitch-worker", message);
      });
      const voiceSource = voiceModelSource();
      pitchWorker.postMessage({
        type: "init",
        inputSampleRate: captureSrc.sampleRate,
        ...(DIAG_ENABLED ? { diag: true } : {}),
        // Voice detector: where its model files come from (voiceModelSource).
        ...(voiceSource ? { vad: { modelBase: voiceSource.base, source: voiceSource.kind } } : {}),
      });

      const pitchPort = captureSrc.connectConsumer();
      pitchWorker.postMessage(
        { type: "audioPort", port: pitchPort },
        [pitchPort],
      );

      // Experimental resonance lab: one EXTRA capture consumer + lab worker,
      // loaded on demand once the user has opened the lab tab (now, or later
      // in this listening session). Until then nothing lab-related is
      // fetched or run (see resonance-lab/labRequest.js).
      let labStarting = false;
      const startLabIfRequested = () => {
        if (labStarting || labRef.current || !isResonanceLabRequested()) return;
        labStarting = true;
        import("../resonance-lab/labPipeline.js")
          .then((lab) => {
            if (!genAlive() || captureSrcRef.current !== captureSrc || labRef.current) return;
            // The weight x clarity lab view needs the granted capture settings
            // (gain control, microphone id + label) to know whether loudness can be matched.
            const track = streamRef.current?.getAudioTracks?.()[0];
            labRef.current = lab.startLab(captureSrc, { trackSettings: track?.getSettings?.() ?? null, trackLabel: track?.label ?? null });
          })
          .catch((err) => console.error("resonance lab failed to start", err))
          .finally(() => { labStarting = false; });
      };
      if (labUnsubRef.current) labUnsubRef.current();
      labUnsubRef.current = onResonanceLabRequested(startLabIfRequested);
      startLabIfRequested();

      pitchWorker.onmessage = (e) => {
        if (!genAlive()) return; // late message after stop()
        pitchHeard = true;
        const msg = e.data;
        if (!msg || !msg.type) return;
        if (msg.type === "pitch") {
          handlePitchMessageRef.current?.(msg);
        } else if (msg.type === "vad-status") {
          // Voice detector: loading | ready | unavailable | error | slow.
          // Not ready = no decisions = the pitch display is not gated.
          setState((s) => ({ ...s, voiceGateStatus: msg.status, voiceGateMessage: msg.message ?? null }));
          setVoiceGate({ status: msg.status, message: msg.message ?? null });
          if (msg.status === "error" || msg.status === "slow") {
            pushError({ source: "pitch-worker", where: "voice-detector", message: msg.message ?? msg.status });
          }
        } else if (msg.type === "inference-event") {
          // Mirrors the gender-worker timeout-event handling. Diag-only
          // capture of pitch-worker hangs into the errors ring so
          // snapshots reveal hang frequency.
          if (DIAG_ENABLED) {
            pushError({
              source: "pitchWorker",
              where: msg.event,
              message: `${msg.event}: ${msg.durationMs}ms`,
              ts: msg.ts,
            });
          }
        } else if (msg.type === "status") {
          if (msg.status === "error") {
            pushError({ source: "pitch-worker", where: "load", message: msg.message });
          }
          if (msg.status === "ready" && DIAG_ENABLED) {
            setPitchModel({
              modelUrl: msg.modelUrl ?? null,
              device: msg.device ?? null,
              threshold: msg.threshold ?? null,
            });
          }
        }
      };

      // Gender worker messages (the worker exists only while the panel is
      // on). A message from a worker that has since been terminated (panel
      // switched off, or a new session) is dropped.
      function handleMlMessage(e, fromWorker) {
        if (!genAlive() || mlWorkerRef.current !== fromWorker) return;
        const msg = e.data;
        if (!msg || !msg.type) return;
        if (msg.type === "score") {
          // The panel pools the UNSMOOTHED per-window logit at the window's
          // audio-clock time (gated windows only — heard-as.js). The 0-100
          // EMA score is no longer shown anywhere.
          heardAsRef.current.addWindow({ audioMs: msg.audioMs, logit: msg.logit, mode: msg.mode });
          if (typeof msg.audioMs === "number") audioClockRef.current = Math.max(audioClockRef.current ?? -Infinity, msg.audioMs);
          // Diag-only: capture per-inference timing so mobile-diag-
          // capture's snapshot summary can compute median/p95/p99
          // against the 150 ms hop budget. No-op when diag isn't on
          // (pushMlInference is no-op without diagState).
          if (DIAG_ENABLED && typeof msg.inferMs === "number") {
            pushMlInference({
              tEpochMs: msg.ts,
              inferMs: msg.inferMs,
              // speech detector's run time since the previous posted
              // score (0 while the detector is not live; the first score
              // and the first after a pause also carry unscored ticks)
              vadMs: typeof msg.vadMs === "number" ? msg.vadMs : null,
              score: msg.score,
              confidence: msg.confidence,
            });
          }
        } else if (msg.type === "scored") {
          // A window the gate scored between classifier runs (the worker
          // classifies every 450 ms): counts for the panel's window count,
          // voiced time and F0, not for the logit mean (heard-as.js).
          heardAsRef.current.addWindow({ audioMs: msg.audioMs, logit: null, mode: msg.mode, classified: false });
          if (typeof msg.audioMs === "number") audioClockRef.current = Math.max(audioClockRef.current ?? -Infinity, msg.audioMs);
        } else if (msg.type === "speech-detector") {
          // The utterance gate's speech detector (speech-detector.js):
          // diag-only record of whether it loaded (setMlModel is a no-op
          // without diag). On "error" the gate keeps running on pitch
          // voicing, so there is nothing to show the user.
          setMlModel({ speechDetector: msg.status, speechDetectorError: msg.message ?? null, speechDetectorSource: msg.source ?? null });
          if (DIAG_ENABLED && msg.status === "error") {
            pushError({ source: "mlWorker", where: "speech-detector", message: msg.message ?? "error", ts: Date.now() });
          }
        } else if (msg.type === "inference-event") {
          // Diag-only: capture defensive-timeout events from the gender
          // worker into the errors ring so snapshots reveal hang frequency.
          // Used to confirm/refute H1 (WebGPU init race) from real-user
          // data — see CLAUDE.md "Pitch detection of periodic non-speech
          // content" / gender-worker.js INFERENCE_TIMEOUT_MS for context.
          if (DIAG_ENABLED) {
            pushError({
              source: "mlWorker",
              where: msg.event,
              message: msg.message ?? `${msg.event}: ${msg.durationMs}ms`,
              ts: msg.ts,
            });
          }
        } else if (msg.type === "status") {
          setState((s) => ({
            ...s,
            modelStatus: msg.status,
            modelError: msg.message ?? null,
          }));
          // When the worker reaches "ready", record which modelId
          // + ORT backend (webgpu vs wasm) actually loaded into
          // diag state. Useful for snapshot inspection. The fields
          // are only present on the "ready" status; setMlModel is
          // a no-op outside diag mode.
          if (msg.status === "ready" && (msg.modelId || msg.device)) {
            setMlModel({
              modelId: msg.modelId ?? null,
              device: msg.device ?? null,
            });
          }
        } else if (msg.type === "voice-state") {
          genderStateRef.current = { state: msg.state, ts: Math.round(msg.ts) };
        } else if (msg.type === "progress") {
          setState((s) => ({
            ...s,
            modelProgress: { loaded: msg.loaded, total: msg.total, file: msg.file },
          }));
        }
      }

      worker.onmessage = (e) => {
        if (!genAlive()) return; // late message after stop()
        dspHeard = true;
        const msg = e.data;
        if (!msg || !msg.type) return;

        // Init-ack / error messages from the DSP worker (diag mode only —
        // production worker doesn't send these; the conditional read on
        // the diag side keeps production paths untouched).
        if (msg.type === "worker-init-ack") {
          if (DIAG_ENABLED) setWorkerStatus({
            diag: msg.diag,
            sampleRate: msg.sampleRate,
            windowSize: msg.windowSize,
          });
          return;
        }
        if (msg.type === "worker-error") {
          if (DIAG_ENABLED) pushError({
            source: "worker", where: msg.where, message: msg.message, stack: msg.stack,
          });
          return;
        }

        if (msg.type !== "analysis") return;
        const data = msg.data;

        // Diagnostic mode: capture timing breakpoints around the
        // analysis-handler call.
        //   chunkArrivalMs   = DSP receipt epoch - audio capture epoch
        //                      (audio capture epoch = audioOriginEpochMs
        //                       + contextTime*1000 from the worklet)
        //   handoffToMainMs  = main onmessage entry - DSP postMessage epoch
        //   mainHandlerMs    = handleAnalysisResult duration
        //   totalMs          = display update time - audio capture epoch
        if (DIAG_ENABLED && data.diag) {
          const handlerStart = performance.timeOrigin + performance.now();
          const audioOriginEpochMs = captureSrcRef.current?.audioOriginEpochMs;
          const audioCapturedEpochMs =
            typeof data.contextTime === "number" && typeof audioOriginEpochMs === "number"
              ? audioOriginEpochMs + data.contextTime * 1000
              : null;
          const chunkArrivalMs =
            audioCapturedEpochMs && typeof data.diag.chunkReceiveEpochMs === "number"
              ? data.diag.chunkReceiveEpochMs - audioCapturedEpochMs
              : null;
          const handoffToMainMs =
            typeof data.diag.postedAtEpochMs === "number"
              ? handlerStart - data.diag.postedAtEpochMs
              : null;
          // Snapshot latest pitch + confidence at frame-emit time so the
          // diag entry pairs the DSP frame with the pitch-worker output
          // visible at this moment.
          const latest = latestPitchRef.current;
          try {
            handleAnalysisResultRef.current?.(data);
          } catch (err) {
            pushError({ source: "main", where: "handleAnalysisResult", message: err.message, stack: err.stack });
            return;
          }
          const handlerEnd = performance.timeOrigin + performance.now();
          pushFrame({
            tEpochMs: data.absoluteTime,
            capturedEpochMs: audioCapturedEpochMs,
            pitch: latest.pitch,
            intensity: data.intensity,
            inputRms: data.diag.inputRms,
            confidence: latest.confidence,
            // voice detector (null without a decision) and what
            // the pitch display did on this frame
            vadP: latest.vadP ?? null,
            vadVoice: latest.vadVoice ?? null,
            painted: lastDisplayRef.current.painted,
            shown: lastDisplayRef.current.shown,
            vadHidden: lastDisplayRef.current.hidden,
            pendingChunks: data.pendingChunks,
            timings: {
              chunkArrivalMs,
              workerProcessingMs: data.workerProcessingMs,
              handoffToMainMs,
              mainHandlerMs: handlerEnd - handlerStart,
              totalMs: audioCapturedEpochMs ? handlerEnd - audioCapturedEpochMs : null,
            },
          });
        } else {
          handleAnalysisResultRef.current?.(data);
        }
      };

      // Periodic AudioContext state sampler (diag mode only). 1 Hz —
      // matches the low-res buffer cadence so each lowRes entry can be
      // backfilled with one fresh ctx-state read. Cheap (a handful of
      // property reads); does nothing in production. On the MSTP path,
      // captureSrc.audioCtx is null and the ctx-* fields write null —
      // signals that AudioContext-internal state isn't observable on
      // that path (which is itself useful diagnostic info).
      if (DIAG_ENABLED) {
        const ac = captureSrc.audioCtx;
        ctxSamplerRef.current = setInterval(() => {
          try {
            const mem = performance && performance.memory
              ? performance.memory.usedJSHeapSize / (1024 * 1024)
              : null;
            setAudioCtxSample({
              ctxState: ac ? ac.state : null,
              ctxBaseLatencyMs: ac ? (ac.baseLatency ?? 0) * 1000 : null,
              ctxOutputLatencyMs: ac ? (ac.outputLatency ?? 0) * 1000 : null,
              ctxCurrentTime: ac ? ac.currentTime : null,
              visibilityState: typeof document !== "undefined" ? document.visibilityState : null,
              memoryUsedMB: mem,
            });
          } catch {
            // ignore; ctx may be closing
          }
        }, 1000);
      }

      // Voice Shaper (experimental, its own tab): the capture handle its
      // recorder uses while listening (one extra capture consumer, only
      // during a recording). Cleared in stop(). voice-preview/bridge.js.
      setVoicePreviewCapture({
        sampleRate: captureSrc.sampleRate,
        connect: () => captureSrc.connectConsumer(),
        disconnect: (port) => captureSrc.disconnectConsumer?.(port),
        startedAt: performance.now(),
      });

      setState((s) => ({ ...s, status: "running" }));
    } catch (err) {
      // Best-effort cleanup of any partial state. start() may have set up
      // some refs before failing — getUserMedia stream, captureSrc, and any
      // workers created up to the failure point. Without this, retry-after-
      // error orphans the previous stream/workers (mic indicator stays on,
      // workers keep running with no terminate path).
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* */ }
        streamRef.current = null;
      }
      if (captureSrcRef.current) {
        try { captureSrcRef.current.close(); } catch { /* */ }
        captureSrcRef.current = null;
      }
      audioCtxRef.current = null;
      if (labUnsubRef.current) { labUnsubRef.current(); labUnsubRef.current = null; }
      if (labRef.current) {
        labRef.current.stop();
        labRef.current = null;
      }
      for (const ref of [workerRef, mlWorkerRef, pitchWorkerRef, resonanceWorkerRef]) {
        if (ref.current) {
          try { ref.current.terminate(); } catch { /* */ }
          ref.current = null;
        }
      }
      startMlWorkerRef.current = null;
      if (ctxSamplerRef.current) {
        clearInterval(ctxSamplerRef.current);
        ctxSamplerRef.current = null;
      }
      // Only a real permission refusal says "denied" — a capture failure
      // after access was granted used to read as one.
      const denied = err?.name === "NotAllowedError";
      setState((s) => ({
        ...s,
        status: "error",
        error: denied
          ? "Microphone access denied. Allow the microphone for this site, then try again."
          : err?.message || "The microphone could not be started.",
      }));
    } finally {
      startingRef.current = false;
    }
  }, []);

  const stop = useCallback(() => {
    pipelineGenRef.current++; // invalidate in-flight worker messages
    setVoicePreviewCapture(null);
    if (ctxSamplerRef.current) {
      clearInterval(ctxSamplerRef.current);
      ctxSamplerRef.current = null;
    }
    if (captureSrcRef.current) {
      captureSrcRef.current.close();
      captureSrcRef.current = null;
    }
    audioCtxRef.current = null; // owned by captureSrc; just drop the alias
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (mlWorkerRef.current) {
      mlWorkerRef.current.terminate();
      mlWorkerRef.current = null;
      if (DIAG_ENABLED) setMlWorkerAlive(false);
    }
    mlPortRef.current = null;
    startMlWorkerRef.current = null;
    if (pitchWorkerRef.current) {
      pitchWorkerRef.current.terminate();
      pitchWorkerRef.current = null;
    }
    if (resonanceWorkerRef.current) {
      resonanceWorkerRef.current.terminate();
      resonanceWorkerRef.current = null;
    }
    resonanceRef.current = null;
    heardAsRef.current.reset();
    pitchOnlyRef.current.reset();
    audioClockRef.current = null;
    if (labUnsubRef.current) { labUnsubRef.current(); labUnsubRef.current = null; }
    if (labRef.current) {
      labRef.current.stop();
      labRef.current = null;
    }
    latestPitchRef.current = { pitch: null, confidence: null, voiced: false, ts: 0 };
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    pitchSmoothRef.current = [];
    smoothGapRef.current.reset();
    f1SmoothRef.current = [];
    f2SmoothRef.current = [];
    f3SmoothRef.current = [];
    silenceStartRef.current = null;
    gateStateRef.current = createGateState();
    paintGateRef.current.reset();
    displayVoicedRef.current = false;
    unpitchedFramesRef.current = 0;
    heldReadoutStaleRef.current = false;
    gateHidPaintRef.current = false;
    // Without this reset the next session's initial silence "holds" the
    // PREVIOUS session's pitch/note/formants in the dim style for up to
    // 5 s before the first utterance.
    lastVoicedRef.current = {
      pitch: null,
      pitchLevel: null,
      noteName: null,
      formants: { f1: null, f2: null, f3: null },
      spectralTilt: null,
      hnr: null,
      shownHnr: null,
    };
    pitchTraceRef.current = [];
    for (const fn of traceListenersRef.current) fn();
    formantTrailRef.current = [];
    genderStateRef.current = null;
    dspGateRef.current = { voiced: false, holding: false };
    steadinessRef.current = null;
    setState((s) => ({
      ...s,
      status: "idle",
      error: null,
      voiced: false,
      holding: false,
      pitch: null,
      pitchLevel: null,
      intensity: null,
      noteName: null,
      steadiness: null,
      steadinessHeld: false,
      formants: { f1: null, f2: null, f3: null },
      spectralTilt: null,
      hnr: null,
      modelStatus: "idle",
      modelError: null,
      modelProgress: null,
      resonanceStatus: "idle",
      pitchVoiced: false,
      pitchHolding: false,
    }));
  }, []);

  // The "Hide pitch when no voice is heard" setting (App owns the
  // persisted value). Applies from the next frame; the detector itself runs
  // either way while listening, so switching it back on is immediate.
  const setVoiceGateEnabled = useCallback((on) => {
    voiceGateEnabledRef.current = !!on;
    setVoiceGate({ enabled: !!on });
  }, []);

  // The "Likely heard as" panel switched on / off (Settings or the panel's
  // own switch; App owns the persisted setting). On: start the gender worker
  // now if listening (else start() does). Off: terminate it, take its
  // capture port off the broadcast list (captureSource.disconnectConsumer —
  // no chunk copies to a dead port, however often the switch is flipped)
  // and forget its windows.
  const setHeardAsEnabled = useCallback((on) => {
    heardAsEnabledRef.current = !!on;
    if (on) {
      startMlWorkerRef.current?.();
      return;
    }
    if (mlWorkerRef.current) {
      mlWorkerRef.current.terminate();
      mlWorkerRef.current = null;
      if (DIAG_ENABLED) setMlWorkerAlive(false);
    }
    if (mlPortRef.current) {
      captureSrcRef.current?.disconnectConsumer?.(mlPortRef.current);
      mlPortRef.current = null;
    }
    heardAsRef.current.reset();
    genderStateRef.current = null;
    setState((s) => (s.modelStatus === "idle" && s.modelProgress === null && s.modelError === null
      ? s
      : { ...s, modelStatus: "idle", modelError: null, modelProgress: null }));
  }, []);

  // Unmount cleanup. Placed here (rather than at the top of the hook body
  // before start/stop are declared) so the [stop] dep list resolves
  // without a temporal-dead-zone reference and without a lint suppression
  // comment. stop is useCallback'd with [] so this effect runs exactly
  // once for setup and once for teardown.
  useEffect(() => {
    return () => stop();
  }, [stop]);

  // Make stop() callable from start()'s onError closure (mid-stream
  // capture errors must tear down the pipeline). Updated post-render so
  // refs are not mutated during render (concurrent renders may abandon).
  useEffect(() => { stopRef.current = stop; });

  // Throttled setState: only fires at STATE_UPDATE_INTERVAL to avoid
  // saturating the main thread with React renders on mobile.
  // Canvas animations read from refs at full rAF rate (unaffected).
  function throttledSetState(updater) {
    const now = performance.now();
    if (now - lastStateUpdateRef.current >= STATE_UPDATE_INTERVAL) {
      lastStateUpdateRef.current = now;
      setState(updater);
    }
  }

  // Pitch-worker "pitch" message: latest-pitch ref for the DSP frames,
  // pitch hints to the DSP, ML and resonance workers, the steadiness window, diag.
  // Reached from start()'s onmessage through handlePitchMessageRef.
  function handlePitchMessage(msg) {
    // Voice detector decision for this hop (null: no decision —
    // detector loading / missing / off; the display is then not gated).
    const vad = msg.vad && typeof msg.vad.voice === "boolean" ? msg.vad : null;
    latestPitchRef.current = {
      pitch: msg.pitch,
      confidence: msg.confidence,
      voiced: msg.voiced,
      ts: msg.ts,
      vadVoice: vad ? vad.voice : null,
      vadP: vad ? vad.p : null,
    };
    // Forward pitch hint to the DSP worker so its formant extraction
    // can pick the right LPC order / formant ceiling. One-frame lag
    // is acceptable since formants change slowly. We always send
    // (including null when unvoiced) so the DSP worker can drop the
    // hint promptly when speech ends.
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: "pitch-hint",
        pitch: msg.pitch,
      });
    }
    // Forward every pitch frame to the ML worker: its utterance gate
    // (ml/utterance-gate.js) scores only recent, voiced running speech,
    // restarts the score at each utterance onset, and spots held
    // phonation from the pitch track — so noise-only windows stop
    // feeding masculine-leaning scores into the "Likely heard as" panel
    // (measurements/perceived-voice-gate-2026-10-07.md; while the worker's
    // speech detector is loaded it decides "is someone speaking" and pitch
    // voicing only drives the held-note test). Sent voiced or
    // not, so utterances close promptly. contextTime (the frame's capture
    // time) puts the hint on the audio clock the gate runs on.
    const hint = {
      type: "pitch-hint",
      voiced: msg.voiced,
      pitch: msg.pitch,
      contextTime: msg.contextTime ?? null,
    };
    if (mlWorkerRef.current) {
      mlWorkerRef.current.postMessage(hint);
      // The "Likely heard as" estimate's F0: every posted frame (the posted
      // value, never the smoothed / painted / held one), on the audio clock.
      if (typeof msg.contextTime === "number") {
        heardAsRef.current.addPitch({ audioMs: msg.contextTime * 1000, f0: msg.pitch });
      }
    }
    // The resonance cue reuses these decisions (bit-identical to the lab's
    // own pitch replica — tests/resonance/vtln-production-parity-test.js)
    // and gates on them with the same utterance gate. Voice gate (see the
    // header): while the setting is on and this hop's decision is "no
    // voice", the hint says unvoiced (pitch / contextTime unchanged) — the
    // measured variant (measurements/noise-detector-tryout-resonance-
    // 2026-10-21.md). No decision, or the setting off: the hint as before.
    if (resonanceWorkerRef.current) {
      const hideRes = voiceGateEnabledRef.current && vad !== null && vad.voice === false;
      resonanceWorkerRef.current.postMessage(hideRes ? { ...hint, voiced: false } : hint);
    }
    if (typeof msg.contextTime === "number") {
      // The pitch-only warning's pitch start and its late-switch-on seed:
      // every posted frame, voiced values only (unvoiced as null).
      pitchOnlyRef.current.addPitch({ audioMs: msg.contextTime * 1000, f0: msg.voiced && msg.pitch > 0 ? msg.pitch : null });
      audioClockRef.current = Math.max(audioClockRef.current ?? -Infinity, msg.contextTime * 1000);
    }
    if (DIAG_ENABLED && typeof msg.inferMs === "number") {
      pushPitchInference({
        tEpochMs: msg.ts,
        inferMs: msg.inferMs,
        pitch: msg.pitch,
        confidence: msg.confidence,
        voiced: msg.voiced,
        // voice detector: smoothed score, decision, worker time
        // for this hop (fbank + model), null without a decision
        vadP: vad ? vad.p : null,
        vadVoice: vad ? vad.voice : null,
        vadMs: typeof msg.vadMs === "number" ? msg.vadMs : null,
      });
    }
    if (DIAG_ENABLED && vad) setVoiceGate({ p: vad.p, voice: vad.voice, hiding: voiceGateEnabledRef.current && !vad.voice });
    // Steadiness window: every posted value (null = unvoiced) on the
    // audio clock. Lazily created so the oracle chain, which drives the
    // hook without start(), exercises the same path. A hop the voice
    // gate hides enters as unvoiced.
    if (!steadinessRef.current) steadinessRef.current = createSteadinessTracker();
    steadinessRef.current.push(
      voiceGateEnabledRef.current && vad && vad.voice === false ? null : msg.pitch,
      typeof msg.contextTime === "number" ? msg.contextTime : msg.ts / 1000,
    );
    // Voice Shaper: the posted value for its recording's F0 track (only
    // while it records; changes no state here). voice-preview/bridge.js.
    voicePreviewPitchTap(msg);
  }

  useEffect(() => { handlePitchMessageRef.current = handlePitchMessage; });

  function handleAnalysisResult(data) {
    const { intensity, formants, spectralTilt, hnr, absoluteTime } = data;

    // Use the worker's absolute timestamp for data points.
    // This reflects when audio was *analyzed* in the worker, which is the
    // true event time.  The draw loop also uses absoluteTime-based clocks,
    // and clockOffset between worker and main thread is ~0ms.
    const now = Math.round(absoluteTime);

    // Pitch + confidence come from pitch-worker (SwiftF0) via latestPitchRef,
    // not from the DSP analysis message. Each DSP frame consumes the most-
    // recent pitch-worker output (nearest-neighbor temporal alignment).
    // pitchGate.js owns the frame-level decisions: silence gate (AND-logic
    // intensity + confidence, debounced), staleness fallback (a pitch-worker
    // stall/death must not freeze the gate's voicedness arm), and the
    // bounded hold window for bridging brief SwiftF0 null gaps.
    const latestPitch = latestPitchRef.current;
    // Voice gate (see voiceGateCode): hide the pitch display on this
    // frame when the setting is on and the latest hop's decision is "no
    // voice". A mask only — nothing below changes its state because of it.
    const gateOn = voiceGateEnabledRef.current;
    const vadHide = gateOn && latestPitch.vadVoice === false;
    const voiceGate = voiceGateCode(latestPitch.vadVoice, gateOn);
    const gate = evaluateFrameGate(gateStateRef.current, {
      now,
      intensity,
      pitch: latestPitch.pitch,
      confidence: latestPitch.confidence,
      pitchTs: latestPitch.ts,
    });
    const { pitch, hasPitch, isQuiet } = gate;
    // Steadiness reading (cached inside the tracker: recomputed on the
    // first read after new pitch messages arrived, i.e. at most once per
    // DSP frame). A stalled pitch worker reads "—".
    const steady = !gate.pitchStale && steadinessRef.current
      ? steadinessRef.current.read()
      : NO_STEADINESS;
    // Counted on every frame (silence frames included): true on a fresh
    // detection right after a gap — see smoothingBufferFor below.
    const freshAfterGap = smoothGapRef.current.frame(hasPitch);

    if (isQuiet) {
      // Silence frames are a trace gap for the paint gate (continuity
      // counters reset; the established level persists across this brief
      // gap). The fall counter advances the dim→grey hysteresis.
      paintGateRef.current.resetSegment();
      unpitchedFramesRef.current++;
      if (unpitchedFramesRef.current >= VOICED_FALL_FRAMES) {
        displayVoicedRef.current = false;
      }

      // Record silence start time
      if (silenceStartRef.current === null) {
        silenceStartRef.current = now;
      }

      const silenceDuration = now - silenceStartRef.current;

      // Once the pitch-hold window expires during silence, drop the
      // smoothing buffer. The non-quiet path below has an equivalent
      // reset, but silence frames return early and never reach it — so
      // a 0.4 s–5 s pause used to keep pre-pause values in the buffer
      // and median the next utterance's onset against them (~2 frames
      // recorded at the OLD pitch after every mid-length pause).
      if (!gate.holdAllowed && pitchSmoothRef.current.length > 0) {
        pitchSmoothRef.current = [];
      }

      // Add gap to pitch trace (null pitch = gap)
      pitchTraceRef.current.push({ time: now, pitch: null, voiced: false });
      trimHistory(pitchTraceRef.current, PITCH_TRACE_SECONDS * 1000, now);
      notifyTrace();

      if (silenceDuration < SILENCE_HOLD_MS) {
        // Hold last voiced values (display goes to reduced opacity). The
        // voice gate does not cut this hold short (the detector says
        // "no voice" 2 s into a silence): the held pitch is the last one it
        // let through — unless it hid painted frames after it
        // (gateHidPaintRef), and then the readout shows "—".
        dspGateRef.current = { voiced: false, holding: true };
        const held = lastVoicedRef.current;
        const gateHid = gateHidPaintRef.current;
        const heldStale = heldReadoutStaleRef.current || gateHid;
        throttledSetState((s) => ({
          ...s,
          voiced: false,
          holding: true,
          pitchVoiced: false,
          pitchHolding: !gateHid,
          pitch: heldStale ? null : held.pitch,
          pitchLevel: heldStale ? null : held.pitchLevel,
          intensity,
          noteName: heldStale ? null : held.noteName,
          steadiness: vadHide ? null : steady.value,
          steadinessHeld: vadHide ? false : steady.held,
          formants: held.formants,
          spectralTilt: held.spectralTilt,
          // Voice gate: the last HNR the readout showed stays for the whole
          // hold, like the dim pitch readout (never a value the gate hid),
          // unless the gate hid painted pitch after it (display only; user
          // decision 2026-10-21). Without the gate shownHnr === hnr.
          hnr: gateHid ? null : held.shownHnr,
        }));
      } else {
        // Prolonged silence: clear everything, including the paint
        // gate's established level — a new utterance after a long pause
        // should not be octave-judged against the pre-pause level.
        dspGateRef.current = { voiced: false, holding: false };
        pitchSmoothRef.current = [];
        f1SmoothRef.current = [];
        f2SmoothRef.current = [];
        f3SmoothRef.current = [];
        paintGateRef.current.reset();
        throttledSetState((s) => ({
          ...s,
          voiced: false,
          holding: false,
          pitchVoiced: false,
          pitchHolding: false,
          pitch: null,
          pitchLevel: null,
          intensity,
          noteName: null,
          steadiness: vadHide ? null : steady.value,
          steadinessHeld: vadHide ? false : steady.held,
          formants: { f1: null, f2: null, f3: null },
          spectralTilt: null,
          hnr: null,
        }));
      }
      if (DIAG_ENABLED) lastDisplayRef.current = { painted: false, shown: false, hidden: vadHide };
      // Notify frame callback (session recording) even during silence
      if (frameCallbackRef.current) {
        frameCallbackRef.current({
          voiced: false, f0: null, painted: false, f1: null, f2: null, f3: null,
          intensity, spectralTilt: null, hnr: null,
          ...(voiceGate ? { voiceGate } : {}),
        });
      }
      return;
    }

    // Audio is above silence threshold. Note the dspGateRef "voiced" flag
    // means "audio present" (not silence-gated) — it can be true on frames
    // where no pitch is detected (breath, fricatives, broadband noise).
    // The throttled state's `voiced` flag below is stricter: it requires a
    // displayable pitch this frame.
    dspGateRef.current = { voiced: true, holding: false };
    silenceStartRef.current = null;

    // Use detected pitch, or hold the last smoothed pitch across brief
    // SwiftF0 null gaps. The hold is bounded (pitchGate.js
    // PITCH_HOLD_MAX_MS): corpus measurement shows intra-speech null runs
    // are ~p99 ≤ 400 ms, so longer pitchless stretches are not speech
    // gaps — they're sustained pitchless audio (breath, noise) and must
    // render as an honest trace gap. The pre-2026-06 unbounded hold
    // painted a stale flat pitch line through such audio indefinitely
    // and recorded the frames as voiced at a stale F0.
    const effectivePitch = hasPitch
      ? pitch
      : (gate.holdAllowed && pitchSmoothRef.current.length > 0
        ? pitchSmoothRef.current[pitchSmoothRef.current.length - 1]
        : null);

    // Smooth pitch with a rolling median. Only new detections are pushed
    // — held values (SwiftF0 null but audio still loud enough) don't
    // enter the buffer so they can't stale-shift the median.
    let smoothedPitch = null;
    // A fresh detection an octave-class jump from the buffer median right
    // after a gap (a register switch) starts a new median instead of being
    // medianed against the previous word's values; a new or empty buffer is
    // seeded with the value so the median is always a real detection, never
    // the mean of two (pitchSmoothing.js smoothingBufferFor; measurements/
    // pitch-display-reacquire-2026-10-04.md §10). Held values never reach
    // this (hasPitch is false).
    if (hasPitch) pitchSmoothRef.current = smoothingBufferFor(pitchSmoothRef.current, pitch, freshAfterGap);
    if (effectivePitch !== null) {
      smoothedPitch = hasPitch
        ? pushAndMedianPitch(pitchSmoothRef.current, pitch, PITCH_SMOOTH_LEN)
        : median(pitchSmoothRef.current);
    } else if (pitchSmoothRef.current.length > 0) {
      // Hold window exhausted (or pitch-worker stale): reset the
      // smoothing buffer so the next utterance starts fresh instead of
      // being medianed against pre-gap values.
      pitchSmoothRef.current = [];
    }

    // Smooth formants with rolling median + outlier rejection.
    // Discard values that jump more than FORMANT_OUTLIER_HZ from the
    // current median — such spikes are measurement artifacts, not real
    // vocal tract changes.
    const f1 = formants?.f1
      ? pushAndMedianGated(f1SmoothRef, formants.f1, FORMANT_SMOOTH_LEN, FORMANT_OUTLIER_HZ)
      : median(f1SmoothRef.current);
    const f2 = formants?.f2
      ? pushAndMedianGated(f2SmoothRef, formants.f2, FORMANT_SMOOTH_LEN, FORMANT_OUTLIER_HZ)
      : median(f2SmoothRef.current);
    const f3 = formants?.f3
      ? pushAndMedianGated(f3SmoothRef, formants.f3, FORMANT_SMOOTH_LEN, FORMANT_OUTLIER_HZ)
      : median(f3SmoothRef.current);

    const framePitched = smoothedPitch !== null;

    // Decide whether to PAINT this frame's pitch. pitchPaintGate.js owns
    // onset confirmation AND the established-level excursion break: a
    // value an octave-class jump off the established pitch level is
    // suppressed (rendered as a gap) unless it sustains a consistent new
    // level — so transient 2x/3x/4x harmonic locks never paint, while
    // genuine register changes do. This replaced a consecutive-delta jump
    // break that the display median's octave ramps defeated (the
    // "testing 1 2 3" connected spike lines; see pitchPaintGate.js; the
    // 2026-06-10 excursion-break measurement is private, kept outside this
    // repo). Recording stays
    // per-frame truthful — this only governs the trace/readout.
    //
    // VOICED_FALL_FRAMES hysteresis: after this many consecutive
    // non-painted frames the display drops from the dim "holding" style
    // to inactive grey; in between it holds dim, so brief suppressions
    // (onset confirm, short excursions) don't strobe the readout.
    //
    // Held values (hold path: detector null, hold window open) are pushed
    // with fresh: false — they may bridge the trace on-level but never
    // move the gate's level or count toward a register change
    // (pitchPaintGate.js "Register re-acquisition").
    let displayPitched = false;
    if (framePitched) {
      // raw: the unsmoothed fresh detection — the gate accepts a register
      // change only when it agrees with the off-level run (pitchPaintGate.js
      // "Faster re-acquisition").
      displayPitched = paintGateRef.current.push(smoothedPitch, { fresh: hasPitch, raw: hasPitch ? pitch : null });
      if (!displayPitched && hasPitch && paintGateRef.current.lastReason() === "offlevel") {
        heldReadoutStaleRef.current = true;
      }
    } else {
      paintGateRef.current.resetSegment();
    }
    if (displayPitched) {
      heldReadoutStaleRef.current = false;
      displayVoicedRef.current = true;
      unpitchedFramesRef.current = 0;
    } else {
      unpitchedFramesRef.current++;
      if (unpitchedFramesRef.current >= VOICED_FALL_FRAMES) {
        displayVoicedRef.current = false;
      }
    }
    const displayHolding = !displayPitched && displayVoicedRef.current;
    // Dim held readout only while it is not known-stale (see
    // heldReadoutStaleRef): never show the other register's last value
    // while a fresh off-level pitch is suppressed.
    const showHeldReadout = displayHolding && !heldReadoutStaleRef.current && !vadHide;
    // What the display actually shows (the voice gate's mask).
    const shown = displayPitched && !vadHide;
    if (shown) gateHidPaintRef.current = false;
    else if (displayPitched) gateHidPaintRef.current = true;
    if (DIAG_ENABLED) lastDisplayRef.current = { painted: displayPitched, shown, hidden: vadHide };

    const noteInfo = displayPitched ? hzToNote(smoothedPitch) : null;
    const noteName = noteInfo?.name || null;
    const smoothedFormants = { f1, f2, f3 };

    // Update history buffers (always, at full rate — canvas reads these).
    // A pitchless or unconfirmed-onset frame renders as a trace gap even
    // though audio is present — the trace draws confirmed pitch only.
    //
    // Octave-class line break: a painted point ≥ EXCURSION_SEMI from the
    // previous painted point (an accepted register change, or a value
    // painted before the level engages) is preceded by a gap entry so the
    // canvas starts a new segment instead of stroking a near-vertical
    // connecting line — the 06-10 "spike line" artefact, now prevented by
    // construction rather than only by suppression.
    if (shown) {
      const prev = pitchTraceRef.current[pitchTraceRef.current.length - 1];
      if (prev && prev.voiced && prev.pitch !== null &&
          Math.abs(12 * Math.log2(smoothedPitch / prev.pitch)) >= EXCURSION_SEMI) {
        pitchTraceRef.current.push({ time: now, pitch: null, voiced: false });
      }
    }
    pitchTraceRef.current.push(
      shown
        ? { time: now, pitch: smoothedPitch, voiced: true }
        : { time: now, pitch: null, voiced: false },
    );
    trimHistory(pitchTraceRef.current, PITCH_TRACE_SECONDS * 1000, now);
    notifyTrace();
    // The level the readouts' target colour judges (display only — the
    // painted values themselves are untouched).
    const pitchLevel = shown ? pitchLevelAt(pitchTraceRef.current, now) : null;

    if (f1 !== null && f2 !== null) {
      formantTrailRef.current.push({ time: now, f1, f2, f3: f3, voiced: true });
      trimHistory(formantTrailRef.current, RESONANCE_TRACE_SECONDS * 1000, now);
    }

    // Use new values when provided, otherwise hold previous
    const currentTilt = spectralTilt ?? lastVoicedRef.current.spectralTilt;
    const currentHnr = hnr ?? lastVoicedRef.current.hnr;

    // Save as last voiced values (for hold behavior). On pitchless frames
    // the measured fields (formants/tilt/HNR) still update, but the last
    // displayed pitch is kept so hold states can dim-display it.
    lastVoicedRef.current = {
      pitch: shown ? smoothedPitch : lastVoicedRef.current.pitch,
      pitchLevel: shown ? pitchLevel : lastVoicedRef.current.pitchLevel,
      noteName: shown ? noteName : lastVoicedRef.current.noteName,
      formants: smoothedFormants,
      spectralTilt: currentTilt,
      hnr: currentHnr,
      // The readout below shows currentHnr unless the gate hides this frame.
      shownHnr: vadHide ? lastVoicedRef.current.shownHnr : currentHnr,
    };

    // Notify frame callback (session recording) with smoothed values.
    // Pitchless frames record voiced: false with f0 null — session stats
    // filter on `voiced && f0 !== null`, so phantom held pitch must not
    // be recorded as voiced (it skews avg F0 / time-in-target). Keyed on
    // hasPitch, NOT framePitched: on hold frames (detector null, hold
    // window open) framePitched is true with smoothedPitch = the stale
    // pre-gap median — recording that as voiced is exactly the phantom
    // pollution this comment forbids. The hold still bridges the DISPLAY
    // (trace/readout) via the paint path above; recording stays honest.
    if (frameCallbackRef.current) {
      frameCallbackRef.current({
        voiced: hasPitch,
        f0: hasPitch ? smoothedPitch : null,
        // Display decision for this frame (what the live trace painted).
        // Session history draws frames that are voiced AND painted, so
        // gate-suppressed excursions are gaps there too; hold-bridged
        // frames (painted live, recorded voiced:false above) are also gaps
        // in history — it is not an exact replica of the live trace
        // (2026-10-04). Stats keep using voiced/f0. A frame the voice
        // gate hid is not painted; voiceGate records the decision.
        painted: shown,
        ...(voiceGate ? { voiceGate } : {}),
        f1: f1,
        f2: f2,
        f3: f3,
        intensity,
        spectralTilt: currentTilt,
        hnr: currentHnr,
      });
    }

    // Throttled: only update React state for text readouts at ~5fps.
    // displayHolding bridges brief pitch dropouts in the dim style so
    // the readout/status never strobe between voiced and inactive.
    throttledSetState((s) => ({
      ...s,
      voiced: displayPitched,
      holding: displayHolding,
      pitchVoiced: shown,
      pitchHolding: displayHolding && !vadHide,
      pitch: shown ? smoothedPitch : (showHeldReadout ? lastVoicedRef.current.pitch : null),
      pitchLevel: shown ? pitchLevel : (showHeldReadout ? lastVoicedRef.current.pitchLevel : null),
      intensity,
      noteName: shown ? noteName : (showHeldReadout ? lastVoicedRef.current.noteName : null),
      steadiness: vadHide ? null : steady.value,
      steadinessHeld: vadHide ? false : steady.held,
      formants: smoothedFormants,
      spectralTilt: currentTilt,
      // Voice gate: HNR readout "—" while the gate hides (display only; the
      // recorded frame above keeps the measured value).
      hnr: vadHide ? null : currentHnr,
    }));
  }

  // Keep the latest handleAnalysisResult reachable from start()'s closure
  // via a ref. Updated post-render so it's safe under StrictMode and
  // concurrent rendering (refs must not be mutated during render).
  useEffect(() => { handleAnalysisResultRef.current = handleAnalysisResult; });


  return {
    ...state,
    start,
    stop,
    pitchTraceRef,
    subscribeTrace,
    formantTrailRef,
    genderStateRef,
    resonanceRef,
    heardAsRef,
    pitchOnlyRef,
    audioClockRef,
    setHeardAsEnabled,
    setVoiceGateEnabled,
    // Exposed so canvas-based components can read the DSP voicedness gate
    // at full rAF rate, bypassing the ~5 fps throttledSetState. Note the
    // ref's `voiced` means "audio present" (silence gate not engaged),
    // which is looser than the state's `voiced` flag (which additionally
    // requires a displayable pitch this frame).
    dspGateRef,
    frameCallbackRef,
    streamRef,
  };
}

function pushAndMedianGated(ref, value, maxLen, maxJump) {
  const current = median(ref.current);
  // If buffer is empty, accept any value
  if (current === null) {
    ref.current.push(value);
    return value;
  }
  // Clamp outliers toward the current median so the buffer can drift
  // toward the true value instead of getting permanently stuck
  const delta = value - current;
  const clamped = Math.abs(delta) > maxJump
    ? current + Math.sign(delta) * maxJump
    : value;
  ref.current.push(clamped);
  if (ref.current.length > maxLen) ref.current.shift();
  return median(ref.current);
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function trimHistory(arr, maxAgeMs, now) {
  const cutoff = now - maxAgeMs;
  while (arr.length > 0 && arr[0].time < cutoff) {
    arr.shift();
  }
}

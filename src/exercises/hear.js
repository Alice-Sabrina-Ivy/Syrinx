// hear.js — "Hear it first" (R4): Voice Shaper's controller (voice-preview/controller.js —
// its worker, WORLD analysis and render, unchanged) driven by the lesson. Record a phrase,
// then render resonance-only versions (pitch 0 st, formant scale ±HEAR_SHIFT_PCT %), kept
// side by side for playback. One instance per lesson run, created when the lesson opens and
// disposed when it closes (the worker and its WebAssembly memory go with it).
// docs/guided-exercises-design.md §4 (R4).
//
//   createHear({ shifts, createController }) -> { subscribe, getState, record, stop,
//     recordAgain, readyInMs, setShifts, dispose }
//   state { phase (the controller's), seconds (while recording), stage ("model" | … while
//     a noise-reduced analysis runs), original ({ pcm, rate } | null),
//     versions ({ [pct]: { pcm, rate } }) }

export function createHear({ shifts, createController }) {
  const ctl = createController();
  let wanted = [...shifts];
  let analysis = null;
  let state = { phase: "loading", seconds: null, stage: null, original: null, versions: {} };
  const listeners = new Set();

  function emit(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  /** Ask for every wanted version not rendered yet (the controller queues them). */
  function requestMissing(s) {
    if (s.phase !== "preview") return;
    for (const pct of wanted) {
      if (!state.versions[pct] && !(s.rendering && s.rendering.pct === pct)) ctl.render(0, pct);
    }
  }

  const unsub = ctl.subscribe((s) => {
    const patch = { phase: s.phase, seconds: s.level ? s.level.seconds : s.phase === "recording" ? 0 : null, stage: s.analysingStage };
    if (s.analysis !== analysis) {
      // a new recording (or none): the old versions go
      analysis = s.analysis;
      patch.versions = {};
      patch.original = s.analysis && s.original
        ? { pcm: s.original, rate: s.analysis.captureRate > 96000 ? s.analysis.rate : s.analysis.captureRate }
        : null;
    }
    if (s.preview && s.preview.st === 0 && !(patch.versions ?? state.versions)[s.preview.pct]) {
      patch.versions = { ...(patch.versions ?? state.versions), [s.preview.pct]: { pcm: s.preview.pcm, rate: s.preview.rate } };
    }
    emit(patch);
    requestMissing(s);
  });

  return {
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    getState: () => state,
    readyInMs: () => ctl.readyInMs(),
    record: () => ctl.record(),
    stop: () => ctl.stop(),
    /** A new recording: from a preview or an error the worker starts fresh (Voice Shaper's Record again). */
    recordAgain() {
      const phase = ctl.getState().phase;
      if (phase === "preview" || phase === "error" || phase === "memory") return ctl.recordAgain();
      return ctl.record();
    },
    setShifts(next) {
      wanted = [...next];
      requestMissing(ctl.getState());
    },
    dispose() {
      unsub();
      listeners.clear();
      ctl.dispose();
    },
  };
}

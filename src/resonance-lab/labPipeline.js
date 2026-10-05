// labPipeline.js — main-thread side of the resonance lab (?resonance=lab only).
//
// Dynamically imported by useAudioPipeline when the flag is set: spawns the
// lab worker, hands it one extra consumer port on the existing capture
// source (the production workers' ports are untouched), and keeps a small
// observable store the lazy LabView reads.

const HISTORY_S = 180;
const listeners = new Set();
let state = initialState();

function initialState() {
  return {
    running: false,
    dsp: "idle",          // idle | loading | ready | error
    pnml: "idle",         // idle | loading | ready | error
    pnmlProgress: null,
    error: null,
    reference: null,
    snapshot: null,
    perf: null,
    history: [],          // [{t, u: {vtln, pnml, le, fv}}]
    startedAt: null,
  };
}

function set(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
export const getState = () => state;

let worker = null;

export function startLab(captureSrc) {
  stopLab();
  set({ ...initialState(), running: true, dsp: "loading", startedAt: Date.now() });
  worker = new Worker(new URL("./lab-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "status") {
      if (m.part === "dsp") set({ dsp: m.status, error: m.status === "error" ? m.message : state.error, reference: m.reference ?? state.reference });
      else if (m.status === "loading") set({ pnml: "loading", pnmlProgress: m.progress ?? state.pnmlProgress });
      else if (m.status === "ready" || m.status === "error") set({ pnml: m.status, pnmlError: m.message ?? null });
    } else if (m.type === "state") {
      const s = m.snapshot;
      const u = {};
      for (const [k, v] of Object.entries(s.finalists)) u[k] = v?.u ?? null;
      const history = [...state.history, { t: s.t, u }].filter((h) => h.t >= s.t - HISTORY_S);
      set({ snapshot: s, perf: m.perf, history });
    }
  };
  worker.onerror = (e) => set({ dsp: "error", error: e.message || "lab worker failed" });
  worker.postMessage({ type: "init", sampleRate: captureSrc.sampleRate, assetBase: import.meta.env.BASE_URL });
  const port = captureSrc.connectConsumer();
  worker.postMessage({ type: "audioPort", port }, [port]);
  return { stop: stopLab };
}

export function stopLab() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (state.running) set({ running: false });
}

export function resetReadings() {
  worker?.postMessage({ type: "reset" });
  set({ history: [] });
}

export function downloadReadings() {
  const blob = new Blob([JSON.stringify({
    kind: "syrinx-resonance-lab",
    savedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    reference: state.reference,
    perf: state.perf,
    snapshot: state.snapshot,
    history: state.history,
  }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `resonance-lab-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// labPipeline.js — main-thread side of the resonance lab (started once its tab is opened).
//
// Dynamically imported by useAudioPipeline once the lab tab has been opened: spawns the
// lab worker, hands it one extra consumer port on the existing capture
// source (the production workers' ports are untouched), and keeps a small
// observable store the lazy LabView reads.

const HISTORY_S = 180;
// Weight x clarity view (measurements/weight-lab-prototype-2026-10-08.md):
// off until the user first opens the view; then on for the rest of the page
// visit. The frozen voice map is kept here (with the microphone it was made
// on, inside the map) so stopping and restarting listening keeps it.
let weightWanted = false;
let savedWeightMap = null;
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
    weight: weightWanted ? "loading" : "off", // off | loading | ready | error (weight x clarity view)
    weightError: null,
    weightSnap: null,
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

/** captureSrc: the running capture source; opts.trackSettings: the mic track's getSettings(); opts.trackLabel: its label. */
export function startLab(captureSrc, opts = {}) {
  stopLab();
  set({ ...initialState(), running: true, dsp: "loading", startedAt: Date.now() });
  worker = new Worker(new URL("./lab-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "status") {
      if (m.part === "dsp") set({ dsp: m.status, error: m.status === "error" ? m.message : state.error, reference: m.reference ?? state.reference });
      else if (m.status === "loading") set({ pnml: "loading", pnmlProgress: m.progress ?? state.pnmlProgress });
      else if (m.part === "weight") set({ weight: m.status, weightError: m.status === "error" ? m.message ?? null : null });
      else if (m.status === "ready" || m.status === "error") set({ pnml: m.status, pnmlError: m.message ?? null });
    } else if (m.type === "state") {
      const s = m.snapshot;
      const u = {};
      for (const [k, v] of Object.entries(s.finalists)) u[k] = v?.u ?? null;
      const history = [...state.history, { t: s.t, u }].filter((h) => h.t >= s.t - HISTORY_S);
      set({ snapshot: s, perf: m.perf, history, weightSnap: m.weight ?? state.weightSnap });
    } else if (m.type === "weightMap") {
      savedWeightMap = m.map;
    }
  };
  worker.onerror = (e) => set({ dsp: "error", error: e.message || "lab worker failed" });
  const ts = opts.trackSettings ?? null;
  const capture = {
    autoGainControl: typeof ts?.autoGainControl === "boolean" ? ts.autoGainControl : undefined,
    deviceId: ts?.deviceId || undefined,
    groupId: ts?.groupId || undefined,
    label: opts.trackLabel || undefined,
  };
  worker.postMessage({ type: "init", sampleRate: captureSrc.sampleRate, assetBase: import.meta.env.BASE_URL, capture });
  const port = captureSrc.connectConsumer();
  worker.postMessage({ type: "audioPort", port }, [port]);
  if (weightWanted) worker.postMessage({ type: "weight", cmd: "enable", map: savedWeightMap });
  return { stop: stopLab };
}

export function stopLab() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (state.running) set({ running: false });
}

/** The weight x clarity view was opened: start its analysis (now, or with the next lab start). */
export function enableWeight() {
  if (weightWanted) return;
  weightWanted = true;
  if (worker) {
    set({ weight: "loading" });
    worker.postMessage({ type: "weight", cmd: "enable", map: savedWeightMap });
  }
}

/** Mapping step: "start" | "next" | "finish" | "cancel". */
export function weightCommand(cmd) {
  worker?.postMessage({ type: "weight", cmd });
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
    weight: state.weightSnap,
  }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `resonance-lab-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

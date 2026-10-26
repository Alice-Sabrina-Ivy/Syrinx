// panel-force.mjs — puts the "Likely heard as" panel of a RUNNING app page
// (built app or dev server, driven by puppeteer) into a chosen state, for
// screenshots and layout checks. Test-only: nothing here ships, and nothing in
// src/ changes — the page's own React tree is reached through the fiber that
// React attaches to the panel's DOM node.
//
//   import { PANEL_STATES, installPanelForce, forcePanel } from "./panel-force.mjs";
//   await installPanelForce(page);        // once, with the panel switched on
//   await forcePanel(page, PANEL_STATES["mostly-man"]);   // then wait >= 2.1 s (the panel's cadence)
//
// What it does in the page:
//   * replaces heardAsRef.current.estimate (the aggregator the panel polls
//     every 2 s) with one that returns the forced estimate — the panel then
//     draws it through its normal path (heardAsShares -> heardAsAxis), so the
//     words and geometry are the shipped ones for that estimate;
//   * replaces the pitch-only warning's answer (update / held) with the
//     state's `pitchOnly` (false unless set), so a forced jump in pitch never
//     adds its note, and a state with pitchOnly: true shows it — the note is
//     then drawn through the panel's normal path too;
//   * sets the hook's modelStatus / modelProgress (the useAudioPipeline state
//     object) to "ready", "loading" or "error".
// Run it with the voice-model hosts unreachable (CHROME_BLOCK_MODEL_ARGS):
// the gender worker then fails at once instead of downloading 42 MB, and no
// late worker message overrides the forced status.

import { HEARD_AS_CALIBRATION as C } from "../../src/ml/heardAsCalibration.js";

// Chrome flags that make the model download fail immediately (no network).
export const CHROME_BLOCK_MODEL_ARGS = [
  "--host-resolver-rules=MAP huggingface.co ~NOTFOUND, MAP *.huggingface.co ~NOTFOUND, MAP *.hf.co ~NOTFOUND",
];

// An estimate whose eta (heardAsEta) is the given value, at a fixed F0.
export function estimateAtEta(eta, { f0 = 150, ageMs = 0 } = {}) {
  const lnF0 = Math.log(f0);
  const meterLogit = (eta - C.a - C.bLnF0 * lnF0) / C.bMeter;
  return { meterLogit, lnF0, nWindows: 40, voicedMs: 5000, ageMs };
}

// The states screenshots are taken in (name -> { status, progress?, estimate, pitchOnly? }).
// The panel draws three parts adding to 10 (user decision 2026-10-26; at
// F0 150 Hz): eta -2.75 = man 0 / unsure 1 / woman 9 ("clear-woman"),
// 2 = 8 / 2 / 0 ("clear-man"), -1.5 = 1 / 2 / 7 ("mixed-unsure": the line
// under the sentence names all three), 0 = "Could go either way" (wide,
// "split"); |eta| <= ~1.3 is split (calibration: range +/- 2.25 logit). The
// F0 changes the tenths slightly; the older names are kept for
// panel-shots.mjs callers.
export const PANEL_STATES = {
  "clear-woman": { status: "ready", estimate: estimateAtEta(-2.75) },
  "clear-man": { status: "ready", estimate: estimateAtEta(2.0) },
  "mixed-unsure": { status: "ready", estimate: estimateAtEta(-1.5) },
  split: { status: "ready", estimate: estimateAtEta(0) },
  "mostly-man": { status: "ready", estimate: estimateAtEta(4.0, { f0: 100 }) },
  mixed: { status: "ready", estimate: estimateAtEta(-2.0, { f0: 190 }) },
  "mostly-woman": { status: "ready", estimate: estimateAtEta(-4.0, { f0: 240 }) },
  "very-uncertain": { status: "ready", estimate: estimateAtEta(1.5, { f0: 130 }) },
  "cant-tell": { status: "ready", estimate: estimateAtEta(0, { f0: 150 }) },
  "keep-talking": { status: "ready", estimate: { hidden: "short", nWindows: 4, voicedMs: 600 } },
  loading: { status: "loading", progress: { loaded: 42, total: 100, file: "model.onnx" }, estimate: null },
  error: { status: "error", estimate: null },
  "older-reading": { status: "ready", estimate: estimateAtEta(2.5, { f0: 110, ageMs: 3200 }) },
  "pitch-only": { status: "ready", estimate: estimateAtEta(-2.0, { f0: 190 }), pitchOnly: true },
};

// Every state the panel can draw, for the one-height check: each hide reason
// (incl. both "short" words and the three loading texts), every estimate
// word-form (a grid of eta, incl. "nearly all" / "fewer than 1" ends), fresh
// and older, each also with the pitch-only note.
export function allPanelStates() {
  const out = [];
  for (const p of [null, { loaded: 7, total: 100 }, { loaded: 100, total: 100 }]) out.push({ name: `loading-${p ? p.loaded : "null"}`, status: "loading", progress: p, estimate: null });
  out.push({ name: "error", status: "error", estimate: null });
  for (const h of ["listening", "sustained", "stale", "outside"]) out.push({ name: h, status: "ready", estimate: { hidden: h } });
  out.push({ name: "short", status: "ready", estimate: { hidden: "short", nWindows: 3, voicedMs: 500 } });
  out.push({ name: "unvoiced", status: "ready", estimate: { hidden: "short", nWindows: 50, voicedMs: 100 } });
  for (const eta of [-4.4, -4, -3.5, -3, -2.5, -2, -1.5, -1, 0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.6]) {
    // (every line-under-the-sentence form: "fewer than 1", 1 / 2 unsure, with and without the other side)
    for (const ageMs of [0, 3200]) for (const pitchOnly of [false, true]) {
      out.push({ name: `eta${eta}${ageMs ? "-older" : ""}${pitchOnly ? "-pitch-only" : ""}`, status: "ready", estimate: estimateAtEta(eta, { ageMs }), pitchOnly });
    }
  }
  return out;
}

// In the page: locate the panel's props and the hook's state, and install the
// forced estimate. Returns what it found (for the caller's log / check).
export const installPanelForce = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-heard-as]");
  if (!el) return { ok: false, why: "no panel" };
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return { ok: false, why: "no React fiber on the panel" };
  let f = el[key], props = null, hook = null;
  for (let g = f; g && !(props && hook); g = g.return) {
    if (!props && g.memoizedProps?.heardAsRef) props = g.memoizedProps;
    if (!hook && (g.tag === 0 || g.tag === 11 || g.tag === 15)) {
      for (let h = g.memoizedState; h; h = h.next) {
        const s = h.memoizedState;
        if (s && typeof s === "object" && "modelStatus" in s && h.queue?.dispatch) { hook = h; break; }
      }
    }
  }
  if (!props) return { ok: false, why: "no HeardAsPanel props" };
  if (!hook) return { ok: false, why: "no useAudioPipeline state" };
  const agg = props.heardAsRef.current;
  if (!agg.__forceOrig) {
    agg.__forceOrig = agg.estimate;
    agg.estimate = function estimate(now, vs) { return window.__heardAsForced ?? agg.__forceOrig.call(this, now, vs); };
  }
  const w = props.pitchOnlyRef?.current;
  if (w && !w.__forceOrig) {
    w.__forceOrig = { update: w.update, held: w.held };
    w.update = () => window.__heardAsPitchOnly === true;
    w.held = () => window.__heardAsPitchOnly === true;
  }
  window.__heardAsSetStatus = (status, progress) => hook.queue.dispatch((s) => ({ ...s, modelStatus: status, modelProgress: progress ?? null, modelError: status === "error" ? "forced" : null }));
  return { ok: true };
});

// In the page: set one state (see PANEL_STATES / allPanelStates). A status
// change makes the panel recompute at once (its modelStatus effect), so a
// "ready" state goes through one "loading" frame first instead of waiting for
// the panel's 2 s tick. Resolves after two more frames.
export const forcePanel = (page, st) => page.evaluate(async (st) => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  window.__heardAsForced = st.estimate ?? { hidden: "listening" };
  window.__heardAsPitchOnly = st.pitchOnly === true;
  if (st.status === "ready") { window.__heardAsSetStatus("loading", null); await frame(); await frame(); }
  window.__heardAsSetStatus(st.status, st.progress ?? null);
  await frame(); await frame();
}, st);

// react-mock.mjs — minimal single-render React for driving the REAL
// src/audio/useAudioPipeline.js in Node: the hook body is evaluated once,
// its refs/state stay alive, and the oracle then calls the hook's own
// handleAnalysisResult closure frame by frame. (From the 2026-10-03
// display workstream's real-hook driver.)
export const M = { state: null, refs: [], effects: [] };
export function useState(init) {
  M.state = typeof init === "function" ? init() : init;
  const set = (u) => { M.state = typeof u === "function" ? u(M.state) : u; };
  return [M.state, set];
}
export function useRef(init) { const r = { current: init }; M.refs.push(r); return r; }
export function useCallback(fn) { return fn; }
export function useEffect(fn) { M.effects.push(fn); }
export default { useState, useRef, useCallback, useEffect };

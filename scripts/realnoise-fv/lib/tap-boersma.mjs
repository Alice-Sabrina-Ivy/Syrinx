// tap-boersma.mjs — scripts/session-oracle/lib/tap-boersma.mjs (observation-
// only shim between pitch-worker.js and the REAL boersma-ac.js of the same
// src tree) plus one COUNTERFACTUAL switch for the attribution runs:
// globalThis.__RN_CF.noGuard makes the harmonic guard keep every frame.
// Without __RN_CF the shim is observation-only (return values untouched).
const R = await import(new URL(import.meta.url).searchParams.get("real"));
export const BOERSMA_FRAME_LENGTH_16K = R.BOERSMA_FRAME_LENGTH_16K;
export const BOERSMA_DEFAULTS = R.BOERSMA_DEFAULTS;
export const PATH_DEFAULTS = R.PATH_DEFAULTS;
export const harmonicStructureCount = R.harmonicStructureCount;
export function createHarmonicVoicingGuard(...a) {
  const g = R.createHarmonicVoicingGuard(...a);
  const check = g.check;
  g.check = (...ca) => {
    let v = check.apply(g, ca);
    if (globalThis.__RN_CF?.noGuard) v = true;
    globalThis.__SO_TAP?.guard?.(v, ca[1], ca[0]);
    return v;
  };
  return g;
}
export function createBoersmaAC(...a) {
  const d = R.createBoersmaAC(...a);
  const cand = d.candidates;
  d.candidates = (buf) => { const fc = cand.call(d, buf); globalThis.__SO_TAP?.cand(fc, d); return fc; };
  return d;
}
export function createPathTracker(...a) {
  const t = R.createPathTracker(...a);
  const emit = t.emit;
  t.emit = (fc) => { const v = emit.call(t, fc); globalThis.__SO_TAP?.emit(v, t); return v; };
  globalThis.__SO_TAP?.tracker(t);
  return t;
}

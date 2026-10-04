// tap-boersma.mjs — observation-only shim between pitch-worker.js and the
// REAL boersma-ac.js of the same src tree (URL in ?real=). Re-exports the
// four names the worker imports; wraps detector.candidates() and
// tracker.emit() so globalThis.__SO_TAP sees every frame's candidate set
// and every decode. Return values pass through untouched, so the posted
// stream is bit-identical to an untapped worker (README: run with
// SO_TAP=0 and compare the post/conf columns).
const R = await import(new URL(import.meta.url).searchParams.get("real"));
export const BOERSMA_FRAME_LENGTH_16K = R.BOERSMA_FRAME_LENGTH_16K;
export const createHarmonicVoicingGuard = R.createHarmonicVoicingGuard;
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

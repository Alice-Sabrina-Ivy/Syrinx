// preview.js — the voice preview's analyse-once / render-on-demand engine (WORLD,
// F0 front end F-S), run inside the voice-preview worker (../vp-worker.js) and in
// Node by the tests.
//
//   analyse: capture-rate PCM + the posted pitch track (one value per 25 ms chunk,
//     0 = unvoiced) -> engine rate r (the capture rate up to 48 kHz; above that the
//     resonance lab's sinc resampler down to 48 kHz, cutoff 0.45 r) -> F-S frames ->
//     StoneMask, CheapTrick, D4C -> the first render, the unchanged rebuild (0 st, x1.00)
//   render (st, pct): f0 x 2^(st/12), formant warp by a = (100 + pct) / 100, synthesis,
//     finish (RMS-matched to the input, peak <= 0.99), float32 at r
//
// Carried over from the Phase 0 spike (scripts/voice-preview/lib/preview-core.js at
// 3f7603f, engine "world", front end "S"). The arithmetic is unchanged: every render is
// bit-identical to the spike's (tests/voice-preview/parity-test.js). WORLD reseeds its
// noise on every Synthesis() call, so a render depends only on the analysis and
// (st, pct), never on earlier renders.
// measurements/voice-preview-phase1-2026-10-19.md §5.
import { createSincResampler } from "../../resonance-lab/sinc-resampler.js";
import { WorldSession } from "./world.js";
import { finish } from "./finish.js";
import { postedToFrames } from "./frontend.js";
import { formantScale } from "../controls.js";

const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
const CHUNK_S = 0.025;

/** WORLD runs at the capture rate up to 48 kHz; faster captures are resampled down (never up). */
export const MAX_ENGINE_RATE = 48000;
export const engineRateFor = (srIn) => (srIn <= MAX_ENGINE_RATE ? srIn : MAX_ENGINE_RATE);

/** Resample a whole clip with the lab's streaming sinc resampler (cutoff 0.45 r). */
export function resampleClip(pcm, srIn, r) {
  if (srIn === r) return Float32Array.from(pcm);
  const nOut = Math.round(pcm.length * r / srIn);
  const rs = createSincResampler(srIn, r, { cutoffHz: 0.45 * r });
  const out = new Float32Array(nOut);
  const C = Math.round(srIn * CHUNK_S);
  let m = 0;
  const take = (y) => { const k = Math.min(y.length, nOut - m); out.set(y.subarray(0, k), m); m += k; };
  for (let k = 0; k < pcm.length && m < nOut; k += C) take(rs(pcm.subarray(k, Math.min(pcm.length, k + C))));
  const zeros = new Float32Array(C);
  for (let guard = 0; m < nOut && guard < 64; guard++) take(rs(zeros));
  if (m < nOut) throw new Error(`resampler produced ${m} of ${nOut} samples`);
  return out;
}

export class PreviewEngine {
  /** world: createWorld() result for the loaded module. */
  constructor(world) {
    this.world = world;
    this.session = null;
    this.x = null;
    this.rate = null;
  }

  /**
   * pcm: Float32Array at the capture rate srIn; posted: the F-S track (one value per
   * 25 ms capture chunk, Hz, 0 = unvoiced). Returns { rebuild, rate, ms }: the unchanged
   * rebuild (0 st, x1.00), finished, and per-stage milliseconds.
   */
  analyse(pcm, srIn, posted, { framePeriod = 5 } = {}) {
    const ms = {};
    const T0 = now();
    this.free();
    const rate = engineRateFor(srIn);
    let t0 = now();
    const x = resampleClip(pcm, srIn, rate);
    ms.resample = now() - t0;
    this.x = x;
    this.rate = rate;
    const s = new WorldSession(this.world, x, rate, { framePeriod });
    this.session = s;
    t0 = now();
    const init = postedToFrames(posted, x.length, rate, framePeriod);
    ms.frontEnd = now() - t0;
    Object.assign(ms, s.analyse(init));
    const r = this.render(0, 0);
    Object.assign(ms, r.ms);
    ms.total = now() - T0;
    return { rebuild: r.pcm, rate, ms };
  }

  /** One slider change: st semitones, pct percent formant scale. Returns { pcm (finished float32 at rate), ms }. */
  render(st, pct) {
    if (!this.session) throw new Error("render before analyse");
    const ms = {};
    const T0 = now();
    const r = this.session.render(st, formantScale(pct));
    Object.assign(ms, r.ms);
    const t1 = now();
    const pcm = finish(r.y, this.x);
    ms.finish = now() - t1;
    ms.render = now() - T0;
    return { pcm, ms };
  }

  memoryBytes() { return this.world.memoryBytes(); }

  /** Frees the session's WebAssembly buffers (the heap itself never shrinks). */
  free() {
    if (this.session) this.session.free();
    this.session = null;
    this.x = null;
  }
}

// world.js — JavaScript binding for the voice preview's WORLD WebAssembly
// module (src/voice-preview/wasm/, built from scripts/voice-preview/wasm/vp_world.cpp
// by scripts/voice-preview/build.mjs). Runs unchanged in a module Worker and Node 24.
//
// Carried over from the Phase 0 spike (scripts/voice-preview/lib/world-engine.js at
// 3f7603f) with the Harvest / DIO stage helpers dropped: the app's only F0 front end
// is F-S (Syrinx's posted pitch track, refined here by StoneMask). The arithmetic is
// unchanged (bit-identity: tests/voice-preview/parity-test.js).
//
//   createWorld(mod)   allocation helpers, FFT size, synthesis length, and the formant
//                      envelope warp as a stage function (tests/voice-preview/warp-test.js)
//   WorldSession       the clip, its F0, envelope and aperiodicity stay in WebAssembly
//                      memory after analysis; render(st, a) = pitch shift + formant warp +
//                      synthesis. WebAssembly memory grows and never shrinks: the app
//                      releases it by terminating the worker (Discard, Record again).
//
// Defaults are pyworld 0.3.5's: CheapTrick q1 -0.15, f0_floor 71, FFT size by WORLD's
// rule; D4C threshold 0.85 with the CheapTrick FFT size; 5 ms frames.

export const PYWORLD_DEFAULTS = Object.freeze({
  framePeriod: 5, f0Floor: 71, q1: -0.15, threshold: 0.85,
});

// A 1-function module that uses one SIMD128 instruction (i8x16.popcnt on a
// splat); WebAssembly.validate() on it is true only where fixed-width SIMD runs.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
export const simdSupported = () => {
  try { return WebAssembly.validate(SIMD_PROBE); } catch { return false; }
};

/** Pitch factor for a shift in semitones (unvoiced frames stay 0 after multiplying). */
export const pitchFactor = (st) => 2 ** (st / 12);

/** An allocation that failed: the worker reports it as error { kind: "memory" }. */
export class WorldMemoryError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorldMemoryError";
    this.kind = "memory";
  }
}

export function createWorld(mod) {
  const F = (ptr) => ptr >> 3;
  const heap = () => mod.HEAPF64; // re-read after every call: memory may grow
  const alloc = (n) => {
    const p = mod._malloc(Math.max(1, n) * 8);
    if (!p) throw new WorldMemoryError(`WebAssembly malloc of ${n} doubles failed`);
    return p;
  };
  const put = (arr) => {
    const p = alloc(arr.length);
    heap().set(arr, F(p));
    return p;
  };
  const get = (p, n) => heap().slice(F(p), F(p) + n);
  const free = (...ps) => { for (const p of ps) if (p) mod._free(p); };

  const W = {
    mod, alloc, put, get, free, heap,
    memoryBytes: () => heap().buffer.byteLength,
    fftSize: (fs, f0Floor = PYWORLD_DEFAULTS.f0Floor) => mod._vp_cheaptrick_fft_size(fs, f0Floor),
    synthesisLength: (nf, fp, fs) => mod._vp_synthesis_length(nf, fp, fs),
    /** The formant envelope warp (vp_warp) on copies: sp / ap are flat nf x (fftSize / 2 + 1). */
    warp(sp, ap, nf, fftSize, fs, a) {
      const n = sp.length;
      const ps = put(sp), pa = put(ap), qs = alloc(n), qa = alloc(n);
      try {
        mod._vp_warp(ps, pa, nf, fftSize, fs, a, qs, qa);
        return { sp: get(qs, n), ap: get(qa, n) };
      } finally { free(ps, pa, qs, qa); }
    },
  };
  return W;
}

const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

/**
 * The preview engine for one recording. x: the clip at the WORLD rate (any array
 * type; kept as float64 in WebAssembly memory). analyse() takes the F-S front end's
 * initial F0 on WORLD frames ({ f0, t }) and builds F0 / envelope / aperiodicity
 * once; render() is one slider change.
 */
export class WorldSession {
  constructor(world, x, fs, { framePeriod = PYWORLD_DEFAULTS.framePeriod } = {}) {
    this.W = world;
    this.fs = fs;
    this.fp = framePeriod;
    this.n = x.length;
    this.bufs = [];
    this.px = world.put(x instanceof Float64Array ? x : Float64Array.from(x));
    this.fft = world.fftSize(fs);
    this.nb = this.fft / 2 + 1;
  }

  _keep(n) { const p = this.W.alloc(n); this.bufs.push(p); return p; }

  /** init: { f0, t } on WORLD frames, refined by StoneMask. Returns per-stage milliseconds. */
  analyse(init) {
    const { W, fs, fp, n, px } = this;
    const mod = W.mod;
    const ms = {};
    const nf = init.f0.length;
    this.nf = nf;
    this.pt = this._keep(nf);
    this.pf0 = this._keep(nf);
    const praw = this._keep(nf);
    const d = PYWORLD_DEFAULTS;
    W.heap().set(init.t, this.pt >> 3);
    W.heap().set(init.f0, praw >> 3);
    let t0 = now();
    mod._vp_stonemask(px, n, fs, this.pt, praw, nf, this.pf0);
    ms.stonemask = now() - t0;
    const total = nf * this.nb;
    this.psp = this._keep(total);
    this.pap = this._keep(total);
    t0 = now();
    mod._vp_cheaptrick(px, n, fs, this.pt, this.pf0, nf, d.q1, d.f0Floor, this.fft, this.psp);
    ms.cheaptrick = now() - t0;
    t0 = now();
    mod._vp_d4c(px, n, fs, this.pt, this.pf0, nf, this.fft, d.threshold, this.pap);
    ms.d4c = now() - t0;
    // render buffers (allocated once)
    this.pf0r = this._keep(nf);
    this.pspw = this._keep(total);
    this.papw = this._keep(total);
    this.ny = mod._vp_synthesis_length(nf, fp, fs);
    this.py = this._keep(this.ny);
    return ms;
  }

  /** Refined F0 on WORLD frames (a copy). */
  f0() { return this.W.get(this.pf0, this.nf); }

  /**
   * One render: f0 * 2^(st/12) on voiced frames, envelope warp by a, synthesis.
   * Returns { y: Float64Array of the input length (before finish), ms }.
   */
  render(st, a) {
    const { W, nf, fs, fp } = this;
    const mod = W.mod;
    const ms = {};
    let t0 = now();
    const H = W.heap();
    const k = pitchFactor(st);
    const f0 = this.pf0 >> 3, f0r = this.pf0r >> 3;
    for (let i = 0; i < nf; i++) H[f0r + i] = H[f0 + i] * k;
    let ps = this.psp, pa = this.pap;
    if (a !== 1) {
      mod._vp_warp(this.psp, this.pap, nf, this.fft, fs, a, this.pspw, this.papw);
      ps = this.pspw; pa = this.papw;
    }
    ms.warp = now() - t0;
    t0 = now();
    mod._vp_synthesize(this.pf0r, nf, ps, pa, this.fft, fp, fs, this.ny, this.py);
    ms.synth = now() - t0;
    const y = new Float64Array(this.n); // trimmed or zero-padded to the input length
    const H2 = W.heap();
    const py = this.py >> 3;
    y.set(H2.subarray(py, py + Math.min(this.ny, this.n)));
    return { y, ms };
  }

  free() {
    this.W.free(this.px, ...this.bufs);
    this.bufs = [];
    this.px = 0;
  }
}

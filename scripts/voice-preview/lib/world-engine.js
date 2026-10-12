// world-engine.js — JavaScript binding for the voice-preview spike's WORLD
// WebAssembly module (wasm/vp_world.cpp, built by build.mjs). Runs unchanged in
// a module Worker, a page and Node 24.
//
// Two layers:
//   createWorld(mod)    stage functions that copy in and out of WebAssembly
//                       memory (dio, harvest, stonemask, cheaptrick, d4c, warp,
//                       synthesize) — what the parity runner compares with pyworld
//   WorldSession        the preview engine: the clip, its F0, envelope and
//                       aperiodicity stay in WebAssembly memory after analysis;
//                       render(st, a) = pitch shift + formant warp + synthesis
//
// Defaults are pyworld 0.3.5's (DIO / Harvest 71-800 Hz, DIO channels_in_octave 2,
// speed 1, allowed_range 0.1; CheapTrick q1 -0.15, f0_floor 71, FFT size by WORLD's
// rule; D4C threshold 0.85 with the CheapTrick FFT size at f0_floor 71).

export const PYWORLD_DEFAULTS = Object.freeze({
  framePeriod: 5, f0Floor: 71, f0Ceil: 800, channelsInOctave: 2, speed: 1, allowedRange: 0.1,
  q1: -0.15, threshold: 0.85,
});

// A 1-function module that uses one SIMD128 instruction (i8x16.popcnt on a
// splat); WebAssembly.validate() on it is true only where fixed-width SIMD runs.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
export const simdSupported = () => {
  try { return WebAssembly.validate(SIMD_PROBE); } catch { return false; }
};

/** Pitch factor for a shift in semitones (unvoiced frames stay 0 after multiplying). */
export const pitchFactor = (st) => 2 ** (st / 12);

export function createWorld(mod) {
  const F = (ptr) => ptr >> 3;
  const heap = () => mod.HEAPF64; // re-read after every call: memory may grow
  const alloc = (n) => {
    const p = mod._malloc(Math.max(1, n) * 8);
    if (!p) throw new Error(`WebAssembly malloc of ${n} doubles failed`);
    return p;
  };
  const put = (arr) => {
    const p = alloc(arr.length);
    heap().set(arr, F(p));
    return p;
  };
  const get = (p, n) => heap().slice(F(p), F(p) + n);
  const free = (...ps) => { for (const p of ps) if (p) mod._free(p); };
  const withX = (x, fn) => {
    const px = put(x instanceof Float64Array ? x : Float64Array.from(x));
    try { return fn(px); } finally { free(px); }
  };

  const W = {
    mod, alloc, put, get, free, heap,
    memoryBytes: () => heap().buffer.byteLength,
    dioFrames: (fs, n, fp) => mod._vp_dio_frames(fs, n, fp),
    harvestFrames: (fs, n, fp) => mod._vp_harvest_frames(fs, n, fp),
    fftSize: (fs, f0Floor = PYWORLD_DEFAULTS.f0Floor) => mod._vp_cheaptrick_fft_size(fs, f0Floor),
    synthesisLength: (nf, fp, fs) => mod._vp_synthesis_length(nf, fp, fs),

    dio(x, fs, o = {}) {
      const d = { ...PYWORLD_DEFAULTS, ...o };
      return withX(x, (px) => {
        const nf = mod._vp_dio_frames(fs, x.length, d.framePeriod);
        const pt = alloc(nf), pf = alloc(nf);
        try {
          mod._vp_dio(px, x.length, fs, d.framePeriod, d.f0Floor, d.f0Ceil, d.channelsInOctave, d.speed, d.allowedRange, pt, pf);
          return { f0: get(pf, nf), t: get(pt, nf) };
        } finally { free(pt, pf); }
      });
    },
    harvest(x, fs, o = {}) {
      const d = { ...PYWORLD_DEFAULTS, ...o };
      return withX(x, (px) => {
        const nf = mod._vp_harvest_frames(fs, x.length, d.framePeriod);
        const pt = alloc(nf), pf = alloc(nf);
        try {
          mod._vp_harvest(px, x.length, fs, d.framePeriod, d.f0Floor, d.f0Ceil, pt, pf);
          return { f0: get(pf, nf), t: get(pt, nf) };
        } finally { free(pt, pf); }
      });
    },
    stonemask(x, fs, t, f0) {
      return withX(x, (px) => {
        const pt = put(t), pf = put(f0), po = alloc(f0.length);
        try {
          mod._vp_stonemask(px, x.length, fs, pt, pf, f0.length, po);
          return get(po, f0.length);
        } finally { free(pt, pf, po); }
      });
    },
    cheaptrick(x, fs, t, f0, o = {}) {
      const d = { ...PYWORLD_DEFAULTS, ...o };
      const fft = d.fftSize || W.fftSize(fs, d.f0Floor);
      const nb = fft / 2 + 1;
      return withX(x, (px) => {
        const pt = put(t), pf = put(f0), ps = alloc(f0.length * nb);
        try {
          mod._vp_cheaptrick(px, x.length, fs, pt, pf, f0.length, d.q1, d.f0Floor, fft, ps);
          return { sp: get(ps, f0.length * nb), fftSize: fft };
        } finally { free(pt, pf, ps); }
      });
    },
    d4c(x, fs, t, f0, o = {}) {
      const d = { ...PYWORLD_DEFAULTS, ...o };
      const fft = d.fftSize || W.fftSize(fs, PYWORLD_DEFAULTS.f0Floor);
      const nb = fft / 2 + 1;
      return withX(x, (px) => {
        const pt = put(t), pf = put(f0), pa = alloc(f0.length * nb);
        try {
          mod._vp_d4c(px, x.length, fs, pt, pf, f0.length, fft, d.threshold, pa);
          return { ap: get(pa, f0.length * nb), fftSize: fft };
        } finally { free(pt, pf, pa); }
      });
    },
    warp(sp, ap, nf, fftSize, fs, a) {
      const n = sp.length;
      const ps = put(sp), pa = put(ap), qs = alloc(n), qa = alloc(n);
      try {
        mod._vp_warp(ps, pa, nf, fftSize, fs, a, qs, qa);
        return { sp: get(qs, n), ap: get(qa, n) };
      } finally { free(ps, pa, qs, qa); }
    },
    /** pyworld.synthesize: output length int(nf * framePeriod * fs / 1000). */
    synthesize(f0, sp, ap, fftSize, fs, framePeriod = PYWORLD_DEFAULTS.framePeriod) {
      const nf = f0.length, ny = mod._vp_synthesis_length(nf, framePeriod, fs);
      const pf = put(f0), ps = put(sp), pa = put(ap), py = alloc(ny);
      try {
        mod._vp_synthesize(pf, nf, ps, pa, fftSize, framePeriod, fs, ny, py);
        return get(py, ny);
      } finally { free(pf, ps, pa, py); }
    },
  };
  return W;
}

const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

/**
 * The preview engine for one recording. x: the clip at the WORLD rate (any array
 * type; kept as float64 in WebAssembly memory). analyse() takes the F0 front end's
 * initial F0 on WORLD frames (or null for Harvest / DIO run here) and builds
 * F0 / envelope / aperiodicity once; render() is one slider change.
 */
export class WorldSession {
  constructor(world, x, fs, { framePeriod = PYWORLD_DEFAULTS.framePeriod } = {}) {
    this.W = world;
    this.fs = fs;
    this.fp = framePeriod;
    this.n = x.length;
    this.px = world.put(x instanceof Float64Array ? x : Float64Array.from(x));
    this.fft = world.fftSize(fs);
    this.nb = this.fft / 2 + 1;
    this.bufs = [];
  }

  _keep(n) { const p = this.W.alloc(n); this.bufs.push(p); return p; }

  /**
   * frontEnd: "H" (Harvest, used directly), "D" (DIO + StoneMask), or
   * "init" with { f0, t } on WORLD frames (F-S / F-L) refined by StoneMask.
   * Returns per-stage milliseconds.
   */
  analyse(frontEnd, init = null) {
    const { W, fs, fp, n, px } = this;
    const mod = W.mod;
    const ms = {};
    let t0 = now();
    let nf;
    if (frontEnd === "H" || frontEnd === "D") {
      nf = frontEnd === "H" ? mod._vp_harvest_frames(fs, n, fp) : mod._vp_dio_frames(fs, n, fp);
    } else {
      nf = init.f0.length;
    }
    this.nf = nf;
    this.pt = this._keep(nf);
    this.pf0 = this._keep(nf);
    const praw = this._keep(nf);
    const d = PYWORLD_DEFAULTS;
    if (frontEnd === "H") {
      mod._vp_harvest(px, n, fs, fp, d.f0Floor, d.f0Ceil, this.pt, this.pf0);
      ms.frontEnd = now() - t0;
      ms.stonemask = 0;
    } else {
      if (frontEnd === "D") {
        mod._vp_dio(px, n, fs, fp, d.f0Floor, d.f0Ceil, d.channelsInOctave, d.speed, d.allowedRange, this.pt, praw);
        ms.frontEnd = now() - t0;
      } else {
        W.heap().set(init.t, this.pt >> 3);
        W.heap().set(init.f0, praw >> 3);
        ms.frontEnd = 0; // the caller times its own front end
      }
      t0 = now();
      mod._vp_stonemask(px, n, fs, this.pt, praw, nf, this.pf0);
      ms.stonemask = now() - t0;
    }
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
  times() { return this.W.get(this.pt, this.nf); }
  spectrogram() { return this.W.get(this.psp, this.nf * this.nb); }
  aperiodicity() { return this.W.get(this.pap, this.nf * this.nb); }

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

  /** The synthesis output before trimming (pyworld.synthesize's own length). */
  rawOutput() { return this.W.get(this.py, this.ny); }

  free() {
    this.W.free(this.px, ...this.bufs);
    this.bufs = [];
    this.px = 0;
  }
}

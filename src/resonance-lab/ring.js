// ring.js — absolute-index sample ring for the resonance-lab engine.
//
// Samples are addressed by their index since stream start. Reads outside
// the retained window (or before 0 / at-or-after the write head) return 0,
// matching the zero-padded framing of the Python prototypes (lefeat
// _frames). `clamped(i)` instead replicates the edge sample, matching
// WORLD CheapTrick's safe_index; `finish()` freezes the stream length so
// an offline (parity-test) run clamps at the true end of the clip.

export function createSampleRing(capacityPow2 = 1 << 15, ArrayType = Float32Array) {
  const cap = 1 << Math.ceil(Math.log2(capacityPow2));
  const mask = cap - 1;
  const buf = new ArrayType(cap);
  let end = 0;
  let finalLength = Infinity;
  return {
    get end() { return end; },
    get capacity() { return cap; },
    push(x) {
      for (let i = 0; i < x.length; i++) buf[(end + i) & mask] = x[i];
      end += x.length;
    },
    at(i) {
      if (i < 0 || i >= end || i < end - cap) return 0;
      return buf[i & mask];
    },
    clamped(i) {
      const hi = Math.min(end, finalLength) - 1;
      const j = i < 0 ? 0 : i > hi ? hi : i;
      if (j < end - cap) return 0;
      return buf[j & mask];
    },
    /** Copy n clamped samples starting at absolute index `start` into dst (CheapTrick framing). */
    readClamped(dst, start, n) {
      const hi = Math.min(end, finalLength) - 1;
      if (start >= 0 && start + n - 1 <= hi && start >= end - cap) {
        for (let i = 0; i < n; i++) dst[i] = buf[(start + i) & mask];
        return;
      }
      for (let i = 0; i < n; i++) {
        const j0 = start + i;
        const j = j0 < 0 ? 0 : j0 > hi ? hi : j0;
        dst[i] = j < end - cap ? 0 : buf[j & mask];
      }
    },
    finish() { finalLength = end; },
    reset() { end = 0; finalLength = Infinity; },
  };
}

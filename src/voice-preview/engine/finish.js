// finish.js — the last step of every voice-preview render: match the input's
// RMS over the whole clip, then scale down if the absolute peak exceeds 0.99;
// float32 out. The versions (rebuild, preview) therefore play at the same
// loudness as the recording.
//
// The spike's `finish` (scripts/voice-preview/lib/psola.js at 3f7603f, that
// function only), arithmetic unchanged (bit-identity: tests/voice-preview/parity-test.js).

/** y: the synthesis output (Float64Array, input length); x: the engine-rate input. */
export function finish(y, x) {
  let ry = 0, rx = 0;
  for (let i = 0; i < y.length; i++) ry += y[i] * y[i];
  for (let i = 0; i < x.length; i++) rx += x[i] * x[i];
  ry = Math.sqrt(ry / y.length); rx = Math.sqrt(rx / x.length);
  const out = new Float32Array(y.length);
  const s = ry > 0 ? rx / ry : 1;
  let pk = 0;
  for (let i = 0; i < y.length; i++) { out[i] = y[i] * s; pk = Math.max(pk, Math.abs(out[i])); }
  if (pk > 0.99) for (let i = 0; i < out.length; i++) out[i] *= 0.99 / pk;
  return out;
}

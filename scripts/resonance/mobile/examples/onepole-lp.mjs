// examples/onepole-lp.mjs — the module interface of perturb.mjs's "mod" transform:
// export apply(x: Float32Array, sr: number, params: object, ctx: {id, reader, sex, kind})
// returning a NEW Float32Array of the same length. Here: a one-pole low-pass at params.fc (Hz).
export function apply(x, sr, params = {}) {
  const fc = params.fc ?? 3000, a = Math.exp((-2 * Math.PI * fc) / sr), y = new Float32Array(x.length);
  let z = 0;
  for (let i = 0; i < x.length; i++) { z = (1 - a) * x[i] + a * z; y[i] = z; }
  return y;
}

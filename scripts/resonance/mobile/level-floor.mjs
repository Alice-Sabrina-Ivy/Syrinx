// level-floor.mjs — perturb.mjs "mod" transform: an additive self-noise floor
// at an ABSOLUTE level (not an SNR): params { dbfs = -80, kind = "white", seed = 7 }.
// The level is the noise's mean power on the 0-8 kHz band the chain hears
// (perturb.mjs meanLevelDb), so -80 here = -80 dBFS on perturb.mjs's scale.
import { makeNoise, meanLevelDb } from "./perturb.mjs";

export function apply(x, sr, params = {}) {
  const dbfs = params.dbfs ?? -80, kind = params.kind ?? "white", seed = params.seed ?? 7;
  const nz = makeNoise(kind, x.length, seed);
  const g = 10 ** ((dbfs - meanLevelDb(nz, sr)) / 20), y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] + g * nz[i];
  return y;
}

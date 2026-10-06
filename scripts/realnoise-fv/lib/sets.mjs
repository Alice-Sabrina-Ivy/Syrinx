// sets.mjs — clip sets and the tuning / held-out split for the real-noise
// false-voicing work (2026-10-05).
//
// Data: the real-data corpora of measurements/notch-realdata-corpora-
// 2026-10-05.md, read IN PLACE from $NOTCHVD_ROOT (or --data-root=, which
// must be applied before realdata.mjs is imported — see dataRoot()).
//
// Only PUBLIC sources are ever selected (allowlists below): the corpora may
// also hold an opt-in private source, which no result of this work uses.
//
// Split: a noise SOURCE group goes wholly to tuning or held-out, so a
// candidate is never scored on a recording it was tuned on (DCASE: all
// segments + anomaly clips of one machine id form one group; every other
// source: the clip). held-out = FNV-1a(group) % 3 === 0 (~1/3).
export const NOISE_SOURCES = ["freesound", "dcase", "mssnsd", "demand", "esc50"];
export const VOICE_SOURCES = ["vocalset", "ptdb", "pvqd", "fda", "vocadito", "voiced", "hillenbrand", "synthetic"];
// generated layers (the -70 dBFS / 3e-4 floor under gated and held-series mixes)
export const SYNTH_SOURCES = ["synthfloor"];

export function dataRoot(args) {
  if (args["data-root"]) process.env.NOTCHVD_ROOT = args["data-root"];
  if (!process.env.NOTCHVD_ROOT) throw new Error("set NOTCHVD_ROOT (or --data-root=) to the real-data corpora root (build/notchvd of the checkout that built them)");
  return process.env.NOTCHVD_ROOT;
}

export function noiseGroup(id) {
  const m = /^dcase__([A-Za-z]+)_(id\d+)_/.exec(id);
  return m ? `dcase:${m[1]}_${m[2]}` : id;
}
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export const isHeldOut = (noiseId) => fnv1a(noiseGroup(noiseId)) % 3 === 0;
export const splitOf = (noiseId) => (isHeldOut(noiseId) ? "held" : "tune");

// noise-only set = probe.mjs / realeval.mjs --set=noise: every non-duplicate
// public noise clip >= 10 s (first 90 s are run)
export function noiseSet(loadIndex) {
  return loadIndex("noise", { minDur: 10 })
    .filter((r) => NOISE_SOURCES.includes(r.source) && r.label !== "floor" && r.class !== "floor")
    .sort((a, b) => a.id.localeCompare(b.id));
}

// mixes whose every layer is a public clip
export function publicMixes(loadIndex, set) {
  const vp = new Map(loadIndex("voice", { noDup: false }).map((r) => [r.path, r.source]));
  const np = new Map(loadIndex("noise", { noDup: false }).map((r) => [r.path, r.source]));
  return loadIndex("mix", { set }).filter((m) => m.spec.layers.every((L) => {
    const s = vp.get(L.clip) ?? np.get(L.clip);
    return s !== undefined && (VOICE_SOURCES.includes(s) || NOISE_SOURCES.includes(s) || SYNTH_SOURCES.includes(s));
  })).sort((a, b) => a.id.localeCompare(b.id));
}

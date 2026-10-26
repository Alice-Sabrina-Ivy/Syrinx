// dfn3-model.js — where Voice Shaper's DeepFilterNet 3 graphs come from (no imports, so the
// tab's main chunk can pick the source without pulling in the port; ./dfn3.js loads them).

export const DFN3_MODEL = Object.freeze({
  repo: "https://github.com/Rikorose/DeepFilterNet",
  commit: "d375b2d8309e0935d165700c91da9de862a99c31",
  license: "MIT OR Apache-2.0",
  // models/DeepFilterNet3_onnx.tar.gz at the commit: 7,983,136 B, sha256 c94d91f7…; the three
  // graphs below are its members, byte for byte (tests/voice-preview/dfn3-test.js).
  archive: Object.freeze({ path: "models/DeepFilterNet3_onnx.tar.gz", bytes: 7983136, sha256: "c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616" }),
  // Hosting, as FireRedVAD's (src/dsp/firered-vad.js): the project's Hugging Face mirror of the
  // three graphs at a pinned commit, checked against the sha256 below and kept in Cache Storage.
  // null until the mirror exists: the app then loads them from `dir` under its base URL
  // (public/models/dfn3/ in a development tree: node scripts/fetch-dfn3-model.mjs
  // --out=public/models/dfn3); a deployed build without them reports noise reduction as
  // unavailable.
  mirror: "Alice-Sabrina-Ivy/deepfilternet3-onnx",
  mirrorCommit: null,
  dir: "models/dfn3/",
  files: Object.freeze([
    Object.freeze({ key: "enc", name: "enc.onnx", member: "tmp/export/enc.onnx", bytes: 1954042, sha256: "7c5399d3da8a50ebef1c1a0ae421b33376aa5e45d0e92df16da7e83c9c131916" }),
    Object.freeze({ key: "erbDec", name: "erb_dec.onnx", member: "tmp/export/erb_dec.onnx", bytes: 3292397, sha256: "ab669a1d10afe20911728b33053a452071042317a90581092b325da7b2f9d895" }),
    Object.freeze({ key: "dfDec", name: "df_dec.onnx", member: "tmp/export/df_dec.onnx", bytes: 3340803, sha256: "23114ce3b0f6464b763ee62f7bb8aab6b2a129a21eabd5bcfe59413db05f278a" }),
  ]),
  // tmp/export/config.ini (sha256 415eb925…): the [df] values DF below hard-codes
  configSha256: "415eb925d44990d938fb739f514aa3662c1ec0ea836cff044fa1291b82cb4290",
});

/** The Cache Storage name of each mirrored graph (loadVerifiedModel keeps one entry per cache). */
export const DFN3_CACHE_PREFIX = "syrinx-noise-reduction-";

/** { kind: "mirror", base } at the pinned commit, else { kind: "app", base } (appBaseUrl), else null. */
export function dfn3ModelSource({ appBaseUrl = null, model = DFN3_MODEL } = {}) {
  if (model.mirrorCommit) return { kind: "mirror", base: `https://huggingface.co/${model.mirror}/resolve/${model.mirrorCommit}/` };
  return appBaseUrl ? { kind: "app", base: appBaseUrl } : null;
}


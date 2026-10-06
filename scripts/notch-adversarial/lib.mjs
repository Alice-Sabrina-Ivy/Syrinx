// lib.mjs — drive the REAL pitch worker (2026-10-04 notch iteration round 1,
// adversarial suite). Each tree under build/notch-adv/trees/<name>/src
// (built by setup.sh) is a copy of src/ whose dsp/noise-notch.js is:
//   bc42 = bc42ad0's module, head = 6f8be18's (the in-sound latch, reverted
//   in round 1), r1 = cb00425's (round 1, N13), cand2 = cand2-notch.js
//   (round 2 option flags), cand3 = cand3-notch.js (2026-10-05 line-coherence
//   candidate flags), cand = cand-notch.js (option flags; globalThis.__NOTCH_OPTS
//   selects the variant), and SRC = the repo's src/ (the shipped module).
// Every pitch-worker.js copy is otherwise byte-identical to production.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { pushAndMedianPitch, PITCH_SMOOTH_LEN } from "../../src/audio/pitchSmoothing.js";
import { createPaintGate } from "../../src/audio/pitchPaintGate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const posts = [];
globalThis.self = { postMessage: (m) => posts.push(m) };
const H = {};
// NOTCH_ADV_TREES=name=path[,name=path...] (paths relative to the repo root)
// REPLACES the fixed tree list below: run the suite on any src trees, e.g.
// another work item's candidate trees (2026-10-05 review fix: the real-noise
// false-voicing candidate, build/rnfv-trees/{base0,fgA}/src). Every listed
// name is also a variant { tree: name } (variants.mjs).
const TREES = process.env.NOTCH_ADV_TREES
  ? process.env.NOTCH_ADV_TREES.split(",").map((s) => s.split("=")).map(([k, p]) => [k, path.resolve(ROOT, p)])
  : [["bc42", "../../build/notch-adv/trees/bc42/src"], ["head", "../../build/notch-adv/trees/head/src"], ["cand", "../../build/notch-adv/trees/cand/src"], ["r1", "../../build/notch-adv/trees/r1/src"], ["cand2", "../../build/notch-adv/trees/cand2/src"], ["cand3", "../../build/notch-adv/trees/cand3/src"], ["src", "../../src"]].map(([k, p]) => [k, path.join(HERE, p)]);
for (const [k, p] of TREES) {
  await import(pathToFileURL(path.join(p, "dsp/pitch-worker.js")).href);
  H[k] = globalThis.self.onmessage;
}

// runWorker(variant, x, sr): variant = { tree, opts? }. 25 ms chunks at sr.
export function runWorker(variant, x, sr) {
  posts.length = 0;
  const h = H[variant.tree];
  globalThis.__NOTCH_OPTS = variant.opts;
  h({ data: { type: "init", inputSampleRate: sr } });
  const port = {};
  h({ data: { type: "audioPort", port } });
  const C = Math.round(0.025 * sr);
  for (let c = 0; c + C <= x.length; c += C) {
    const chunk = Float32Array.from(x.subarray(c, c + C));
    port.onmessage({ data: { buffer: chunk.buffer, contextTime: (c + C) / sr } });
  }
  globalThis.__NOTCH_OPTS = undefined;
  return posts.filter((p) => p.type === "pitch").map((p) => ({ t: p.contextTime - 0.04, pitch: p.pitch, nf: p.notchedFreqs ?? null }));
}

// display replay (median-3 + paint gate; no hold bridging)
export function displayed(msgs) {
  const sm = []; const gate = createPaintGate();
  return msgs.map((m) => {
    if (!(m.pitch > 0)) { sm.length = 0; gate.resetSegment(); return 0; }
    const v = pushAndMedianPitch(sm, m.pitch, PITCH_SMOOTH_LEN);
    return gate.push(v) ? v : 0;
  });
}
export const parseArgs = () => Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));

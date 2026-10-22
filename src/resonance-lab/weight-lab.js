// weight-lab.js — the weight × clarity lab view's analysis: v5 frame features
// (weight-features.js) on the lab engine's 16 kHz stream at every posted
// voiced pitch frame, fed into the personal voice map (weight-map.js).
// Attached to the engine with engine.setFrameTap() only once the user opens
// the "Weight × clarity" view (measurements/weight-lab-prototype-2026-10-08.md).

import { createWeightFeatures, FRAME_N, SR } from "./weight-features.js";
import { createWeightMap } from "./weight-map.js";

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function createWeightLab(model, { now = clock } = {}) {
  const wf = createWeightFeatures(model);
  const map = createWeightMap();
  const x = new Float64Array(FRAME_N);
  let ms = 0;
  let featureFrames = 0;
  return {
    map,
    /** Engine frame tap: one posted pitch frame (t = frame centre, s) with the 16 kHz ring. */
    frame(t, f0, ring) {
      const t0 = now();
      let res = null;
      if (f0 > 0) {
        const i0 = Math.round(t * SR) - FRAME_N / 2;
        if (i0 >= 0 && i0 + FRAME_N <= ring.end && i0 >= ring.end - ring.capacity) {
          ring.readClamped(x, i0, FRAME_N);
          res = wf.frame(x, f0);
          featureFrames++;
        }
      }
      map.frame(t, f0, res);
      ms += now() - t0;
    },
    /** Engine VTLN tap: one 150 ms VTLN bin (te = bin end, ln alpha). */
    vtln(te, s) { map.vtln(te, s); },
    get cpuMs() { return ms; },
    get featureFrames() { return featureFrames; },
  };
}

// preview-core.js — the voice-preview spike's analyse-once / render-on-demand
// engine, shared by the module Worker (../worker/vp-worker.js) and the Node
// runners, so the browser and Node compute the same thing.
//
// analyse: capture-rate PCM (48 kHz in the app) -> the lab's sinc resampler to the
//   engine rate r (cutoff 0.45 r) -> F0 front end -> engine analysis -> first render
// render:  (st, a) -> rendered PCM at r, finished (RMS-matched to the input, peak <= 0.99)
//
// Front ends (§P4): "H" Harvest, "D" DIO + StoneMask, "S" Syrinx's posted pitch
// track (passed in) + StoneMask, "L" the lab's production pitch replica + StoneMask.
// PSOLA takes the same front end on its 10 ms grid, without StoneMask (WORLD's
// refinement step); with "L" that is exactly the prototype's PSOLA input.
import { createSincResampler } from "../../../src/resonance-lab/sinc-resampler.js";
import { WorldSession } from "./world-engine.js";
import { psolaAnalyze, psolaRender, finish } from "./psola.js";
import { gridToFrames, postedToFrames, toPsolaGrid } from "./frontends.js";

const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
const CHUNK_S = 0.025;

/** Resample a whole clip with the lab's streaming sinc resampler (cutoff 0.45 r). */
export function resampleClip(pcm, srIn, r) {
  if (srIn === r) return Float32Array.from(pcm);
  const nOut = Math.round(pcm.length * r / srIn);
  const rs = createSincResampler(srIn, r, { cutoffHz: 0.45 * r });
  const out = new Float32Array(nOut);
  const C = Math.round(srIn * CHUNK_S);
  let m = 0;
  const take = (y) => { const k = Math.min(y.length, nOut - m); out.set(y.subarray(0, k), m); m += k; };
  for (let k = 0; k < pcm.length && m < nOut; k += C) take(rs(pcm.subarray(k, Math.min(pcm.length, k + C))));
  const zeros = new Float32Array(C);
  for (let guard = 0; m < nOut && guard < 64; guard++) take(rs(zeros));
  if (m < nOut) throw new Error(`resampler produced ${m} of ${nOut} samples`);
  return out;
}

/** The lab's production pitch replica at the capture rate -> its 10 ms grid track (F-L). */
export function labGridTrack(lab, pcm, srIn) {
  const eng = lab.createLabEngine({ sampleRate: srIn, models: {}, reference: {} });
  const C = Math.round(srIn * CHUNK_S);
  for (let k = 0; k < pcm.length; k += C) eng.pushChunk(pcm.subarray(k, Math.min(pcm.length, k + C)));
  eng.finish();
  return eng.gridTrack();
}

export class Preview {
  /** engine: "world" | "psola"; world: createWorld() result (needed for WORLD and for H / D); lab: lab-engine module (for L). */
  constructor({ engine, world = null, lab = null }) {
    this.engine = engine;
    this.world = world;
    this.lab = lab;
    this.session = null;
  }

  /**
   * pcm: Float32Array at srIn. opts: { rate, frontEnd, posted (F-S track, 25 ms hops),
   * grid (optional precomputed F-L grid; else the replica runs here), framePeriod, first: { st, a } }.
   */
  analyse(pcm, srIn, { rate, frontEnd, posted = null, grid = null, framePeriod = 5, first = { st: 2, a: 1.03 } }) {
    const ms = {};
    const T0 = now();
    if (this.session) { this.session.free(); this.session = null; }
    let t0 = now();
    const x = resampleClip(pcm, srIn, rate);
    ms.resample = now() - t0;
    this.x = x;
    this.rate = rate;
    this.fe = frontEnd;
    let track = null;
    t0 = now();
    if (frontEnd === "L") track = grid || labGridTrack(this.lab, pcm, srIn);
    else if (frontEnd === "S") track = posted;
    const feMs = now() - t0;
    if (this.engine === "world") {
      const s = new WorldSession(this.world, x, rate, { framePeriod });
      this.session = s;
      let init = null;
      t0 = now();
      if (frontEnd === "L") init = gridToFrames(track, x.length, rate, framePeriod);
      else if (frontEnd === "S") init = postedToFrames(track, x.length, rate, framePeriod);
      const mapMs = now() - t0;
      const a = s.analyse(frontEnd === "H" || frontEnd === "D" ? frontEnd : "init", init);
      ms.frontEnd = feMs + mapMs + a.frontEnd;
      ms.stonemask = a.stonemask;
      ms.cheaptrick = a.cheaptrick;
      ms.d4c = a.d4c;
    } else {
      t0 = now();
      let g;
      if (frontEnd === "H" || frontEnd === "D") {
        const r = frontEnd === "H" ? this.world.harvest(x, rate, { framePeriod: 5 }) : this.world.dio(x, rate, { framePeriod: 5 });
        g = toPsolaGrid(frontEnd, r.f0, x.length, rate);
      } else {
        g = toPsolaGrid(frontEnd, track, x.length, rate);
      }
      ms.frontEnd = feMs + (now() - t0);
      t0 = now();
      this.marks = psolaAnalyze(x, rate, g);
      ms.marks = now() - t0;
      this.grid = g;
    }
    const r = this.render(first.st, first.a);
    Object.assign(ms, r.ms);
    ms.total = now() - T0;
    return { pcm: r.pcm, ms };
  }

  /** One slider change. Returns { pcm: Float32Array (finished), ms }. */
  render(st, a) {
    const ms = {};
    const T0 = now();
    let y;
    if (this.engine === "world") {
      const r = this.session.render(st, a);
      y = r.y;
      Object.assign(ms, r.ms);
    } else {
      const t0 = now();
      y = psolaRender(this.x, this.rate, this.marks, { st, a });
      ms.psola = now() - t0;
    }
    const t1 = now();
    const pcm = finish(y, this.x);
    ms.finish = now() - t1;
    ms.render = now() - T0;
    return { pcm, ms };
  }

  memoryBytes() { return this.world ? this.world.memoryBytes() : 0; }

  free() { if (this.session) this.session.free(); this.session = null; }
}

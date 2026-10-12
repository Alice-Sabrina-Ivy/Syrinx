// vp-worker.js — module Worker for the voice-preview spike (§P2a / §P5 of
// measurements/voice-preview-spike-2026-10-12.md): analyse once, render on demand.
// Every PCM buffer crosses the boundary as a transferable.
//
// Messages (each carries an id; the reply echoes it):
//   { type: "init", engine: "world" | "psola", build: "auto" | "simd" | "nosimd",
//     needWorld, needLab, wasmBase, nonce }
//       loads the WORLD module (SIMD or not, chosen with WebAssembly.validate on a
//       tiny SIMD probe when build is "auto") and, for the F-L front end, the lab's
//       pitch replica. A nonce query string defeats the HTTP and compiled-code caches.
//       -> { type: "ready", build, simd, ms }
//   { type: "analyse", pcm (Float32Array, capture rate, transferred), srIn, rate,
//     frontEnd: "H" | "D" | "S" | "L", posted?, grid?, framePeriod, first: { st, a } }
//       -> { type: "rendered", pcm (transferred), rate, ms (per stage), memBytes }
//   { type: "render", st, a } -> { type: "rendered", ... }
//   { type: "free" } -> { type: "freed" }
// Errors come back as { type: "error", id, error }.
import { createWorld, simdSupported } from "../lib/world-engine.js";
import { Preview } from "../lib/preview-core.js";

let preview = null;

function send(msg, pcm) {
  if (pcm) self.postMessage(msg, [pcm.buffer]);
  else self.postMessage(msg);
}

async function init(m) {
  const t0 = performance.now();
  const ms = {};
  const simd = simdSupported();
  const build = m.build === "auto" || !m.build ? (simd ? "simd" : "nosimd") : m.build;
  let world = null, lab = null;
  if (m.needWorld) {
    const q = m.nonce ? `?v=${encodeURIComponent(m.nonce)}` : "";
    const base = new URL(`${build}/`, m.wasmBase);
    let t = performance.now();
    const { default: factory } = await import(new URL(`vp_world.mjs${q}`, base).href);
    ms.glue = performance.now() - t;
    t = performance.now();
    const mod = await factory({ locateFile: (p) => new URL(`${p}${q}`, base).href });
    ms.instantiate = performance.now() - t;
    world = createWorld(mod);
  }
  if (m.needLab) {
    const t = performance.now();
    lab = await import("../../../src/resonance-lab/lab-engine.js");
    ms.lab = performance.now() - t;
  }
  if (preview) preview.free();
  preview = new Preview({ engine: m.engine, world, lab });
  ms.total = performance.now() - t0;
  return { type: "ready", id: m.id, build: m.needWorld ? build : null, simd, ms };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      send(await init(m));
    } else if (m.type === "analyse") {
      const r = preview.analyse(m.pcm, m.srIn, {
        rate: m.rate, frontEnd: m.frontEnd, posted: m.posted || null, grid: m.grid || null,
        framePeriod: m.framePeriod || 5, first: m.first,
      });
      send({ type: "rendered", id: m.id, pcm: r.pcm, rate: m.rate, ms: r.ms, memBytes: preview.memoryBytes() }, r.pcm);
    } else if (m.type === "render") {
      const r = preview.render(m.st, m.a);
      send({ type: "rendered", id: m.id, pcm: r.pcm, rate: preview.rate, ms: r.ms, memBytes: preview.memoryBytes() }, r.pcm);
    } else if (m.type === "free") {
      if (preview) preview.free();
      send({ type: "freed", id: m.id });
    } else {
      throw new Error(`unknown message ${m.type}`);
    }
  } catch (err) {
    send({ type: "error", id: m.id, error: String((err && err.stack) || err) });
  }
};

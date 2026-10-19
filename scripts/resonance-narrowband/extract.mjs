// extract.mjs — the narrowband detector's band energies on the REAL resonance
// path (measurements/resonance-narrowband-2026-10-19.md §2).
//
//   REAL src/dsp/pitch-worker.js (fake `self`, a fresh module instance per
//   stream) <- 25 ms capture chunks, exactly as scripts/resonance-robustness/
//   run_cue.mjs feeds it; each posted pitch message relayed to the REAL lab
//   engine (src/resonance-lab/lab-engine.js) built as
//   src/resonance/resonance-worker.js startEngine() builds it ("frames" mode,
//   pushChunk(x, null, contextTime), pushPitchFrame(contextTime,
//   voiced ? pitch : 0), same call order as the worker).
//   Each 10 ms grid frame, when the engine resolves it, is read back
//   (gridTrack()); for a voiced one the 512 samples [c - 512, c) of the
//   engine's own 16 kHz ring (ring16, reached through setFrameTap) go through
//   detector.mjs bandEnergies().
//
// The engine runs without the vtln model and the cue: neither changes ring16
// or the grid (checked with --vtln, which loads the shipped vtln_warp.json /
// reference.json as the worker does; the outputs must be identical).
//
//   node scripts/resonance-narrowband/extract.mjs <out.f64> <sampleRate> [--vtln] <name=stream.f32> ...
// out.f64: per stream, header [nameIndex, gridFrames, voicedFrames] then
// voicedFrames rows [j, e0, e1, e2, e3] (float64; j = grid index).
// stdout: JSON { streams: [{ name, gridFrames, voicedFrames, framesDropped,
//          detMs, audioS }], cpuMs }.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bandEnergies, N } from "./detector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
const useVtln = args.includes("--vtln");
const [outFile, srArg, ...items] = args.filter((a) => a !== "--vtln");
const sr = Number(srArg);
if (!outFile || !(sr === 48000 || sr === 44100) || !items.length) {
  console.error("usage: extract.mjs <out.f64> <48000|44100> [--vtln] <name=stream.f32> ...");
  process.exit(2);
}
const { createLabEngine } = await import(pathToFileURL(path.join(repo, "src/resonance-lab/lab-engine.js")).href);
let vtlnModel = null, reference = null;
if (useVtln) {
  const A = path.join(repo, "public", "resonance-lab");
  vtlnModel = JSON.parse(readFileSync(path.join(A, "vtln_warp.json"), "utf8"));
  reference = JSON.parse(readFileSync(path.join(A, "reference.json"), "utf8"));
}

let sink = [];
globalThis.self = { postMessage: (m) => sink.push(m) };
let instance = 0;

async function runStream(file) {
  // fresh pitch worker module state for every stream
  await import(pathToFileURL(path.join(repo, "src/dsp/pitch-worker.js")).href + `?s=${instance++}`);
  const pitchOnMessage = self.onmessage;
  const pitchPort = {};
  pitchOnMessage({ data: { type: "init", inputSampleRate: sr } });
  pitchOnMessage({ data: { type: "audioPort", port: pitchPort } });
  sink = [];
  const engine = createLabEngine({
    sampleRate: sr,
    models: useVtln ? { vtln: vtlnModel } : {},
    reference: useVtln ? reference : null,
    pitchSource: "frames",
    ...(useVtln ? { onStamped: () => {} } : {}),
  });
  let ring = null;
  engine.setFrameTap({ frame(t, f0, r) { ring = r; }, vtln() {} });

  const b = readFileSync(file);
  const y = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const rows = [];
  const win = new Float64Array(N);
  const e = new Float64Array(4);
  let done = 0, voiced = 0, detNs = 0n;
  function take(ng) {
    if (ng <= done) return;
    const g = engine.gridTrack();
    if (g.length < ng) throw new Error("grid track shorter than resolved count");
    for (let j = done; j < ng; j++) {
      if (!(g[j] > 0)) continue;
      if (!ring) throw new Error("16 kHz ring not reached yet");
      const c = Math.round((0.005 + 0.01 * j) * 16000);
      if (c > ring.end || c - N < ring.end - ring.capacity) throw new Error(`window ${c} outside ring (end ${ring.end})`);
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < N; i++) win[i] = ring.at(c - N + i);
      bandEnergies(win, e);
      detNs += process.hrtime.bigint() - t0;
      rows.push(j, e[0], e[1], e[2], e[3]);
      voiced++;
    }
    done = ng;
  }
  function poll() {
    const s = engine.snapshot();
    take(Math.round((s.t - s.lagS - 0.005) / 0.01) + 1);
  }

  let s = 0, i = 0;
  while (s < y.length) {
    const len = sr === 48000 ? 1200 : (i % 2 ? 1103 : 1102);
    const end = Math.min(y.length, s + len);
    const contextTime = end / sr;
    const x = y.slice(s, end);
    sink = [];
    pitchPort.onmessage({ data: { buffer: x.slice().buffer, contextTime } });
    const pitchMsgs = sink.filter((m) => m.type === "pitch");
    sink = [];
    engine.pushChunk(x, null, contextTime);
    poll();
    for (const m of pitchMsgs) {
      engine.pushPitchFrame(m.contextTime, m.voiced ? m.pitch : 0);
      poll();
    }
    s = end; i++;
  }
  engine.finish();
  take(engine.gridTrack().length);
  return { gridFrames: done, voicedFrames: voiced, rows, framesDropped: engine.snapshot().framesDropped,
    detMs: Number(detNs) / 1e6, audioS: y.length / sr };
}

const out = [];
const meta = [];
for (let k = 0; k < items.length; k++) {
  const eq = items[k].indexOf("=");
  const name = items[k].slice(0, eq), file = items[k].slice(eq + 1);
  const r = await runStream(file);
  out.push(k, r.gridFrames, r.voicedFrames);
  for (const v of r.rows) out.push(v);
  meta.push({ name, gridFrames: r.gridFrames, voicedFrames: r.voicedFrames, framesDropped: r.framesDropped,
    detMs: +r.detMs.toFixed(2), audioS: r.audioS });
}
writeFileSync(outFile, Buffer.from(Float64Array.from(out).buffer));
const c = process.cpuUsage();
process.stdout.write(JSON.stringify({ streams: meta, cpuMs: Math.round((c.user + c.system) / 1000) }) + "\n");

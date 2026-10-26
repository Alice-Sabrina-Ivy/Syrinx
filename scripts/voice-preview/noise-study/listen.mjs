// listen.mjs — Voice Shaper noise study: A/B listening material (measurements/voice-shaper-noise-2026-10-25.md).
// For chosen test mixtures, full-band renders at one cell of: the recording as captured, the
// preview with nothing done (`none|posted`), with the fork's RNNoise (`rnn|posted`), with RNNoise
// + re-track, with the shipped design (the app's DeepFilterNet 3 path + re-track; the automatic
// rule decides whether it applies), and the clean recording's preview (reference).
// Writes MP3s (ffmpeg) and a JSON index to <out>.
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/noise-study/listen.mjs
//        --data=build/vsn/data --out=build/vsn/listen --mix=id1,id2,... [--st=4 --pct=10]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { PreviewEngine } from "../../../src/voice-preview/engine/preview.js";
import { createWorld } from "../../../src/voice-preview/engine/world.js";
import { pitchStats, pitchLimits } from "../../../src/voice-preview/controls.js";
import { autoDenoise } from "../../../src/voice-preview/checks.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const DATA = path.resolve(args.data ?? "build/vsn/data"), OUT = path.resolve(args.out ?? "build/vsn/listen");
const ST = Number(args.st ?? 4), PCT = Number(args.pct ?? 10);
mkdirSync(OUT, { recursive: true });
const readF32 = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
function mp3(name, x, sr) {
  const raw = path.join(OUT, `${name}.f32`);
  writeFileSync(raw, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "f32le", "-ar", String(sr), "-ac", "1", "-i", raw, "-codec:a", "libmp3lame", "-b:a", "96k", path.join(OUT, `${name}.mp3`)]);
  return `${name}.mp3`;
}

const WASM_DIR = path.join(REPO, "src/voice-preview/wasm");
const { default: factory } = await import(pathToFileURL(path.join(WASM_DIR, "vp_world.mjs")).href);
const engine = new PreviewEngine(createWorld(await factory({ locateFile: () => pathToFileURL(path.join(WASM_DIR, "simd/vp_world.wasm")).href })));
// RNNoise: the fork's module, as copied for the study (build/vsn/cand/rnn, render.mjs)
const D = await import(pathToFileURL(path.join(REPO, "build/vsn/cand/rnn/denoise.mjs")).href);
const rn = D.createRnnoise(readFileSync(path.join(REPO, "build/vsn/cand/rnn/src/voice-preview/rnnoise/rnnoise.wasm")));
// DeepFilterNet 3: the app's own path (src/voice-preview/dfn3.js)
const DF = await import(pathToFileURL(path.join(REPO, "src/voice-preview/dfn3.js")).href);
const ORT_DIST = path.join(REPO, "node_modules/onnxruntime-web/dist");
const ort = await import(pathToFileURL(path.join(ORT_DIST, "ort.wasm.bundle.min.mjs")).href);
ort.env.wasm.numThreads = 1; ort.env.wasm.wasmBinary = readFileSync(path.join(ORT_DIST, "ort-wasm-simd-threaded.wasm"));
const dfFiles = Object.fromEntries(DF.DFN3_MODEL.files.map((f) => [f.key, new Uint8Array(readFileSync(path.join(REPO, "build/models/dfn3", f.name)))]));
const dfn = DF.createDfn3(ort, await DF.createDfn3Sessions(ort, dfFiles));

// the real pitch worker, fresh, over the cleaned recording (render.mjs's "re")
const P = { posts: [], postMessage(m) { this.posts.push(m); } };
globalThis.self = P;
await import(pathToFileURL(path.join(REPO, "src/dsp/pitch-worker.js")).href);
function retrack(pcm, sr, C) {
  globalThis.self = P; P.posts = [];
  P.onmessage({ data: { type: "init", inputSampleRate: sr } });
  const pp = {}; P.onmessage({ data: { type: "audioPort", port: pp } });
  const nk = Math.floor(pcm.length / C), out = new Float32Array(nk);
  for (let k = 0; k < nk + 4; k++) pp.onmessage({ data: { buffer: (k < nk ? pcm.slice(k * C, (k + 1) * C) : new Float32Array(C)).buffer, contextTime: (k + 1) * C / sr } });
  for (const m of P.posts) if (m.type === "pitch") { const kk = Math.round(m.contextTime * sr / C) - 1; if (kk >= 0 && kk < nk) out[kk] = m.pitch > 0 ? m.pitch : 0; }
  return out;
}

const margins = JSON.parse(readFileSync(path.join(DATA, "margins", "test.json"), "utf8"));
const index = [];
for (const id of args.mix.split(",")) {
  const dir = path.join(DATA, "mix", "test");
  const mix = JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8"));
  const clean = JSON.parse(readFileSync(path.join(dir, `${mix.speech.id}__clean.json`), "utf8"));
  const sr = mix.rate;
  const lim = pitchLimits(pitchStats(Float32Array.from(clean.track)).p5Hz);
  const st = ST > 0 ? Math.min(ST, lim.stMax) : Math.max(ST, lim.stMin);
  const pcm = readF32(path.join(dir, `${id}.f32`));
  const den = D.denoiseClip(rn, pcm, sr);
  const dfc = await DF.denoiseClipDfn3(dfn, pcm, sr);
  const fire = autoDenoise(margins[id].margin);
  const make = (x, tr) => { engine.analyse(x, sr, tr); return engine.render(st, PCT).pcm; };
  const versions = {
    recording: mp3(`${id}.recording`, pcm, sr),
    none: mp3(`${id}.none`, make(pcm, Float32Array.from(mix.track)), engine.rate),
    fork: mp3(`${id}.fork`, make(den, Float32Array.from(mix.track)), engine.rate),
    rnnre: mp3(`${id}.rnnre`, make(den, retrack(den, sr, mix.chunk)), engine.rate),
    chosen: mp3(`${id}.chosen`, fire ? make(dfc, retrack(dfc, sr, mix.chunk)) : make(pcm, Float32Array.from(mix.track)), engine.rate),
    reference: mp3(`${id}.reference`, make(readF32(path.join(dir, `${mix.speech.id}__clean.f32`)), Float32Array.from(clean.track)), engine.rate),
  };
  index.push({ id, sex: mix.speech.sex, source: mix.speech.source, snr: mix.snr, noise: mix.noise?.class, margin: margins[id].margin, autoFired: fire, st, pct: PCT, versions });
  console.log(id, mix.speech.sex, mix.snr, mix.noise?.class, `margin ${margins[id].margin.toFixed(1)}`, fire ? "auto on" : "auto off");
}
writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));

// listen.mjs — Voice Shaper noise study: A/B listening material (measurements/voice-shaper-noise-2026-10-25.md).
// For chosen test mixtures, full-band renders at one cell of: the recording as captured, the
// preview with nothing done (`none|posted`), with the fork's RNNoise (`rnn|posted`), with the
// chosen design (RNNoise + re-track; the automatic rule decides whether it applies), with
// DeepFilterNet 3 + re-track (information), and the clean recording's preview (reference).
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
const D = await import(pathToFileURL(path.join(REPO, "src/voice-preview/denoise.js")).href);
const rn = D.createRnnoise(readFileSync(path.join(REPO, "src/voice-preview/rnnoise/rnnoise.wasm")));

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
  const dfn = readF32(path.join(DATA, "den", "dfn3", "test", `${id}.f32`));
  const fire = autoDenoise(margins[id].margin);
  const make = (x, tr) => { engine.analyse(x, sr, tr); return engine.render(st, PCT).pcm; };
  const versions = {
    recording: mp3(`${id}.recording`, pcm, sr),
    none: mp3(`${id}.none`, make(pcm, Float32Array.from(mix.track)), engine.rate),
    fork: mp3(`${id}.fork`, make(den, Float32Array.from(mix.track)), engine.rate),
    chosen: mp3(`${id}.chosen`, fire ? make(den, retrack(den, sr, mix.chunk)) : make(pcm, Float32Array.from(mix.track)), engine.rate),
    dfn3: mp3(`${id}.dfn3`, make(dfn, retrack(dfn, sr, mix.chunk)), engine.rate),
    reference: mp3(`${id}.reference`, make(readF32(path.join(dir, `${mix.speech.id}__clean.f32`)), Float32Array.from(clean.track)), engine.rate),
  };
  index.push({ id, sex: mix.speech.sex, source: mix.speech.source, snr: mix.snr, noise: mix.noise?.class, margin: margins[id].margin, autoFired: fire, st, pct: PCT, versions });
  console.log(id, mix.speech.sex, mix.snr, mix.noise?.class, `margin ${margins[id].margin.toFixed(1)}`, fire ? "auto on" : "auto off");
}
writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));

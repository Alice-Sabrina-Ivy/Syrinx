// vp-test-lib.js — shared helpers for the voice-preview tests (not a test itself) and
// for scripts/voice-preview/make-spike-parity.mjs, which writes the fixtures the tests
// compare against. measurements/voice-preview-phase1-2026-10-19.md §5, §14.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWorld } from "../../src/voice-preview/engine/world.js";
import { resampleClip } from "../../src/voice-preview/engine/preview.js";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const WASM_DIR = path.join(REPO, "src/voice-preview/wasm");
export const GLUE_URL = pathToFileURL(path.join(WASM_DIR, "vp_world.mjs")).href;
export const WASM_URLS = {
  simd: pathToFileURL(path.join(WASM_DIR, "simd/vp_world.wasm")).href,
  nosimd: pathToFileURL(path.join(WASM_DIR, "nosimd/vp_world.wasm")).href,
};
export const PARITY_JSON = path.join(REPO, "tests/voice-preview/fixtures/spike-parity.json");
export const RNNOISE_URL = pathToFileURL(path.join(REPO, "src/voice-preview/rnnoise/rnnoise.wasm")).href;

/**
 * Node's fetch() has no file: URLs; the worker fetches the RNNoise module with fetch(). For the
 * tests, file: URLs are read from disk (a missing file answers 404); other URLs go to the real fetch.
 */
export function installFileFetch() {
  if (globalThis.fetch?.__vpFile) return;
  const real = globalThis.fetch;
  const fileFetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith("file:")) return real(url, init);
    try { return new Response(readFileSync(new URL(u)), { status: 200 }); } catch { return new Response(null, { status: 404 }); }
  };
  fileFetch.__vpFile = true;
  globalThis.fetch = fileFetch;
}

/** The parity cells: (st, pct). */
export const CELLS = [[0, 0], [2, 3], [-2, -3], [4, 0], [0, 6], [12, 26], [-12, -21]];
export const cellKey = (st, pct) => `${st >= 0 ? "+" : "-"}${Math.abs(st)}st${pct >= 0 ? "+" : "-"}${Math.abs(pct)}pct`;

/** The app's capture chunk: floor(0.025 x rate) samples (captureSource.js). */
export const chunkFor = (sr) => Math.floor(0.025 * sr);

export function sha256(buf) {
  const b = ArrayBuffer.isView(buf) ? Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength) : Buffer.from(buf);
  return createHash("sha256").update(b).digest("hex");
}

export function readWav16(p) {
  const b = readFileSync(p);
  let off = 12;
  let data = null, sr = 0;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === "fmt ") sr = b.readUInt32LE(off + 12);
    if (id === "data") { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len & 1);
  }
  const x = new Float32Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return { x, sr };
}

/**
 * The parity inputs: the three committed LibriSpeech 16 kHz clips (CC BY 4.0,
 * tests/resonance-lab/fixtures/) at 16 kHz and upsampled to 44.1 and 48 kHz, plus
 * one upsampled to 96 kHz (the resample-down path). Upsampling: the engine's own
 * resampleClip (the resonance lab's sinc resampler). Each input is cut to whole
 * capture chunks, as the recorder keeps them.
 */
export const INPUT_SPECS = [
  ...["ls_woman_high", "ls_man_low", "ls_man_hi8_f105"].flatMap((clip) => [16000, 44100, 48000].map((rate) => ({ clip, rate }))),
  { clip: "ls_man_low", rate: 96000 },
];
export const inputName = ({ clip, rate }) => `${clip}@${rate}`;

export function makeInput({ clip, rate }) {
  const { x, sr } = readWav16(path.join(REPO, "tests/resonance-lab/fixtures", `${clip}.wav`));
  const up = rate === sr ? Float32Array.from(x) : resampleClip(x, sr, rate);
  const C = chunkFor(rate);
  return { pcm: up.slice(0, Math.floor(up.length / C) * C), rate, chunk: C };
}

/** Load one build of the committed module in Node (the glue reads the .wasm from disk). */
export async function loadWorld(build) {
  const { default: factory } = await import(GLUE_URL);
  const mod = await factory({ locateFile: () => WASM_URLS[build] });
  return createWorld(mod);
}

export function makeChecker() {
  const r = { passed: 0, failed: 0 };
  r.check = (name, cond, detail = "") => {
    if (cond) { r.passed++; console.log(`  PASS ${name}${detail ? `  (${detail})` : ""}`); }
    else { r.failed++; console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`); }
  };
  r.done = () => {
    console.log(`\n${r.passed} passed, ${r.failed} failed`);
    process.exit(r.failed === 0 ? 0 : 1);
  };
  return r;
}
